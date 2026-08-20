"""
LIVELLO 2 — FBref, per chi gioca fuori dalle top 5 leghe.

--- Chi copre, e perche' esiste ---
Il livello 1 conosce Serie A, Premier, Liga, Bundesliga e Ligue 1. Restano fuori
la Serie B, le seconde divisioni europee e il resto del mondo: un acquisto dal
Brasile o dalla Serie B non ha una riga su Understat, e senza questo livello
arriverebbe all'utente con le otto metriche a null.

Gira **solo** su chi il livello 1 non ha risolto (`state.pending`). Non e' una
ottimizzazione: FBref costa due richieste per giocatore, e farlo girare sui 400
gia' coperti significherebbe ottocento richieste per riscrivere dati che
abbiamo — a un sito che ci chiude la porta proprio quando si insiste.

--- L'interruttore automatico ---
FBref sta dietro Cloudflare e da certi indirizzi risponde 403 ("managed
challenge") a qualunque richiesta non fatta da un browser. Quando succede,
succede per tutti: insistere costa tre secondi a giocatore per nulla. Dopo
`config.FBREF_MAX_FAILURES` rifiuti consecutivi il livello si spegne da solo per
il resto della corsa e tutti passano al livello 3.

Un livello 2 spento non e' una regressione rispetto a ieri: fino a ieri non
c'era. E' per questo che il fallimento finisce in `ProviderOutcome.failure` — lo
dice il report — ma il gate di rilascio non lo tratta come una fonte caduta,
visto che la sua baseline e' zero.

--- Cosa non pubblica ---
`xg_chain` e `xg_buildup` restano null per costruzione: FBref non li calcola.
E' la differenza che resta fra un giocatore risolto al livello 1 e uno al
livello 2, e va lasciata visibile invece di riempirla con degli zeri.
"""

from __future__ import annotations

import difflib
import re
import threading
from typing import Optional, Sequence
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Comment

from .. import config
from ..http import HttpClient, HttpError, HttpResponse
from ..model import (
    Advanced,
    CascadeState,
    Contribution,
    Performance,
    RosterEntry,
    Section,
)
from ..normalize import normalize_text, parse_listone_name
from ..resolver import Match, make_candidate
from .base import ProviderOutcome

# Le schede hanno la forma /en/players/<8 esadecimali>/<Nome-Cognome>.
PLAYER_HREF = re.compile(r"/en/players/([0-9a-f]{8})/([^/?#]+)")

# Colonne della tabella "Standard Stats", per `data-stat`.
STANDARD_FIELDS = {
    "presenze": "games",
    "minuti": "minutes",
    "gol": "goals",
    "assist": "assists",
    "gialli": "cards_yellow",
    "rossi": "cards_red",
    "xg": "xg",
    "npxg": "npxg",
    "xa": "xg_assist",
}
SHOOTING_FIELDS = {"tiri": "shots"}
PASSING_FIELDS = {"passaggi_chiave": "assisted_shots"}

# Sotto questa somiglianza, e senza conferma della squadra, il risultato non e'
# attendibile: meglio nessun dato che il dato di un altro.
MIN_SIMILARITY = 0.6


def _to_number(text: Optional[str]) -> Optional[float]:
    if text is None:
        return None
    cleaned = text.strip().replace(",", "")
    if not cleaned or cleaned in {"-", "—"}:
        return None
    try:
        value = float(cleaned)
    except ValueError:
        return None
    return int(value) if value.is_integer() else round(value, 3)


def _to_int(text: Optional[str]) -> Optional[int]:
    value = _to_number(text)
    return None if value is None else int(round(value))


def _add(total: Optional[float], addend: Optional[float]) -> Optional[float]:
    """Somma tollerante ai None: None + 3 = 3, None + None = None."""
    if addend is None:
        return total
    return addend if total is None else round(total + addend, 3)


def season_start_year(text: Optional[str]) -> Optional[int]:
    """'2024-2025' -> 2024; '2025' -> 2025 (campionati a stagione solare)."""
    text = (text or "").strip()
    found = re.match(r"(\d{4})-\d{2,4}", text)
    if found:
        return int(found.group(1))
    return int(text) if re.fullmatch(r"\d{4}", text) else None


def soup_of(html: str) -> BeautifulSoup:
    try:
        return BeautifulSoup(html, "lxml")
    except Exception:
        return BeautifulSoup(html, "html.parser")


def tables_by_id(html: str) -> dict[str, BeautifulSoup]:
    """
    Tutte le <table> con id, quelle dentro i commenti HTML comprese.

    FBref serve la maggior parte delle tabelle commentate — le monta il
    javascript del sito. Senza riparsare i commenti si vedrebbe solo la prima, e
    tiri e passaggi chiave sarebbero sempre null.
    """
    page = soup_of(html)
    tables: dict[str, BeautifulSoup] = {}

    def register(root) -> None:
        for table in root.find_all("table"):
            ident = table.get("id")
            if ident and ident not in tables:
                tables[ident] = table

    register(page)
    for comment in page.find_all(string=lambda t: isinstance(t, Comment)):
        if "<table" in comment:
            register(soup_of(str(comment)))
    return tables


