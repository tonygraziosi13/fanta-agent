"""
Storico infortuni da Transfermarkt, e l'indice di rischio che ne deriva.

--- Il provider costoso ---
Non esiste un elenco unico: servono due richieste per giocatore (ricerca +
pagina infortuni), cioe' un migliaio in totale. La cache su disco di `http.py`
rende il costo una tantum, il rate limit lo rende sostenibile per chi ospita il
sito, e `--limit` permette di provarlo su pochi giocatori prima di lanciarlo tutto.

--- Perche' l'indice si calcola qui e non nell'app ---
US19-3 e' esplicita: niente calcoli complessi sul dispositivo. L'app riceve un
numero 0..1 gia' pronto, e in `metrics.ts` decide solo in che fascia cade.
"""

from __future__ import annotations

import re
from typing import Optional, Sequence

from bs4 import BeautifulSoup

from .. import config
from ..http import HttpClient, HttpError
from ..model import Contribution, InjurySpell, Injuries, RosterEntry
from ..normalize import normalize_team, parse_listone_name
from ..resolver import Candidate, EntityResolver, Match, make_candidate
from .base import ProviderOutcome

PROFILE_HREF = re.compile(r"^/([^/]+)/profil/spieler/(\d+)$")
DIGITS = re.compile(r"\d+")

# Sigle di ruolo italiane di Transfermarkt. Servono solo a distinguere i portieri
# dal resto — l'unica incompatibilita' che il resolver tratta come rigida.
GOALKEEPER_CODES = {"POR", "P.", "TW"}
DEFENDER_CODES = {"DC", "TD", "TS", "DIF", "LIB"}
MIDFIELD_CODES = {"CC", "CDC", "COC", "ES", "ED", "MED", "CEN"}
FORWARD_CODES = {"AS", "AD", "SP", "PC", "ATT", "TRQ", "P"}

# Una rivendicazione: quale giocatore del listone dice di essere quale profilo,
# con che confidenza e a quale URL.
Claim = tuple[RosterEntry, Match, str]


def _role_from_code(code: str) -> Optional[str]:
    upper = code.upper()
    if upper in GOALKEEPER_CODES:
        return "P"
    if upper in DEFENDER_CODES:
        return "D"
    if upper in MIDFIELD_CODES:
        return "C"
    if upper in FORWARD_CODES:
        return "A"
    return None


def _first_int(text: str) -> Optional[int]:
    match = DIGITS.search(text.replace(".", ""))
    return int(match.group()) if match else None


