"""
Modello dati della pipeline.

Rispecchia 1:1 `src/domain/playerStats.ts` lato app: le due estremita' della
catena devono parlare la stessa lingua, o il mapper TypeScript diventa un posto
dove i campi si perdono in silenzio.

Ogni metrica e' `Optional`: assente non significa zero. Vedi il commento in
`playerStats.ts` — e' la stessa regola, applicata a monte.
"""

from __future__ import annotations

from dataclasses import dataclass, field, fields, asdict
from enum import Enum
from typing import Any, Optional, Sequence


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


@dataclass
class PlayerRecord:
    """Il record completo di un giocatore, come finisce nel JSON."""

    entry: RosterEntry
    performance: Performance = field(default_factory=Performance)
    advanced: Advanced = field(default_factory=Advanced)
    injuries: Injuries = field(default_factory=Injuries)
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
            "coverage": self.coverage,
        }


# --- La cascata a tre livelli --------------------------------------------------


class Section(str, Enum):
    """Le due sezioni per cui i livelli si contendono il diritto di scrivere."""

    PERFORMANCE = "performance"
    ADVANCED = "advanced"


@dataclass
class CascadeState:
    """
    Cosa i livelli precedenti hanno gia' coperto.

    E' l'unico canale attraverso cui un provider sa di poter risparmiare
    richieste, e serve perche' i tre livelli non sono alternative equivalenti:
    Understat costa cinque richieste *in tutto*, FBref ne costa due *per
    giocatore*. Far girare il livello 2 su chi il livello 1 ha gia' coperto
    significherebbe mille richieste a un sito che ci risponde 403 quando si
    insiste — per riscrivere dati che abbiamo gia'.

    I provider restano ignari l'uno dell'altro: nessuno sa *chi* ha coperto un
    giocatore, solo che qualcuno l'ha fatto. L'orchestratore aggiorna lo stato
    dopo ogni fonte.
    """

    advanced_covered: set[int] = field(default_factory=set)
    performance_covered: set[int] = field(default_factory=set)
    """Nome per esteso appreso da un livello a monte: "Martinez Jo." -> "Josep Martinez"."""
    full_names: dict[str, str] = field(default_factory=dict)

    def _covered(self, section: Section) -> set[int]:
        return (
            self.advanced_covered
            if section is Section.ADVANCED
            else self.performance_covered
        )

    def pending(
        self, roster: Sequence[RosterEntry], section: Section
    ) -> list[RosterEntry]:
        """Chi ha ancora bisogno di quella sezione."""
        covered = self._covered(section)
        return [entry for entry in roster if entry.id not in covered]

    def covers(self, player_id: int, section: Section) -> bool:
        return player_id in self._covered(section)

    def absorb(self, contributions: dict[int, "Contribution"]) -> None:
        """
        Registra cosa una fonte ha appena coperto.

        Guarda i *campi*, non la presenza della sezione: un `Performance` che
        contiene solo i minuti non copre il rendimento, e chi lo riceve deve
        restare in coda per il livello successivo.
        """
        for player_id, contribution in contributions.items():
            if _has_any_value(contribution.advanced):
                self.advanced_covered.add(player_id)
            if _covers_performance(contribution.performance):
                self.performance_covered.add(player_id)


def _has_any_value(section: Any) -> bool:
    if section is None:
        return False
    return any(getattr(section, f.name) is not None for f in fields(section))


def _covers_performance(performance: Optional[Performance]) -> bool:
    """
    I minuti da soli non sono rendimento.

    Understat li fornisce anche per chi ha gia' il rendimento ufficiale da
    Fantacalcio.it, ed e' il motivo per cui il livello 1 puo' scrivere quel solo
    campo su un giocatore gia' coperto. Contarlo come copertura spegnerebbe i
    livelli successivi per chi ha *solo* i minuti e nient'altro.
    """
    if performance is None:
        return False
    return any(
        getattr(performance, f.name) is not None
        for f in fields(performance)
        if f.name != "minuti"
    )
