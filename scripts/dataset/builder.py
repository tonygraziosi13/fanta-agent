"""
Fusione dei contributi in un record unico per giocatore.

E' l'unico punto in cui le fonti si incontrano, ed e' cio' che permette ai
provider di ignorarsi a vicenda. La regola di merge e' una sola e vale per
tutti: *un valore non nullo non viene mai sovrascritto da un valore nullo*.

Serve davvero: le presenze arrivano da Fantacalcio.it, i minuti da Understat, e
sono due campi della stessa sezione. Una fusione "l'ultimo vince" cancellerebbe
le presenze appena scritte dal provider precedente.
"""

from __future__ import annotations

from dataclasses import fields, replace
from typing import Sequence, TypeVar

from .model import Contribution, PlayerRecord, RosterEntry

T = TypeVar("T")


def merge_section(current: T, incoming: T) -> T:
    """Campo per campo: `incoming` scrive solo dove ha qualcosa da dire."""
    updates = {
        f.name: getattr(incoming, f.name)
        for f in fields(current)  # type: ignore[arg-type]
        if getattr(incoming, f.name) is not None
    }
    return replace(current, **updates)  # type: ignore[type-var]


def build_records(
    roster: Sequence[RosterEntry],
    contributions_by_source: dict[str, dict[int, Contribution]],
) -> list[PlayerRecord]:
    """
    Ogni giocatore del listone genera un record, coperto o no.

    E' la garanzia che il dataset e il listone abbiano sempre la stessa
    cardinalita': l'app non deve mai chiedersi se un giocatore manca perche' e'
    stato ceduto o perche' una fonte non lo conosceva.
    """
    records = {entry.id: PlayerRecord(entry=entry) for entry in roster}

    for source, contributions in contributions_by_source.items():
        for player_id, contribution in contributions.items():
            record = records.get(player_id)
            if record is None:
                continue

            if contribution.performance is not None:
                record.performance = merge_section(record.performance, contribution.performance)
            if contribution.advanced is not None:
                record.advanced = merge_section(record.advanced, contribution.advanced)
            if contribution.injuries is not None:
                record.injuries = contribution.injuries

            record.coverage[source] = True

    # La copertura e' esplicita anche quando e' negativa: l'app distingue
    # "nessun dato" da "dato pari a zero" leggendo questa mappa.
    for record in records.values():
        for source in contributions_by_source:
            record.coverage.setdefault(source, False)

    return list(records.values())
