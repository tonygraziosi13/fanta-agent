"""
Rendimento storico ufficiale da Fantacalcio.it.

--- Il provider privilegiato, e il motivo ---
E' l'unica fonte che espone lo *stesso* identificativo del listone: l'URL di
ogni giocatore contiene l'id ("/malen/5585/2025-26") e quell'id e' la colonna
`Id` del CSV. E' l'"identificativo univoco primario" di cui parla US19-2, quindi
qui l'entity resolution non serve: si fa una join esatta.

Le altre fonti si agganciano per nome e possono sbagliare; questa no.
"""

from __future__ import annotations

import re
from typing import Optional, Sequence

from bs4 import BeautifulSoup

from .. import config
from ..http import HttpClient, HttpError
from ..model import Contribution, Performance, RosterEntry
from ..resolver import Candidate, Match, make_candidate
from .base import ProviderOutcome

PLAYER_ID_IN_HREF = re.compile(r"/(\d+)/\d{4}-\d{2}/?$")


def _to_float(text: str) -> Optional[float]:
    """Le medie usano la virgola decimale italiana; "-" significa assente."""
    cleaned = text.strip().replace(",", ".")
    if not cleaned or cleaned in {"-", "—"}:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _to_int(text: str) -> Optional[int]:
    value = _to_float(text)
    return None if value is None else int(value)


class FantacalcioStatsProvider:
    name = "fantacalcio"

    def collect(
        self,
        roster: Sequence[RosterEntry],
        http: HttpClient,
        manual_map: dict[str, dict[str, str]],
    ) -> ProviderOutcome:
        outcome = ProviderOutcome()

        try:
            html = http.fetch(
                config.FANTACALCIO_STATS_URL, user_agent=config.BROWSER_USER_AGENT
            )
        except HttpError as error:
            outcome.failure = str(error)
            outcome.unresolved = list(roster)
            return outcome

        stats_by_id = self._parse(html)

        for entry in roster:
            row = stats_by_id.get(entry.id)
            if row is None:
                # Nessuna riga = nessuna presenza in Serie A quella stagione.
                # E' il caso dei neoacquisti dall'estero e dei giovani promossi:
                # va dichiarato, non riempito di zeri.
                outcome.unresolved.append(entry)
                continue

            outcome.contributions[entry.id] = Contribution(performance=row["performance"])
            outcome.matches[entry.id] = Match(
                candidate=row["candidate"], confidence=1.0, strategy="id-ufficiale"
            )

        return outcome

    def _parse(self, html: str) -> dict[int, dict]:
        soup = BeautifulSoup(html, "lxml")
        table = soup.find("table", id="stats")
        if table is None or table.find("tbody") is None:
            return {}

        result: dict[int, dict] = {}
        for tr in table.find("tbody").find_all("tr"):
            link = tr.select_one("th.player-name a")
            if link is None:
                continue
            match = PLAYER_ID_IN_HREF.search(link.get("href", ""))
            if match is None:
                continue

            player_id = int(match.group(1))
            # `data-col-key` e' l'ancora stabile: l'ordine delle colonne cambia
            # quando il sito aggiunge una statistica, il nome della chiave no.
            cells = {
                td.get("data-col-key"): td.get_text(" ", strip=True)
                for td in tr.find_all("td")
                if td.get("data-col-key")
            }

            team = cells.get("sq", "")
            result[player_id] = {
                "performance": Performance(
                    presenze=_to_int(cells.get("pg", "")),
                    media_voto=_to_float(cells.get("mv", "")),
                    fantamedia=_to_float(cells.get("mfv", "")),
                    gol=_to_int(cells.get("gol", "")),
                    assist=_to_int(cells.get("ass", "")),
                    ammonizioni=_to_int(cells.get("amm", "")),
                    espulsioni=_to_int(cells.get("esp", "")),
                ),
                "candidate": make_candidate(
                    key=str(player_id),
                    raw_name=link.get_text(strip=True),
                    teams={team.lower()},
                ),
            }

        return result
