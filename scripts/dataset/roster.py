"""
Lettura del listone: l'anagrafica di riferimento della pipeline.

Legge lo stesso `assets/data/listone.csv` che l'app imbarca come fallback, cosi'
gli `id` del dataset e quelli del CSV bundlato coincidono per costruzione. Se
divergessero, un utente offline e uno online vedrebbero due liste diverse.
"""

from __future__ import annotations

import csv
from pathlib import Path

from . import config
from .model import RosterEntry


def _to_int(value: str | None) -> int:
    if not value:
        return 0
    try:
        return int(float(value.replace(",", ".")))
    except ValueError:
        return 0


def load_roster(path: Path = config.LISTONE_CSV) -> list[RosterEntry]:
    if not path.exists():
        raise FileNotFoundError(
            f"Listone non trovato: {path}. Rigeneralo con `npm run listone`."
        )

    entries: list[RosterEntry] = []
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            player_id = _to_int(row.get("Id"))
            if player_id <= 0:
                continue

            role_mantra = (row.get("RM") or "").strip()
            entries.append(
                RosterEntry(
                    id=player_id,
                    role=(row.get("R") or "").strip().upper(),
                    role_mantra=role_mantra or None,
                    name=(row.get("Nome") or "").strip(),
                    team=(row.get("Squadra") or "").strip(),
                    qt_a=_to_int(row.get("Qt.A")),
                    qt_i=_to_int(row.get("Qt.I")),
                    diff=_to_int(row.get("Diff.")),
                    qt_a_m=_to_int(row.get("Qt.A M")),
                    qt_i_m=_to_int(row.get("Qt.I M")),
                    diff_m=_to_int(row.get("Diff.M")),
                    fvm=_to_int(row.get("FVM")),
                    fvm_m=_to_int(row.get("FVM M")),
                    # Colonna assente => attivo, come fa gia' il mapper dell'app.
                    is_active=(row.get("IsActive") or "1") != "0",
                )
            )

    return entries
