"""
LIVELLO 1 — metriche avanzate da Understat (modelli xG su dati Opta).

--- Perche' cinque leghe e non una ---
Fino a ieri si leggeva la sola Serie A, e la copertura si fermava a 371 su 521.
Non era un difetto di matching: era un tetto strutturale. Chi arriva dall'estero
non ha righe nella Serie A della stagione conclusa, e nessuna correzione
dell'entity resolution puo' inventarle.

Le top 5 leghe europee costano cinque richieste *in tutto* — l'indice e' per
lega, non per giocatore — e sono anche il posto da cui la Serie A pesca la quasi
totalita' dei suoi acquisti. Il tetto diventa cosi' una lacuna piu' piccola, che
riguarda solo chi viene da fuori: per quelli c'e' il livello 2 (FBref).

I valori sono presi GREZZI: nessun "League Weighting", nessun moltiplicatore per
la lega di provenienza. Un xG in Ligue 1 e uno in Serie A entrano nel dataset
con lo stesso peso, e l'interpretazione resta all'utente in asta.

--- Cosa scrive, e cosa deliberatamente non scrive ---
`advanced` per chiunque risolva. Su `performance` invece si comporta in due modi:
per chi ha gia' il rendimento ufficiale da Fantacalcio.it scrive i soli `minuti`
(che sono l'unico campo che Fantacalcio.it non da', ed e' il denominatore di ogni
metrica per-90); per chi non ce l'ha — il giocatore straniero, appunto — scrive
tutto. Senza questa distinzione `builder.merge_section` sovrascriverebbe le
presenze ufficiali di Serie A con quelle di un'altra lega.
"""

from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional, Sequence

from .. import config
from ..http import HttpClient, HttpError
from ..model import (
    Advanced,
    CascadeState,
    Contribution,
    Performance,
    RosterEntry,
    Section,
)
from ..normalize import normalize_teams
from ..resolver import Candidate, EntityResolver, make_candidate
from .base import ProviderOutcome

# Understat usa le posizioni anglosassoni; "S" (substitute) non e' un ruolo e
# compare sempre in coda a quello vero ("F S").
POSITION_TO_ROLE = {"GK": "P", "D": "D", "M": "C", "F": "A"}

# La pagina serve i dati inline come: <nome> = JSON.parse('\x5B\x7B...').
# Il nome del blocco e' un parametro e non una costante: la stessa pagina ne
# contiene piu' d'uno (`playersData`, `teamsData`) e `coaches.py` ha bisogno di
# quello delle squadre.
def _json_block_pattern(name: str) -> "re.Pattern[str]":
    return re.compile(rf"{re.escape(name)}\s*=\s*JSON\.parse\(\s*'(.*?)'\s*\)", re.DOTALL)


def role_of(position: str) -> Optional[str]:
    """
    Il ruolo principale da una posizione Understat ("F S" -> "A", "M" -> "C").

    Pubblica perche' la usa anche `coaches.py`, che classifica i marcatori per
    reparto: duplicarne le quattro righe significherebbe poter cambiare la mappa
    dei ruoli in un posto solo su due, e accorgersene molto dopo.
    """
    for token in position.split():
        role = POSITION_TO_ROLE.get(token)
        if role is not None:
            return role
    return None


def _to_float(value: object) -> Optional[float]:
    try:
        return round(float(str(value)), 3)
    except (TypeError, ValueError):
        return None


def _to_int(value: object) -> Optional[int]:
    try:
        return int(float(str(value)))
    except (TypeError, ValueError):
        return None


def decode_escapes(raw: str) -> str:
    """
    Scioglie gli escape \\xNN con cui Understat serializza il JSON inline.

    `unicode_escape` li scioglie ma tratta ogni byte come latin-1: il giro
    latin-1 -> utf-8 ricostruisce gli accenti, senza il quale "Martínez"
    arriverebbe storpiato e non combacerebbe con nulla.
    """
    unescaped = raw.encode("utf-8", "backslashreplace").decode("unicode_escape")
    try:
        return unescaped.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return unescaped


def extract_json_block(html: str, name: str) -> Optional[Any]:
    """
    Isola un blocco `<nome> = JSON.parse('...')` dall'HTML; None se non c'e'.

    E' la via storica. Quando Understat sposta i dati su XHR il blocco sparisce,
    e None e' il segnale per passare all'endpoint JSON invece di concludere che
    la lega e' vuota — che sono due situazioni molto diverse, e confonderle fa
    perdere una lega intera in silenzio.
    """
    found = _json_block_pattern(name).search(html)
    if not found:
        return None
    try:
        return json.loads(decode_escapes(found.group(1)))
    except ValueError:
        return None


def extract_players_data(html: str) -> Optional[list[dict[str, Any]]]:
    """Il blocco dei giocatori: un caso particolare di `extract_json_block`."""
    parsed = extract_json_block(html, "playersData")
    return parsed if isinstance(parsed, list) else None


