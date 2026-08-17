"""
Modello dati della pipeline.

Rispecchia 1:1 `src/domain/playerStats.ts` lato app: le due estremita' della
catena devono parlare la stessa lingua, o il mapper TypeScript diventa un posto
dove i campi si perdono in silenzio.

Ogni metrica e' `Optional`: assente non significa zero. Vedi il commento in
`playerStats.ts` — e' la stessa regola, applicata a monte.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Optional


@dataclass(frozen=True)
class RosterEntry:
    """Un giocatore del listone: l'anagrafica di riferimento."""

    id: int
    role: str  # P | D | C | A
    role_mantra: Optional[str]
    name: str  # come lo scrive il listone: "Martinez Jo."
    team: str
    qt_a: int
    qt_i: int
    diff: int
    qt_a_m: int
    qt_i_m: int
    diff_m: int
    fvm: int
    fvm_m: int
    is_active: bool


@dataclass
class Performance:
    presenze: Optional[int] = None
    minuti: Optional[int] = None
    media_voto: Optional[float] = None
    fantamedia: Optional[float] = None
    gol: Optional[int] = None
    assist: Optional[int] = None
    ammonizioni: Optional[int] = None
    espulsioni: Optional[int] = None


@dataclass
class Advanced:
    xg: Optional[float] = None
    npxg: Optional[float] = None
    xa: Optional[float] = None
    xg_chain: Optional[float] = None
    xg_buildup: Optional[float] = None
    tiri: Optional[int] = None
    key_passes: Optional[int] = None


@dataclass
class InjurySpell:
    season: str
    type: str
    days: Optional[int] = None
    matches: Optional[int] = None


@dataclass
class Injuries:
    days: Optional[int] = None
    matches: Optional[int] = None
    risk: Optional[float] = None
    history: list[InjurySpell] = field(default_factory=list)


@dataclass
class Heatmap:
    rows: int
    cols: int
    cells: list[float]


@dataclass
class Contribution:
    """
    Quel che una singola fonte ha da dire su un giocatore.

    I provider non costruiscono il record finale: ne producono un pezzo. E' cio'
    che permette di aggiungere una fonte senza toccare ne' le altre ne'
    l'orchestratore (OCP) — il merge avviene in un unico punto, `builder.py`.
    """

    performance: Optional[Performance] = None
    advanced: Optional[Advanced] = None
    injuries: Optional[Injuries] = None
    heatmap: Optional[Heatmap] = None


@dataclass
class PlayerRecord:
    """Il record completo di un giocatore, come finisce nel JSON."""

    entry: RosterEntry
    performance: Performance = field(default_factory=Performance)
    advanced: Advanced = field(default_factory=Advanced)
    injuries: Injuries = field(default_factory=Injuries)
    heatmap: Optional[Heatmap] = None
    coverage: dict[str, bool] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        """
        Forma gerarchica per sezioni (US19-3), la stessa che la schermata di
        dettaglio mostra a blocchi (US21-2).
        """
        return {
            "id": self.entry.id,
            "r": self.entry.role,
            "rm": self.entry.role_mantra,
            "nome": self.entry.name,
            "squadra": self.entry.team,
            "is_active": self.entry.is_active,
            "quotazioni": {
                "qt_a": self.entry.qt_a,
                "qt_i": self.entry.qt_i,
                "diff": self.entry.diff,
                "qt_a_m": self.entry.qt_a_m,
                "qt_i_m": self.entry.qt_i_m,
                "diff_m": self.entry.diff_m,
                "fvm": self.entry.fvm,
                "fvm_m": self.entry.fvm_m,
            },
            "performance": asdict(self.performance),
            "advanced": asdict(self.advanced),
            "injuries": {
                "days": self.injuries.days,
                "matches": self.injuries.matches,
                "risk": self.injuries.risk,
                "history": [asdict(s) for s in self.injuries.history],
            },
            "heatmap": asdict(self.heatmap) if self.heatmap else None,
            "coverage": self.coverage,
        }