class TransfermarktProvider:
    name = "transfermarkt"

    def collect(
        self,
        roster: Sequence[RosterEntry],
        http: HttpClient,
        manual_map: dict[str, dict[str, str]],
    ) -> ProviderOutcome:
        """
        Due fasi, e non una sola per giocatore.

        La ricerca avviene per cognome e ogni giocatore vede un elenco di
        candidati diverso: senza un passaggio di sintesi, due omonimi del listone
        possono agganciarsi allo stesso profilo e ricevere entrambi lo storico
        clinico di uno solo. Si raccolgono quindi prima tutte le rivendicazioni,
        si assegna ogni profilo a chi lo rivendica con piu' confidenza, e solo
        dopo si scaricano gli infortuni.

        Effetto collaterale gradito: le pagine infortuni si scaricano solo per i
        vincitori, quindi la fonte riceve meno richieste.
        """
        outcome = ProviderOutcome()

        claims, aborted = self._collect_claims(roster, http, manual_map, outcome)
        if aborted:
            return outcome

        for player_key, (entry, match, slug) in self._resolve_conflicts(claims, outcome).items():
            try:
                injuries = self._fetch_injuries(slug, player_key, http)
            except HttpError:
                outcome.unresolved.append(entry)
                continue

            if injuries is None:
                # Profilo trovato ma nessun infortunio registrato: e' un dato,
                # ed e' il migliore possibile. Zero giorni, rischio nullo.
                injuries = Injuries(days=0, matches=0, risk=0.0, history=[])

            outcome.contributions[entry.id] = Contribution(injuries=injuries)
            outcome.matches[entry.id] = match

        return outcome

    def _collect_claims(
        self,
        roster: Sequence[RosterEntry],
        http: HttpClient,
        manual_map: dict[str, dict[str, str]],
        outcome: ProviderOutcome,
    ) -> tuple[dict[str, list[Claim]], bool]:
        """Fase 1: chi rivendica quale profilo. Il bool dice se si e' rinunciato."""
        claims: dict[str, list[Claim]] = {}
        failures = 0

        for entry in roster:
            try:
                profile = self._resolve_profile(entry, http, manual_map)
            except HttpError as error:
                failures += 1
                outcome.unresolved.append(entry)
                # Una fonte che ci chiude la porta lo fa per tutti: dopo qualche
                # tentativo si smette invece di insistere per 500 giocatori.
                if failures >= 5 and not claims:
                    outcome.failure = f"Transfermarkt irraggiungibile: {error}"
                    outcome.unresolved = list(roster)
                    return {}, True
                continue

            if profile is None:
                outcome.unresolved.append(entry)
                continue

            slug, player_key, match = profile
            claims.setdefault(player_key, []).append((entry, match, slug))

        return claims, False

    def _resolve_conflicts(
        self,
        claims: dict[str, list[Claim]],
        outcome: ProviderOutcome,
    ) -> dict[str, Claim]:
        """Fase 2: un profilo, una persona. Vince la rivendicazione piu' sicura."""
        winners: dict[str, Claim] = {}

        for player_key, contenders in claims.items():
            contenders.sort(key=lambda item: item[1].confidence, reverse=True)
            winners[player_key] = contenders[0]
            outcome.unresolved.extend(entry for entry, _, _ in contenders[1:])

        return winners

    # --- Risoluzione del profilo --------------------------------------------

    def _resolve_profile(
        self,
        entry: RosterEntry,
        http: HttpClient,
        manual_map: dict[str, dict[str, str]],
    ) -> Optional[tuple[str, str, Match]]:
        """
        Cerca per cognome e lascia decidere al resolver.

        La ricerca per cognome nudo massimizza il richiamo: "Martinez" restituisce
        tutti i Martinez del mondo, e sara' il vincolo di ruolo piu' la squadra a
        scegliere il nostro. Cercare "Martinez Jo." non troverebbe nulla.
        """
        # --- L'override manuale scavalca la ricerca, non solo il matching.
        # La ricerca di Transfermarkt restituisce una pagina sola: Josep Martinez
        # non compare fra i "martinez" perche' e' oltre il primo schermo, e
        # nessuna euristica puo' scegliere un candidato che non ha davanti.
        # L'unico override che serve davvero e' quindi quello che salta anche la
        # ricerca. Lo slug dell'URL e' decorativo — Transfermarkt risolve
        # sull'id — quindi si puo' costruire il profilo dal solo id.
        forced = manual_map.get(self.name, {}).get(str(entry.id))
        if forced is not None:
            candidate = make_candidate(forced, entry.name, {normalize_team(entry.team)}, entry.role)
            return forced, forced, Match(candidate, confidence=1.0, strategy="mappa-manuale")

        parsed = parse_listone_name(entry.name)
        query = parsed.surname or entry.name

        html = http.fetch(
            config.TRANSFERMARKT_SEARCH_URL,
            params={"query": query},
            user_agent=config.BROWSER_USER_AGENT,
        )
        candidates, slugs = self._parse_search(html)
        if not candidates:
            return None

        resolver = EntityResolver(self.name, candidates, manual_map)
        match = resolver.resolve(entry, normalize_team(entry.team))
        if match is None:
            return None

        slug = slugs.get(match.candidate.key)
        if slug is None:
            return None
        return slug, match.candidate.key, match

    def _parse_search(self, html: str) -> tuple[list[Candidate], dict[str, str]]:
        soup = BeautifulSoup(html, "lxml")
        table = soup.select_one("table.items")
        body = table.find("tbody") if table else None
        if body is None:
            return [], {}

        candidates: list[Candidate] = []
        slugs: dict[str, str] = {}

        for tr in body.find_all("tr", recursive=False):
            link = tr.select_one('a[href*="/profil/spieler/"]')
            if link is None:
                continue
            href_match = PROFILE_HREF.match(link.get("href", ""))
            if href_match is None:
                continue

            slug, player_key = href_match.group(1), href_match.group(2)
            images = [img.get("title") or img.get("alt") or "" for img in tr.find_all("img")]
            name = images[0] if images else link.get_text(strip=True)
            team = images[1] if len(images) > 1 else ""

            # Il ruolo sta nella seconda cella, e va letto da li'.
            # Cercare la sigla nel testo dell'intera riga sembrava piu' robusto ed
            # era invece sbagliato: "AS Roma" contiene "AS", che e' la sigla di
            # ala sinistra. Mile Svilar, portiere, veniva classificato attaccante
            # e il vincolo di ruolo lo scartava dai portieri del listone.
            cells = tr.find_all("td", recursive=False)
            role = _role_from_code(cells[1].get_text(strip=True)) if len(cells) > 1 else None

            candidates.append(
                make_candidate(
                    key=player_key, raw_name=name, teams={normalize_team(team)}, role=role
                )
            )
            slugs[player_key] = slug

        return candidates, slugs

    # --- Storico infortuni ---------------------------------------------------

    def _fetch_injuries(
        self, slug: str, player_key: str, http: HttpClient
    ) -> Optional[Injuries]:
        url = f"{config.TRANSFERMARKT_BASE}/{slug}/verletzungen/spieler/{player_key}"
        html = http.fetch(url, user_agent=config.BROWSER_USER_AGENT)
        soup = BeautifulSoup(html, "lxml")

        history: list[InjurySpell] = []
        totals_by_season: dict[str, tuple[int, int]] = {}

        for table in soup.find_all("table"):
            headers = [th.get_text(strip=True).lower() for th in table.find_all("th")]
            body = table.find("tbody")
            if body is None or not headers:
                continue

            # Tabella di dettaglio: una riga per infortunio.
            if "infortunio" in headers and "stagione" in headers:
                for tr in body.find_all("tr"):
                    cells = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
                    if len(cells) < 6:
                        continue
                    history.append(
                        InjurySpell(
                            season=cells[0],
                            type=cells[1],
                            days=_first_int(cells[4]),
                            matches=_first_int(cells[5]),
                        )
                    )
            # Tabella di riepilogo: una riga per stagione.
            elif "stagione" in headers and "giorni" in headers:
                for tr in body.find_all("tr"):
                    cells = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
                    if len(cells) < 4:
                        continue
                    days = _first_int(cells[1]) or 0
                    matches = _first_int(cells[3]) or 0
                    totals_by_season[cells[0]] = (days, matches)

        if not history and not totals_by_season:
            return None

        return self._build_profile(history, totals_by_season)

    def _build_profile(
        self,
        history: list[InjurySpell],
        totals_by_season: dict[str, tuple[int, int]],
    ) -> Injuries:
        """
        Finestra mobile sulle ultime stagioni: un crociato del 2019 non dice
        piu' nulla sul rischio di quest'anno, e conservarlo nel conteggio
        penalizzerebbe a vita chi si e' rotto una volta da giovane.
        """
        recent = sorted(totals_by_season.keys(), reverse=True)[: config.INJURY_SEASONS_WINDOW]
        days = sum(totals_by_season[s][0] for s in recent)
        matches = sum(totals_by_season[s][1] for s in recent)

        risk = min(days / config.INJURY_RISK_SATURATION_DAYS, 1.0)

        return Injuries(
            days=days,
            matches=matches,
            risk=round(risk, 3),
            # Lo storico completo resta nel payload: l'indice e' una sintesi, ma
            # l'utente in asta vuole poter vedere *che* infortuni erano.
            history=history[:12],
        )
