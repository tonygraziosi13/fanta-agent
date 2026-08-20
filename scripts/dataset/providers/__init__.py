"""
Registro dei provider.

L'orchestratore itera su questa lista e non conosce nessuna fonte in concreto:
e' l'unico punto da toccare per aggiungerne una.

--- L'ordine ora conta ---
Fino a ieri no: ogni fonte girava su tutto il listone e il merge era
commutativo. Con la cascata a tre livelli l'ordine e' invece la cascata stessa,
perche' ogni provider legge in `CascadeState` cosa i precedenti hanno gia'
coperto e decide se puo' risparmiarsi le richieste.

  0. fantacalcio   una pagina, join esatta per Id ufficiale. E' l'unica fonte di
                   media voto e fantamedia, che nessun altro pubblica.
  1. understat     cinque richieste in tutto (top 5 leghe), otto metriche piene.
  2. fbref         due richieste *per giocatore*: gira solo su chi il livello 1
                   non ha risolto.
  3. transfermarkt infortuni per tutti; rendimento solo per chi e' ancora scoperto.

Scambiare due righe qui non rompe nulla in modo rumoroso: fa semplicemente
partire una fonte costosa su giocatori che una fonte gratuita avrebbe coperto.
"""

from __future__ import annotations

from .base import ProviderOutcome, StatsProvider
from .fantacalcio_stats import FantacalcioStatsProvider
from .fbref import FbrefProvider
from .transfermarkt import TransfermarktProvider
from .understat import UnderstatProvider

ALL_PROVIDERS: tuple[StatsProvider, ...] = (
    FantacalcioStatsProvider(),
    UnderstatProvider(),
    FbrefProvider(),
    TransfermarktProvider(),
)


def select(names: list[str] | None) -> tuple[StatsProvider, ...]:
    """`--only understat,transfermarkt` -> solo quei due, nell'ordine del registro."""
    if not names:
        return ALL_PROVIDERS
    wanted = {n.strip().lower() for n in names}
    return tuple(p for p in ALL_PROVIDERS if p.name in wanted)


__all__ = ["ALL_PROVIDERS", "ProviderOutcome", "StatsProvider", "select"]