def table_by_prefix(tables: dict[str, BeautifulSoup], prefix: str):
    """
    La tabella piu' pertinente fra le varianti dello stesso gruppo.

    FBref pubblica 'stats_standard_dom_lg' (campionato), '..._dom_cup' (coppa
    nazionale), '..._intl_cup': interessa il campionato.
    """
    for preferred in (f"{prefix}_dom_lg", prefix, f"{prefix}_expanded"):
        if preferred in tables:
            return tables[preferred]
    keys = sorted(k for k in tables if k.startswith(prefix))
    return tables[keys[0]] if keys else None


def _cell(row, stat: str) -> Optional[str]:
    cell = row.find(attrs={"data-stat": stat})
    if cell is None:
        return None
    return cell.get_text(" ", strip=True) or None


def aggregate_by_season(table, fields: dict[str, str]) -> dict[int, dict[str, Optional[float]]]:
    """
    {anno: {campo: totale}}, sommando le righe della stessa stagione.

    Una stagione puo' comparire su piu' righe — cambio di squadra a gennaio,
    doppia competizione — e i totali vanno sommati, non sovrascritti: chi si
    trasferisce a metà anno risulterebbe altrimenti con mezzo campionato.
    """
    by_year: dict[int, dict[str, Optional[float]]] = {}
    if table is None:
        return by_year

    body = table.find("tbody") or table
    for row in body.find_all("tr"):
        if "thead" in (row.get("class") or []):
            continue
        raw_season = _cell(row, "year_id") or _cell(row, "season")
        if raw_season is None:
            header = row.find("th")
            raw_season = header.get_text(" ", strip=True) if header else None
        year = season_start_year(raw_season)
        if year is None:
            continue  # righe 'Total', 'Career', separatori
        totals = by_year.setdefault(year, {})
        for key, stat in fields.items():
            totals[key] = _add(totals.get(key), _to_number(_cell(row, stat)))
    return by_year


