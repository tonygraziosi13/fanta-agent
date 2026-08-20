"""
Delta di esecuzione: chi va rielaborato, e chi si riprende com'e'.

--- Il problema ---
Una generazione completa e' ~1500 richieste di rete. Fra un'esecuzione e la
successiva pero' il listone cambia di una decina di giocatori: rifare tutto
significa ripagare per intero un lavoro che per il 98% e' identico a ieri.

--- La regola ---
Si rielabora chi ha qualcosa da guadagnarci, e solo lui:

  - i **nuovi**, che nel dataset precedente non c'erano;
  - i **falliti**, perche' il fallimento e' spesso un 403 di passaggio;
  - chi **non ha un livello registrato**, cioe' e' stato prodotto da una
    versione precedente della pipeline: sono proprio quelli che i livelli nuovi
    possono ora recuperare;
  - chi era arrivato al **livello 1 senza metriche**, che e' una contraddizione:
    Understat serve a quello.

Chi si e' fermato al livello 3 con le metriche a null NON si ripete. Li' non
c'e' altro da prendere, e riprovarlo a ogni avvio impedirebbe al delta di
svuotarsi mai — che e' il modo tipico in cui una cache incrementale smette di
essere incrementale senza che nessuno se ne accorga.

--- Perche' lo stato sta nella cache e non in `dataset/` ---
`levels.json` non e' contenuto da pubblicare: non descrive i giocatori, descrive
come li abbiamo ottenuti. In `dataset/` finirebbe nell'hash e farebbe cambiare
la versione a ogni corsa. E se sparisce, il peggio che succede e' una
rigenerazione completa — un degrado sicuro, che e' l'unico tipo accettabile per
una struttura di comodo.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional, Sequence

from . import config
from .model import RosterEntry

# I quattro stati con cui una scheda esce dalla cascata.
COMPLETO = "completo"
PARZIALE = "parziale"
FALLITO = "fallito"

SENZA_LIVELLO = "-"


@dataclass
class Delta:
    """L'esito della decisione: chi rifare, e cosa riusare per gli altri."""

    da_rifare: list[RosterEntry] = field(default_factory=list)
    riusati: dict[int, dict[str, Any]] = field(default_factory=dict)
    """{id: [stato, livello]} della corsa precedente."""
    stato: dict[str, list[str]] = field(default_factory=dict)

    @property
    def saltati(self) -> int:
        return len(self.riusati)


def load_previous_payload(path: Path = config.OUTPUT_PAYLOAD) -> Optional[dict[str, Any]]:
    """Il dataset gia' pubblicato, se c'e'. Un file illeggibile vale come assente."""
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return None
    return payload if isinstance(payload, dict) else None


def load_state(path: Path = config.STATE_FILE) -> dict[str, list[str]]:
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return {str(k): _normalize_entry(v) for k, v in raw.items()}


def save_state(stato: dict[str, list[str]], path: Path = config.STATE_FILE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(stato, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)


def _normalize_entry(value: Any) -> list[str]:
    """Le corse vecchie salvavano forme diverse: si riconducono tutte a [stato, livello]."""
    if isinstance(value, (list, tuple)):
        parts = [str(v) for v in value]
    else:
        parts = [str(value)]
    parts = (parts + ["", ""])[:2]
    return [parts[0], parts[1] or SENZA_LIVELLO]


def _metriche_vuote(record: dict[str, Any]) -> bool:
    advanced = record.get("advanced") or {}
    return not advanced or all(v is None for v in advanced.values())


def plan(
    roster: Sequence[RosterEntry],
    previous: Optional[dict[str, Any]],
    stato: dict[str, list[str]],
    full: bool = False,
) -> Delta:
    """
    Decide chi rielaborare. Puro: nessun file, nessuna rete.

    `full=True` rifa' tutto — l'interruttore per quando si e' cambiato qualcosa
    nella pipeline e i record vecchi non sono piu' confrontabili con i nuovi.
    """
    delta = Delta(stato=dict(stato))

    if full or previous is None:
        delta.da_rifare = list(roster)
        return delta

    fatti = {
        int(record["id"]): record
        for record in previous.get("players") or []
        if isinstance(record, dict) and str(record.get("id", "")).isdigit()
    }

    for entry in roster:
        record = fatti.get(entry.id)
        if record is None:
            delta.da_rifare.append(entry)
            continue

        stato_voce, livello = stato.get(str(entry.id), ["", SENZA_LIVELLO])
        if stato_voce in ("", FALLITO) or livello == SENZA_LIVELLO:
            delta.da_rifare.append(entry)
            continue
        if livello.startswith("1") and _metriche_vuote(record):
            delta.da_rifare.append(entry)
            continue

        delta.riusati[entry.id] = record

    return delta


def classify(record: dict[str, Any], coverage: dict[str, bool]) -> list[str]:
    """
    Lo stato con cui una scheda esce dalla cascata: [stato, livello].

    Il livello e' la fonte che ha dato le *metriche*, che e' il dato scarso.
    Serve al giro successivo per sapere se c'e' ancora qualcosa da tentare.
    """
    if coverage.get("understat"):
        livello = "1-understat"
    elif coverage.get("fbref"):
        livello = "2-fbref"
    elif coverage.get("transfermarkt") or coverage.get("fantacalcio"):
        livello = "3-transfermarkt"
    else:
        return [FALLITO, SENZA_LIVELLO]

    performance = record.get("performance") or {}
    advanced = record.get("advanced") or {}
    completo = any(v is not None for v in performance.values()) and any(
        v is not None for v in advanced.values()
    )
    return [COMPLETO if completo else PARZIALE, livello]
