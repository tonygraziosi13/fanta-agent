"""
Metriche avanzate da Understat (modelli xG su dati Opta).

Una sola richiesta per l'intera lega: l'endpoint che alimenta la tabella del
sito restituisce tutti i giocatori della stagione in un JSON. Costo trascurabile
e nessuna pagina da fare a pezzi.

Qui l'entity resolution serve davvero: Understat scrive i nomi per esteso
("Lautaro Martínez") mentre il listone usa cognome e iniziale ("Martinez L.").
Il lavoro sporco sta in `resolver.py`; questo file si limita a preparare i
candidati con ruolo e squadre, che sono i due dati che permettono al resolver di
disambiguare.
"""

from __future__ import annotations

from typing import Optional, Sequence

from .. import config
from ..http import HttpClient, HttpError
from ..model import Advanced, Contribution, Performance, RosterEntry
from ..normalize import normalize_team, normalize_teams
from ..resolver import Candidate, EntityResolver, make_candidate
from .base import ProviderOutcome

# Understat usa le posizioni anglosassoni; "S" (substitute) non e' un ruolo e
# compare sempre in coda a quello vero ("F S").
POSITION_TO_ROLE = {"GK": "P", "D": "D", "M": "C", "F": "A"}


def _role_of(position: str) -> Optional[str]:
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


class UnderstatProvider:
    name = "understat"

    def collect(
        self,
        roster: Sequence[RosterEntry],
        http: HttpClient,
        manual_map: dict[str, dict[str, str]],
    ) -> ProviderOutcome:
        outcome = ProviderOutcome()

        try:
            payload = http.fetch_json(
                config.UNDERSTAT_URL,
                method="POST",
                data={"league": config.UNDERSTAT_LEAGUE, "season": config.UNDERSTAT_SEASON},
                headers={
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": f"https://understat.com/league/{config.UNDERSTAT_LEAGUE}",
                },
            )
        except HttpError as error:
            outcome.failure = str(error)
            outcome.unresolved = list(roster)
            return outcome

        players = payload.get("players", []) if isinstance(payload, dict) else []
        by_key = {str(p.get("id")): p for p in players}

        candidates: list[Candidate] = [
            make_candidate(
                key=str(p.get("id")),
                raw_name=str(p.get("player_name", "")),
                teams=normalize_teams(str(p.get("team_title", ""))),
                role=_role_of(str(p.get("position", ""))),
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
                # I minuti giocati arrivano solo da qui, e sono il denominatore
                # di ogni metrica per-90: senza, xG e gol non sono confrontabili
                # fra un titolare e chi entra dalla panchina.
                performance=Performance(minuti=_to_int(raw.get("time"))),
            )

        return outcome
