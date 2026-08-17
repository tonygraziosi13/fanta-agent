"""
Registro dei provider.

L'orchestratore itera su questa lista e non conosce nessuna fonte in concreto:
e' l'unico punto da toccare per aggiungerne una. L'ordine conta solo per la
leggibilita' del report — il merge dei contributi e' commutativo.
"""

from __future__ import annotations

from .base import ProviderOutcome, StatsProvider
from .fantacalcio_stats import FantacalcioStatsProvider
from .sofascore import SofascoreProvider
from .transfermarkt import TransfermarktProvider
from .understat import UnderstatProvider

ALL_PROVIDERS: tuple[StatsProvider, ...] = (
    FantacalcioStatsProvider(),
    UnderstatProvider(),
    TransfermarktProvider(),
    SofascoreProvider(),
)


def select(names: list[str] | None) -> tuple[StatsProvider, ...]:
    """`--only understat,transfermarkt` -> solo quei due, nell'ordine del registro."""
    if not names:
        return ALL_PROVIDERS
    wanted = {n.strip().lower() for n in names}
    return tuple(p for p in ALL_PROVIDERS if p.name in wanted)


__all__ = ["ALL_PROVIDERS", "ProviderOutcome", "StatsProvider", "select"]
