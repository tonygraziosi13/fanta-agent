"""
Esportazione e versionamento del dataset (US19-3, US19-T3, US19-4).

Due file e non uno: `manifest.json` pesa poche centinaia di byte e contiene la
versione, `players.json` pesa qualche megabyte. L'app scarica prima il manifest,
e nel caso normale — dati gia' aggiornati — la sincronizzazione finisce li'
(US20-T2, "early exit"). Un file unico costringerebbe a scaricare tutto per
scoprire di non averne bisogno.

La versione e' l'hash del contenuto, non un timestamp: due generazioni a
distanza di un'ora da fonti immutate producono lo stesso hash, e l'app non
scarica nulla. Un timestamp invece cambierebbe sempre.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

from . import config
from .model import PlayerRecord


def build_payload(records: Sequence[PlayerRecord], sources: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema": 1,
        "season": config.STATS_SEASON,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": sources,
        "players": [record.to_json() for record in records],
    }


def _canonical(payload: dict[str, Any]) -> str:
    """
    Serializzazione deterministica per l'hash: chiavi ordinate e nessuno spazio.
    `generated_at` e' escluso — cambia a ogni esecuzione e renderebbe l'hash
    inutile come indicatore di "contenuto cambiato".
    """
    stable = {k: v for k, v in payload.items() if k != "generated_at"}
    return json.dumps(stable, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def write_dataset(
    payload: dict[str, Any],
    output_dir: Path = config.OUTPUT_DIR,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)

    digest = hashlib.sha256(_canonical(payload).encode("utf-8")).hexdigest()
    payload_path = output_dir / config.OUTPUT_PAYLOAD.name
    manifest_path = output_dir / config.OUTPUT_MANIFEST.name

    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    payload_path.write_text(body, encoding="utf-8")

    manifest = {
        "version": digest[:16],
        "hash": digest,
        "season": payload["season"],
        "generated_at": payload["generated_at"],
        "players_count": len(payload["players"]),
        "size_bytes": len(body.encode("utf-8")),
        "payload": config.OUTPUT_PAYLOAD.name,
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    return manifest
