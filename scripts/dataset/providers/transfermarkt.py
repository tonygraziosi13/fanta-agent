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

--- Due mestieri, non uno ---
Gli infortuni valgono per *tutti*: sono l'unica sezione che nessun altro livello
sa produrre, e il profilo va comunque risolto per chiunque. Il rendimento
invece e' il LIVELLO 3 della cascata, l'ultima spiaggia: si scarica solo per chi
ne' Understat ne' FBref hanno coperto. E' un endpoint in piu' per giocatore, e
pagarlo per i 400 gia' risolti sarebbe spreco puro.

Le metriche analitiche non esistono su Transfermarkt: chi si ferma qui le ha
tutte e otto a null, ed e' un'informazione vera che non va mascherata.
"""

from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional, Sequence

from bs4 import BeautifulSoup

from .. import config
from ..http import HttpClient, HttpError
from ..model import (
    CascadeState,
    Contribution,
    InjurySpell,
    Injuries,
    Performance,
    RosterEntry,
    Section,
)
from ..normalize import normalize_team, parse_listone_name, strip_accents
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


def _search_variants(raw_name: str, surname: str) -> list[str]:
    """
    Riformulazioni da provare quando la ricerca non restituisce nulla.

    `normalize_text` trasforma i trattini in spazi, ed e' corretto per il
    *confronto*: "Milinkovic-Savic" e "Milinkovic Savic" devono collassare. Ma
    la stessa stringa finisce come *query*, e li' il trattino conta: cercare
    "norton cuffy" su Transfermarkt restituisce zero risultati, "norton-cuffy"
    restituisce esattamente lui. Due usi diversi che non possono condividere la
    forma.

    Le varianti costano una richiesta ciascuna e si tentano solo dopo un buco:
    per i giocatori che si risolvono al primo colpo — la larga maggioranza — il
    costo di rete non cambia di nulla.
    """
    varianti: list[str] = []

    # L'iniziale del nome ("Kristensen T.") non appartiene al cognome cercato.
    grezzo = strip_accents(raw_name).lower().strip()
    grezzo = re.sub(r"\s+[a-z]{1,2}\.?$", "", grezzo).strip()

    if "-" in grezzo and grezzo != surname:
        varianti.append(grezzo)

    # Ultimo token: "de la fuente" -> "fuente". Chi ha un cognome composto e'
    # spesso indicizzato sotto la sola parte finale.
    tokens = surname.split()
    if len(tokens) > 1 and tokens[-1] not in varianti:
        varianti.append(tokens[-1])

    return varianti


class TransfermarktProvider:
    name = "transfermarkt"

    def collect(
        self,
        roster: Sequence[RosterEntry],
        http: HttpClient,
        manual_map: dict[str, dict[str, str]],
        state: CascadeState,
    ) -> ProviderOutcome:
        """
        Due fasi, e non una sola per giocatore.

        La ricerca avviene per cognome e ogni giocatore vede un elenco di
        candidati diverso: senza un passaggio di sintesi, due omonimi del listone
        possono agganciarsi allo stesso profilo e ricevere entrambi lo storico
        clinico di uno solo. Si raccolgono quindi prima tutte le rivendicazioni,
        si assegna ogni profilo a chi lo rivendica con piu' confidenza, e solo
        dopo si scaricano infortuni e rendimento.

        Effetto collaterale gradito: le pagine di dettaglio si scaricano solo per
        i vincitori, quindi la fonte riceve meno richieste.
        """
        outcome = ProviderOutcome()

        claims, aborted = self._collect_claims(roster, http, manual_map, state, outcome)
        if aborted:
            return outcome

        winners = self._resolve_conflicts(claims, outcome)

        # Il grosso del tempo di questa fonte sta qui: una o due richieste per
        # vincitore. E' il punto in cui il parallelismo paga davvero, e la porta
        # di rete tiene comunque il ritmo entro i limiti dell'host.
        with ThreadPoolExecutor(max_workers=config.MAX_WORKERS) as pool:
            results = pool.map(
                lambda item: self._fetch_details(item[0], item[1], http, state),
                winners.items(),
            )
            for (entry, match, _slug), contribution in zip(winners.values(), results):
                if contribution is None:
                    outcome.unresolved.append(entry)
                    continue
                outcome.contributions[entry.id] = contribution
                outcome.matches[entry.id] = match

        return outcome

    def _fetch_details(
        self,
        player_key: str,
        claim: Claim,
        http: HttpClient,
        state: CascadeState,
    ) -> Optional[Contribution]:
        """Infortuni per tutti; rendimento solo per chi e' arrivato fin qui scoperto."""
        entry, _match, slug = claim

        try:
            injuries = self._fetch_injuries(slug, player_key, http)
        except HttpError:
            return None

        if injuries is None:
            # Profilo trovato ma nessun infortunio registrato: e' un dato, ed e'
            # il migliore possibile. Zero giorni, rischio nullo.
            injuries = Injuries(days=0, matches=0, risk=0.0, history=[])

        performance = None
        if not state.covers(entry.id, Section.PERFORMANCE):
            try:
                performance = self._fetch_performance(player_key, http)
            except HttpError:
                performance = None

        return Contribution(injuries=injuries, performance=performance)

    def _collect_claims(
        self,
        roster: Sequence[RosterEntry],
        http: HttpClient,
        manual_map: dict[str, dict[str, str]],
        state: CascadeState,
        outcome: ProviderOutcome,
    ) -> tuple[dict[str, list[Claim]], bool]:
        """
        Fase 1: chi rivendica quale profilo. Il bool dice se si e' rinunciato.

        Le ricerche vanno in parallelo, ma i risultati si raccolgono nell'ordine
        del listone: la fase 2 assegna i contesi per confidenza, e a parita' di
        confidenza deve vincere sempre lo stesso: un dataset che cambia a seconda
        di quale thread ha finito prima non e' riproducibile, e il gate di
        rilascio lo leggerebbe come contenuto nuovo a ogni esecuzione.
        """
        claims: dict[str, list[Claim]] = {}

        def resolve(entry: RosterEntry):
            try:
                return entry, self._resolve_profile(entry, http, manual_map, state), None
            except HttpError as error:
                return entry, None, error

        with ThreadPoolExecutor(max_workers=config.MAX_WORKERS) as pool:
            results = list(pool.map(resolve, roster))

        failures = 0
        for entry, profile, error in results:
            if error is not None:
                failures += 1
                outcome.unresolved.append(entry)
                continue
            if profile is None:
                outcome.unresolved.append(entry)
                continue
            slug, player_key, match = profile
            claims.setdefault(player_key, []).append((entry, match, slug))

        # Una fonte che ci chiude la porta lo fa per tutti: se nessuno e' passato
        # e i rifiuti sono piu' di una manciata, e' il sito che ci rifiuta, non
        # cinquecento giocatori introvabili.
        if failures >= 5 and not claims:
            outcome.failure = f"Transfermarkt irraggiungibile: {failures} richieste fallite"
            outcome.unresolved = list(roster)
            return {}, True

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
        state: CascadeState,
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

        # Un livello a monte puo' avere gia' identificato il giocatore per
        # esteso. E' la differenza fra cercare "Martinez", che restituisce una
        # pagina di Lautaro, Emiliano e Javi, e cercare "Josep Martinez", che
        # restituisce il portiere che stiamo cercando: la ricerca mostra dieci
        # risultati e chi non ci compare non e' recuperabile da nessuna euristica.
        tentativi = [query, *_search_variants(entry.name, query)]
        esteso = state.full_names.get(str(entry.id))
        if esteso:
            tentativi.insert(0, esteso)

        candidates: list[Candidate] = []
        slugs: dict[str, str] = {}
        for tentativo in tentativi:
            html = http.fetch(
                config.TRANSFERMARKT_SEARCH_URL,
                params={"query": tentativo},
                user_agent=config.BROWSER_USER_AGENT,
            )
            candidates, slugs = self._parse_search(html)
            if candidates:
                break

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

    # --- LIVELLO 3: rendimento grezzo ---------------------------------------

    def _fetch_performance(self, player_key: str, http: HttpClient) -> Optional[Performance]:
        """
        L'ultima spiaggia: gol, assist e minuti quando nessun altro li ha.

        `/ceapi/performance-game/<id>` e' la stessa sorgente JSON che alimenta la
        tabella "Rendimento" del sito, che il sito monta lato client: restituisce
        tutte le partite di carriera. L'endpoint risponde solo alle richieste
        marcate come AJAX — a una GET normale risponde 404, che sembrerebbe un
        giocatore inesistente.
        """
        raw = http.fetch(
            f"{config.TRANSFERMARKT_BASE}/ceapi/performance-game/{player_key}",
            user_agent=config.BROWSER_USER_AGENT,
            headers={
                "X-Requested-With": "XMLHttpRequest",
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Referer": config.TRANSFERMARKT_BASE,
            },
        )
        try:
            payload = json.loads(raw)
        except ValueError:
            return None

        matches = ((payload.get("data") or {}).get("performance")) or []
        return _performance_from_matches(matches, int(config.UNDERSTAT_SEASON))

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


