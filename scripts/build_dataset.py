#!/usr/bin/env python3
"""
Genera il dataset arricchito consumato dall'app (US19).

    python scripts/build_dataset.py                      # tutte le fonti
    python scripts/build_dataset.py --only understat     # una sola
    python scripts/build_dataset.py --limit 30           # prova rapida
    python scripts/build_dataset.py --no-cache           # ignora la cache su disco

Orchestrazione e nient'altro: non conosce nessuna fonte in concreto, itera sul
registro dei provider e affida il merge a `builder.py`. Aggiungere una fonte non
tocca questo file.

Una fonte che fallisce non fa fallire la generazione: il dataset esce con quella
copertura in meno e il report lo dice a voce alta. L'alternativa — nessun
dataset perche' un sito era offline — sarebbe peggiore per l'utente.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# La console di Windows parte in cp1252 e va in UnicodeEncodeError sui nomi
# accentati (e sulle frecce del report). Si forza UTF-8 sull'output, con
# `replace` come rete: un accento illeggibile non deve interrompere una
# generazione durata dieci minuti.
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

from dataset import config, providers, report
from dataset.builder import build_records
from dataset.export import build_payload, write_dataset
from dataset.http import HttpClient
from dataset.providers.base import ProviderOutcome
from dataset.roster import load_roster


def load_manual_map() -> dict[str, dict[str, str]]:
    if not config.MANUAL_MAP.exists():
        return {}
    raw = json.loads(config.MANUAL_MAP.read_text(encoding="utf-8"))
    return {k: v for k, v in raw.items() if isinstance(v, dict)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Genera dataset/players.json")
    parser.add_argument("--only", help="fonti separate da virgola (understat,transfermarkt,...)")
    parser.add_argument("--limit", type=int, help="usa solo i primi N giocatori del listone")
    parser.add_argument("--no-cache", action="store_true", help="ignora la cache HTTP su disco")
    parser.add_argument(
        "--delay",
        type=float,
        default=config.DEFAULT_DELAY_SECONDS,
        help="secondi fra due richieste allo stesso host",
    )
    args = parser.parse_args()

    roster = load_roster()
    if args.limit:
        roster = roster[: args.limit]
    print(f"Listone: {len(roster)} giocatori da {config.LISTONE_CSV.name}")

    selected = providers.select(args.only.split(",") if args.only else None)
    if not selected:
        print(f"Nessuna fonte corrisponde a '{args.only}'.", file=sys.stderr)
        return 2

    http = HttpClient(delay=args.delay, use_cache=not args.no_cache)
    manual_map = load_manual_map()

    outcomes: dict[str, ProviderOutcome] = {}
    for provider in selected:
        print(f"\n→ {provider.name} …", flush=True)
        try:
            outcome = provider.collect(roster, http, manual_map)
        except Exception as error:  # una fonte rotta non ferma le altre
            outcome = ProviderOutcome(failure=f"{type(error).__name__}: {error}")
            outcome.unresolved = list(roster)

        outcomes[provider.name] = outcome
        if outcome.failure:
            print(f"   fallita: {outcome.failure}")
        else:
            print(f"   {len(outcome.contributions)} giocatori coperti")

    records = build_records(
        roster, {name: o.contributions for name, o in outcomes.items()}
    )
    payload = build_payload(records, report.summarize(len(roster), outcomes))
    manifest = write_dataset(payload)

    report.print_report(len(roster), outcomes)
    print(
        f"Scritti {config.OUTPUT_PAYLOAD} ({manifest['size_bytes'] / 1024:.0f} KB) "
        f"e {config.OUTPUT_MANIFEST.name}\nversione {manifest['version']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
