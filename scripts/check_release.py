#!/usr/bin/env python3
"""
Decide se il dataset appena generato va pubblicato (US19-T3).

    python scripts/check_release.py .baseline        # confronto con la baseline
    python scripts/check_release.py                  # nessuna baseline: primo rilascio

La baseline e' una copia di `dataset/` fatta **prima** della generazione: il
workflow la mette da parte al checkout, cosi' il confronto non ha bisogno di
plumbing git e funziona identico in locale.

Uscite:
    0 + publish=true    pubblica
    0 + publish=false   contenuto invariato, non c'e' niente da committare
    1                   regressione: si ferma tutto, il dataset online resta

Orchestrazione e nient'altro: la decisione sta in `dataset/release.py`, dove si
puo' provare senza rete e senza CI.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

# Stessa ragione di build_dataset.py: la console di Windows parte in cp1252 e i
# nomi delle fonti passano da qui.
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

from dataset import config, release


def load(path: Path) -> Optional[dict[str, Any]]:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as error:
        print(f"Illeggibile {path}: {error}", file=sys.stderr)
        return None


def emit_github(decision: release.Decision, text: str) -> None:
    """
    Scrive per GitHub Actions solo se ci siamo dentro. In locale le variabili
    non esistono e lo script stampa e basta: un solo comportamento da capire.
    """
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(f"action={decision.action}\n")
            handle.write(f"publish={'true' if decision.should_publish else 'false'}\n")
            handle.write(f"version={decision.version}\n")
            handle.write(f"players={decision.players}\n")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(f"## Rilascio dataset\n\n```\n{text}\n```\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Gate di rilascio del dataset")
    parser.add_argument(
        "baseline",
        nargs="?",
        help="directory con il dataset precedente (manifest.json + players.json)",
    )
    parser.add_argument(
        "--dataset",
        default=str(config.OUTPUT_DIR),
        help="directory del dataset appena generato (default: dataset/)",
    )
    args = parser.parse_args()

    new_dir = Path(args.dataset)
    new_manifest = load(new_dir / config.OUTPUT_MANIFEST.name)
    new_payload = load(new_dir / config.OUTPUT_PAYLOAD.name)

    if not new_manifest or not new_payload:
        print(f"Nessun dataset generato in {new_dir}.", file=sys.stderr)
        return 2

    old_manifest = old_payload = None
    if args.baseline:
        base = Path(args.baseline)
        old_manifest = load(base / config.OUTPUT_MANIFEST.name)
        old_payload = load(base / config.OUTPUT_PAYLOAD.name)

    decision = release.decide(new_manifest, new_payload, old_manifest, old_payload)
    text = release.render(decision)
    print(text)
    emit_github(decision, text)

    return 1 if decision.is_failure else 0


if __name__ == "__main__":
    raise SystemExit(main())