def _performance_from_matches(
    matches: Sequence[dict[str, Any]], reference_season: int
) -> Optional[Performance]:
    """
    Aggrega le partite di una stagione in un rendimento. Puro: nessuna rete.

    Due filtri che sembrano dettagli e non lo sono. Le gare con la nazionale
    escono: un'asta di fantacalcio non le conta, e sommarle gonfierebbe presenze
    e gol di chi ha giocato un Mondiale. E si tiene la stagione *di riferimento*,
    non l'ultima in assoluto: a mercato in corso l'ultima e' quella appena
    cominciata, su cui non si costruisce nulla.
    """
    played = [
        m
        for m in matches
        if not (m.get("gameInformation") or {}).get("isNationalGame")
        and ((m.get("statistics") or {}).get("generalStatistics") or {}).get(
            "participationState"
        )
        == "played"
    ]
    if not played:
        return None

    seasons = {(m.get("gameInformation") or {}).get("seasonId") or 0 for m in played}
    eligible = [s for s in seasons if s <= reference_season] or list(seasons)
    chosen = max(eligible)
    season_matches = [
        m for m in played if (m.get("gameInformation") or {}).get("seasonId") == chosen
    ]

    def total(group: str, key: str) -> int:
        return sum(
            ((m.get("statistics") or {}).get(group) or {}).get(key) or 0
            for m in season_matches
        )

    # Rosso diretto e secondo giallo compaiono come chiavi dedicate solo nelle
    # partite in cui sono stati assegnati: si contano le partite, non un totale.
    espulsioni = sum(
        1
        for m in season_matches
        if ((m.get("statistics") or {}).get("cardStatistics") or {}).keys()
        & {"redCard", "yellowRedCard"}
    )

    return Performance(
        presenze=len(season_matches),
        minuti=total("playingTimeStatistics", "playedMinutes"),
        gol=total("goalStatistics", "goalsScoredTotal"),
        assist=total("goalStatistics", "assists"),
        ammonizioni=total("cardStatistics", "yellowCardNet"),
        espulsioni=espulsioni,
        # media_voto e fantamedia sono voti dei quotidiani italiani: Transfermarkt
        # non li ha, e restano null per costruzione.
    )
