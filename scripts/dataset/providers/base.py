"""
Il contratto delle fonti (US19-T1).

Un provider riceve il listone e restituisce il proprio contributo per i
giocatori che riesce a coprire. Non conosce le altre fonti, non decide come i
dati vengono fusi, non sa nulla del formato di uscita: sa solo tradurre *una*
fonte nel modello comune.

E' l'Open/Closed reso concreto: aggiungere FBref o WhoScored significa scrivere
un file in questa cartella e registrarlo. Nessun modulo esistente cambia.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Protocol, Sequence

from ..http import HttpClient
from ..model import CascadeState, Contribution, RosterEntry
from ..resolver import Match


@dataclass
class ProviderOutcome:
    """
    Cosa ha prodotto una fonte, e cosa non e' riuscita a produrre.

    Gli irrisolti non sono un dettaglio diagnostico: sono la lista di lavoro per
    `manual_map.json`, e senza di essa la copertura non migliora mai.
    """

    contributions: dict[int, Contribution] = field(default_factory=dict)
    matches: dict[int, Match] = field(default_factory=dict)
    unresolved: list[RosterEntry] = field(default_factory=list)
    """Valorizzato se la fonte e' risultata irraggiungibile: la pipeline prosegue."""
    failure: Optional[str] = None


class StatsProvider(Protocol):
    """
    Il ruolo che ogni fonte deve saper interpretare.

    `state` e' l'unica cosa che una fonte sa dei livelli a monte, ed e' meno di
    quanto sembri: dice *se* un giocatore e' gia' coperto, mai da chi. Serve
    perche' i livelli non hanno lo stesso prezzo — Understat costa cinque
    richieste in tutto, FBref due per giocatore — e far girare il livello 2 su
    chi il livello 1 ha gia' risolto significherebbe mille richieste per
    riscrivere dati che abbiamo. Una fonte che non ha nulla da risparmiare puo'
    ignorarlo.
    """

    name: str

    def collect(
        self,
        roster: Sequence[RosterEntry],
        http: HttpClient,
        manual_map: dict[str, dict[str, str]],
        state: CascadeState,
    ) -> ProviderOutcome: ...