class FbrefProvider:
    name = "fbref"

    def __init__(self) -> None:
        # Lo stato dell'interruttore e' condiviso fra i thread. Nel PoC erano
        # due variabili globali; qui sono d'istanza, cosi' due esecuzioni nello
        # stesso processo (i test) non si contaminano a vicenda.
        self._lock = threading.Lock()
        self._consecutive_failures = 0
        self._open = False

    # --- Interruttore automatico --------------------------------------------

    @property
    def tripped(self) -> bool:
        with self._lock:
            return self._open

    def _record(self, refused: bool) -> None:
        with self._lock:
            if not refused:
                self._consecutive_failures = 0
                return
            self._consecutive_failures += 1
            if self._consecutive_failures >= config.FBREF_MAX_FAILURES:
                self._open = True

    def _get(self, url: str, **kwargs) -> Optional[HttpResponse]:
        """
        Una GET verso FBref, o None se il livello e' spento o la porta e' chiusa.

        Il distanziamento non e' qui: `config.HOST_LIMITS` pinna fbref.com a un
        solo slot ogni tre secondi, quindi la coda si forma nella porta di rete e
        vale anche per le richieste che partono da altri thread.
        """
        if self.tripped:
            return None
        try:
            response = self._get_raw(url, **kwargs)
        except HttpError as error:
            # 403 e 503 sono Cloudflare che ci respinge, ed e' la sola cosa che
            # deve far scattare l'interruttore: un 404 e' un giocatore che non
            # c'e', e non dice nulla sulla nostra possibilita' di leggere il sito.
            self._record(refused=error.status in (403, 503))
            return None
        self._record(refused=False)
        return response

    def _get_raw(self, url: str, **kwargs) -> HttpResponse:
        return self._http.fetch_response(
            url, user_agent=config.BROWSER_USER_AGENT, **kwargs
        )

    # --- Raccolta ------------------------------------------------------------

    def collect(
        self,
        roster: Sequence[RosterEntry],
        http: HttpClient,
        manual_map: dict[str, dict[str, str]],
        state: CascadeState,
    ) -> ProviderOutcome:
        self._http = http
        outcome = ProviderOutcome()

        pending = state.pending(roster, Section.ADVANCED)
        if not pending:
            return outcome

        # Serializzato di proposito, a differenza degli altri provider: la porta
        # di rete concede a fbref.com un solo slot, quindi quattro thread si
        # metterebbero comunque in fila — pagando in piu' il costo di restare
        # appesi a un semaforo.
        for entry in pending:
            if self.tripped:
                break
            try:
                result = self._collect_one(entry, manual_map)
            except Exception:  # un giocatore rotto non ferma gli altri
                result = None

            if result is None:
                outcome.unresolved.append(entry)
                continue

            contribution, match = result
            outcome.contributions[entry.id] = contribution
            outcome.matches[entry.id] = match

        # Chi resta dopo che l'interruttore e' scattato non e' "non trovato":
        # non e' stato nemmeno cercato. Va detto, o il report farebbe credere a
        # un problema di matching.
        already = set(outcome.contributions) | {e.id for e in outcome.unresolved}
        outcome.unresolved.extend(e for e in pending if e.id not in already)

        if self.tripped:
            outcome.failure = (
                f"FBref ha respinto {config.FBREF_MAX_FAILURES} richieste consecutive "
                "(Cloudflare): livello 2 disattivato per il resto della corsa"
            )

        return outcome

    def _collect_one(
        self, entry: RosterEntry, manual_map: dict[str, dict[str, str]]
    ) -> Optional[tuple[Contribution, Match]]:
        forced = manual_map.get(self.name, {}).get(str(entry.id))
        url = (
            f"{config.FBREF_BASE}/en/players/{forced}/"
            if forced
            else self._search(entry)
        )
        if url is None:
            return None

        response = self._get(url)
        if response is None:
            return None

        parsed = self._parse_profile(response.text)
        if parsed is None:
            return None

        performance, advanced = parsed
        candidate = make_candidate(
            key=url, raw_name=entry.name, teams=set(), role=entry.role
        )
        strategy = "mappa-manuale" if forced else "ricerca-fbref"
        return (
            Contribution(performance=performance, advanced=advanced),
            Match(candidate=candidate, confidence=1.0 if forced else 0.8, strategy=strategy),
        )

    # --- Ricerca -------------------------------------------------------------

    def _search(self, entry: RosterEntry) -> Optional[str]:
        """
        URL della scheda, oppure None.

        Con un solo risultato FBref reindirizza direttamente alla scheda: si
        guarda quindi l'URL finale della risposta prima di parsare una lista di
        risultati che in quel caso non esiste.
        """
        parsed = parse_listone_name(entry.name)
        query = parsed.surname or entry.name

        response = self._get(config.FBREF_SEARCH_URL, params={"search": query})
        if response is None:
            return None

        if PLAYER_HREF.search(response.url):
            return response.url

        return self._best_result(response.text, query, entry.team)

    def _best_result(self, html: str, query: str, team: str) -> Optional[str]:
        candidates: list[tuple[str, str, str]] = []
        for item in soup_of(html).select("div.search-item"):
            link = item.select_one('a[href*="/en/players/"]')
            if link is None:
                continue
            href = link.get("href", "")
            if not PLAYER_HREF.search(href):
                continue
            candidates.append(
                (
                    urljoin(config.FBREF_BASE, href),
                    link.get_text(" ", strip=True),
                    item.get_text(" ", strip=True),
                )
            )

        if not candidates:
            return None

        expected = normalize_text(query)
        team_key = normalize_text(team)

        def score(candidate: tuple[str, str, str]) -> tuple[bool, float]:
            _url, title, text = candidate
            similarity = difflib.SequenceMatcher(
                None, expected, normalize_text(title)
            ).ratio()
            return bool(team_key) and team_key in normalize_text(text), round(similarity, 3)

        best = max(candidates, key=score)
        team_ok, similarity = score(best)
        # La squadra conferma da sola: un omonimo nella stessa squadra non e' un
        # omonimo. Senza conferma serve invece che il nome combaci davvero.
        if not team_ok and similarity < MIN_SIMILARITY:
            return None
        return best[0]

    # --- Scheda giocatore ----------------------------------------------------

    def _parse_profile(self, html: str) -> Optional[tuple[Performance, Advanced]]:
        tables = tables_by_id(html)
        standard = aggregate_by_season(
            table_by_prefix(tables, "stats_standard"), STANDARD_FIELDS
        )
        if not standard:
            return None

        # Stessa regola degli altri livelli: la stagione di riferimento, non
        # quella in corso da due giornate — su cui non si costruisce un'asta.
        played = {
            year: values for year, values in standard.items() if (values.get("minuti") or 0) > 0
        }
        if not played:
            return None

        reference = int(config.UNDERSTAT_SEASON)
        eligible = [y for y in played if y <= reference] or list(played)
        year = max(eligible)
        values = played[year]

        shots = aggregate_by_season(
            table_by_prefix(tables, "stats_shooting"), SHOOTING_FIELDS
        ).get(year, {})
        passes = aggregate_by_season(
            table_by_prefix(tables, "stats_passing"), PASSING_FIELDS
        ).get(year, {})

        performance = Performance(
            presenze=_int_of(values.get("presenze")),
            minuti=_int_of(values.get("minuti")),
            gol=_int_of(values.get("gol")),
            assist=_int_of(values.get("assist")),
            ammonizioni=_int_of(values.get("gialli")),
            espulsioni=_int_of(values.get("rossi")),
        )
        advanced = Advanced(
            xg=values.get("xg"),
            npxg=values.get("npxg"),
            xa=values.get("xa"),
            tiri=_int_of(shots.get("tiri")),
            key_passes=_int_of(passes.get("passaggi_chiave")),
            # FBref non calcola xGChain e xGBuildup: restano null, e la
            # differenza con un giocatore risolto al livello 1 resta visibile.
            xg_chain=None,
            xg_buildup=None,
        )
        return performance, advanced


def _int_of(value: Optional[float]) -> Optional[int]:
    return None if value is None else int(round(value))
