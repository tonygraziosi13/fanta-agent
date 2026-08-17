"""
Heatmap posizionali da SofaScore.

--- Stato verificato al 17/08/2026: la fonte ci rifiuta ---
`api.sofascore.com` risponde 403 a qualunque richiesta programmatica, e lo fa
anche dietro un User-Agent da browser. Il provider e' scritto per intero e
resta registrato, ma degrada: dichiara il fallimento nel report, lascia
`coverage.sofascore = false` e la pipeline prosegue senza heatmap.

Non si va oltre di proposito: aggirare una protezione anti-bot per prendere dati
che il sito non vuole cedere in questo modo e' una scelta diversa dallo
scraping di pagine pubbliche, e non e' questo lo scopo del progetto. Se la
fonte tornera' accessibile — o se si vorra' sostituirla — cambia un file solo.

La conversione da punti a griglia avviene qui, non nell'app: US19-3 vuole i
calcoli a monte, e l'app deve solo colorare cinquanta celle.
"""

from __future__ import annotations

from typing import Optional, Sequence

from .. import config
from ..http import HttpClient, HttpError
from ..model import Contribution, Heatmap, RosterEntry
from ..normalize import normalize_team, parse_listone_name
from ..resolver import Candidate, EntityResolver, make_candidate
from .base import ProviderOutcome


class SofascoreProvider:
    name = "sofascore"

    def collect(
        self,
        roster: Sequence[RosterEntry],
        http: HttpClient,
        manual_map: dict[str, dict[str, str]],
    ) -> ProviderOutcome:
        outcome = ProviderOutcome()

        try:
            season_id = self._season_id(http)
        except HttpError as error:
            outcome.failure = f"SofaScore non raggiungibile: {error}"
            outcome.unresolved = list(roster)
            return outcome

        if season_id is None:
            outcome.failure = f"Stagione {config.STATS_SEASON} non trovata su SofaScore."
            outcome.unresolved = list(roster)
            return outcome

        for entry in roster:
            try:
                player_key = self._resolve_player(entry, http, manual_map)
                if player_key is None:
                    outcome.unresolved.append(entry)
                    continue
                heatmap = self._fetch_heatmap(player_key, season_id, http)
            except HttpError:
                outcome.unresolved.append(entry)
                continue

            if heatmap is None:
                outcome.unresolved.append(entry)
                continue

            outcome.contributions[entry.id] = Contribution(heatmap=heatmap)

        return outcome

    def _season_id(self, http: HttpClient) -> Optional[int]:
        payload = http.fetch_json(
            f"{config.SOFASCORE_API}/unique-tournament/{config.SOFASCORE_TOURNAMENT_ID}/seasons",
            headers={"Referer": "https://www.sofascore.com/"},
            user_agent=config.BROWSER_USER_AGENT,
        )
        # "2025-26" nel nostro config, "25/26" nel loro `year`.
        start, end = config.STATS_SEASON.split("-")
        wanted = f"{start[-2:]}/{end}"
        for season in payload.get("seasons", []):
            if season.get("year") == wanted:
                return season.get("id")
        return None

    def _resolve_player(
        self,
        entry: RosterEntry,
        http: HttpClient,
        manual_map: dict[str, dict[str, str]],
    ) -> Optional[str]:
        parsed = parse_listone_name(entry.name)
        payload = http.fetch_json(
            f"{config.SOFASCORE_API}/search/all",
            params={"q": parsed.surname or entry.name},
            headers={"Referer": "https://www.sofascore.com/"},
            user_agent=config.BROWSER_USER_AGENT,
        )

        candidates: list[Candidate] = []
        for result in payload.get("results", []):
            if result.get("type") != "player":
                continue
            player = result.get("entity", {})
            team = player.get("team", {}).get("name", "")
            candidates.append(
                make_candidate(
                    key=str(player.get("id")),
                    raw_name=str(player.get("name", "")),
                    teams={normalize_team(team)},
                    role="P" if player.get("position") == "G" else None,
                )
            )

        if not candidates:
            return None

        resolver = EntityResolver(self.name, candidates, manual_map)
        match = resolver.resolve(entry, normalize_team(entry.team))
        return match.candidate.key if match else None

    def _fetch_heatmap(
        self, player_key: str, season_id: int, http: HttpClient
    ) -> Optional[Heatmap]:
        payload = http.fetch_json(
            f"{config.SOFASCORE_API}/player/{player_key}/unique-tournament/"
            f"{config.SOFASCORE_TOURNAMENT_ID}/season/{season_id}/heatmap/overall",
            headers={"Referer": "https://www.sofascore.com/"},
            user_agent=config.BROWSER_USER_AGENT,
        )
        points = payload.get("points", [])
        return build_heatmap(points) if points else None


def build_heatmap(
    points: Sequence[dict],
    rows: int = config.HEATMAP_ROWS,
    cols: int = config.HEATMAP_COLS,
) -> Optional[Heatmap]:
    """
    Aggrega i punti (x, y in 0..100) in una griglia di intensita' 0..1.

    Funzione separata dal provider — e senza rete — perche' e' l'unica parte
    davvero testabile di questo file, ed e' quella che l'app disegna.
    """
    cells = [0.0] * (rows * cols)
    if not points:
        return None

    for point in points:
        try:
            x = float(point.get("x", 0))
            y = float(point.get("y", 0))
        except (TypeError, ValueError):
            continue

        count = float(point.get("count", 1) or 1)
        # x corre lungo la lunghezza del campo, y lungo la larghezza. La griglia
        # e' verticale (attacco in alto), come la si disegna in app.
        col = min(int(y / 100 * cols), cols - 1)
        row = min(int(x / 100 * rows), rows - 1)
        cells[row * cols + col] += count

    peak = max(cells)
    if peak <= 0:
        return None

    # Normalizzata sul proprio massimo: la heatmap dice *dove* gioca questo
    # giocatore, non quanto gioca rispetto agli altri.
    return Heatmap(rows=rows, cols=cols, cells=[round(c / peak, 3) for c in cells])