class UnderstatProvider:
    name = "understat"

    def collect(
        self,
        roster: Sequence[RosterEntry],
        http: HttpClient,
        manual_map: dict[str, dict[str, str]],
        state: CascadeState,
    ) -> ProviderOutcome:
        outcome = ProviderOutcome()
        season = int(config.UNDERSTAT_SEASON)

        players, failures = self._download_all_leagues(http, season)
        if not players:
            outcome.failure = "; ".join(failures) or "Understat non ha restituito giocatori"
            outcome.unresolved = list(roster)
            return outcome

        by_key = {self._key(p): p for p in players}
        candidates = [
            make_candidate(
                key=self._key(p),
                raw_name=str(p.get("player_name", "")),
                teams=normalize_teams(str(p.get("team_title", ""))),
                role=role_of(str(p.get("position", ""))),
            )
            for p in players
        ]

        resolver = EntityResolver(self.name, candidates, manual_map)
        matches = resolver.resolve_all(roster)
        outcome.matches = matches
        outcome.unresolved = resolver.unresolved

        for player_id, match in matches.items():
            raw = by_key.get(match.candidate.key)
            if raw is None:
                continue

            outcome.contributions[player_id] = Contribution(
                advanced=Advanced(
                    xg=_to_float(raw.get("xG")),
                    npxg=_to_float(raw.get("npxG")),
                    xa=_to_float(raw.get("xA")),
                    xg_chain=_to_float(raw.get("xGChain")),
                    xg_buildup=_to_float(raw.get("xGBuildup")),
                    tiri=_to_int(raw.get("shots")),
                    key_passes=_to_int(raw.get("key_passes")),
                ),
                performance=self._performance(raw, player_id, state),
            )
            # Il nome per esteso serve al livello 3: la ricerca di Transfermarkt
            # mostra dieci risultati per pagina, e "Martinez" da solo restituisce
            # Lautaro, Emiliano e Javi — ma non Josep.
            full_name = str(raw.get("player_name") or "").strip()
            if full_name:
                state.full_names[str(player_id)] = full_name

        return outcome

    def _performance(
        self, raw: dict[str, Any], player_id: int, state: CascadeState
    ) -> Performance:
        minuti = _to_int(raw.get("time"))

        # Chi ha gia' il rendimento ufficiale di Serie A riceve i soli minuti:
        # sono l'unico campo che Fantacalcio.it non pubblica, e sovrascrivere il
        # resto significherebbe rimpiazzare le presenze italiane con quelle di
        # un'altra lega.
        if state.covers(player_id, Section.PERFORMANCE):
            return Performance(minuti=minuti)

        # Altrimenti e' un giocatore che in Serie A non ha giocato: qui Understat
        # e' l'unica fonte di rendimento che abbiamo.
        #
        # `media_voto` e `fantamedia` restano null e non e' una dimenticanza:
        # sono voti dei quotidiani sportivi italiani, non esistono per la Ligue 1.
        return Performance(
            presenze=_to_int(raw.get("games")),
            minuti=minuti,
            gol=_to_int(raw.get("goals")),
            assist=_to_int(raw.get("assists")),
            ammonizioni=_to_int(raw.get("yellow_cards")),
            espulsioni=_to_int(raw.get("red_cards")),
        )

    # --- Scaricamento delle leghe -------------------------------------------

    def _key(self, player: dict[str, Any]) -> str:
        """
        L'id Understat e' unico per giocatore ma *non* per riga: lo stesso
        giocatore compare una volta per lega in cui ha giocato. La lega entra
        quindi nella chiave, o due righe si sovrascriverebbero nell'indice.
        """
        return f"{player.get('_lega')}:{player.get('id')}"

    def _download_all_leagues(
        self, http: HttpClient, season: int
    ) -> tuple[list[dict[str, Any]], list[str]]:
        """Le cinque leghe in parallelo, unite in un unico elenco."""
        players: list[dict[str, Any]] = []
        failures: list[str] = []

        with ThreadPoolExecutor(max_workers=config.MAX_WORKERS) as pool:
            results = pool.map(
                lambda league: self._download_league(http, league, season),
                config.UNDERSTAT_LEAGUES,
            )
            for league, (rows, error) in zip(config.UNDERSTAT_LEAGUES, results):
                if error:
                    failures.append(f"{league}: {error}")
                players.extend(rows)

        return players, failures

    def _download_league(
        self, http: HttpClient, league: str, season: int
    ) -> tuple[list[dict[str, Any]], Optional[str]]:
        """
        Una lega, con ripiego sulla stagione precedente se quella scelta e' vuota.

        Understat pubblica la stagione nuova appena esiste il calendario, quindi
        prima della prima giornata l'elenco torna vuoto. In quel caso l'unica
        cosa utile e' la stagione precedente — meglio metriche di un anno fa che
        nessuna metrica.
        """
        for attempt_season in (season, season - 1):
            try:
                rows = self._fetch_season(http, league, attempt_season)
            except HttpError as error:
                return [], str(error)
            if rows:
                for row in rows:
                    row["_lega"] = league
                    row["_stagione"] = attempt_season
                return rows, None
        return [], None

    def _fetch_season(
        self, http: HttpClient, league: str, season: int
    ) -> list[dict[str, Any]]:
        """
        Due strade per lo stesso dato, e servono entrambe.

        Storicamente la pagina stampava `playersData` in uno <script>; oggi
        alcune leghe lo caricano via XHR da `getLeagueData`, che risponde solo
        alle richieste marcate come AJAX. Provare la seconda solo dopo un buco
        della prima e' cio' che rende il provider indifferente a quale delle due
        Understat stia servendo in questo momento.
        """
        page_url = f"{config.UNDERSTAT_BASE}/league/{league}/{season}"

        html = http.fetch(page_url, user_agent=config.BROWSER_USER_AGENT)
        inline = extract_players_data(html)
        if inline:
            return inline

        raw = http.fetch(
            f"{config.UNDERSTAT_BASE}/getLeagueData/{league}/{season}",
            user_agent=config.BROWSER_USER_AGENT,
            headers={
                "X-Requested-With": "XMLHttpRequest",
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Referer": page_url,
            },
        )
        try:
            payload = json.loads(raw)
        except ValueError:
            return []
        return payload.get("players") or [] if isinstance(payload, dict) else []
