#!/usr/bin/env python3
"""
Genera dataset/coaches.json: allenatore, modulo e profilo tattico per squadra.

    python scripts/build_coaches.py               # tutte le squadre del listone
    python scripts/build_coaches.py --limit 3     # prova rapida, ~7 richieste
    python scripts/build_coaches.py --dry-run     # mostra il report, non scrive
    python scripts/build_coaches.py --no-cache    # ignora la cache HTTP su disco

Orchestrazione e report, niente logica: quella sta in `dataset/coaches.py`, dove
si puo' testare senza rete.

Sta fuori da `build_dataset.py` di proposito. I dati degli allenatori cambiano
poche volte a stagione — un esonero, un modulo che si assesta — mentre il
dataset dei giocatori si rigenera ogni lunedi'. Legarli significherebbe rifare
quaranta richieste a Transfermarkt ogni settimana per riscrivere lo stesso file,
e dare al gate di rilascio una fonte in piu' da poter bloccare.
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# La console di Windows parte in cp1252 e va in UnicodeEncodeError sui nomi
# accentati: "Rúben Amorim" farebbe fallire l'ultima riga di stampa di una
# corsa altrimenti riuscita.
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

from dataset import coaches, config
from dataset.coaches import CoachesError
from dataset.http import HttpClient, HttpError
from dataset.normalize import normalize_team


def squadre_dal_listone() -> dict[str, str]:
    """
    Le squadre attive del listone: {forma normalizzata: nome come lo scrive}.

    Si legge il CSV direttamente invece di passare da `load_roster()`: qui
    servono venti nomi di squadra, non cinquecento anagrafiche complete.
    """
    if not config.LISTONE_CSV.exists():
        raise CoachesError(
            f"Listone non trovato: {config.LISTONE_CSV}. Rigeneralo con `npm run listone`."
        )

    squadre: dict[str, str] = {}
    with config.LISTONE_CSV.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            # I ceduti restano nel CSV con IsActive=0 e possono appartenere a
            # una squadra che in Serie A non c'e' piu': userebbero uno slot.
            if (row.get("IsActive") or "1") == "0":
                continue
            nome = (row.get("Squadra") or "").strip()
            if nome:
                squadre.setdefault(normalize_team(nome), nome)

    if not squadre:
        raise CoachesError("Il listone non contiene squadre.")
    return squadre


def report(records: list[coaches.CoachRecord]) -> None:
    con_allenatore = sum(1 for r in records if r.allenatore)
    con_modulo = sum(1 for r in records if r.modulo_base)
    con_metriche = sum(1 for r in records if r.xg_totali is not None)
    con_rosa = sum(1 for r in records if r.giocatori_impiegati_storico is not None)
    totale = len(records)

    print(f"\n{'=' * 84}\nSQUADRE  ({totale})\n{'=' * 84}")
    for r in records:
        modulo = r.modulo_base or "—"
        xg = f"{r.xg_totali:.1f}" if r.xg_totali is not None else "—"
        ppda = f"{r.ppda_stagione:.2f}" if r.ppda_stagione is not None else "—"
        rosa = str(r.giocatori_impiegati_storico or "—")
        cartellini = (
            f"{r.gialli_totali}g/{r.rossi_totali}r" if r.gialli_totali is not None else "—"
        )
        # D-C-A in percentuale: tre numeri dicono la forma dell'attacco meglio
        # di qualunque etichetta.
        d = r.distribuzione_gol
        split = (
            f"{d.difensori_perc:.0f}-{d.centrocampisti_perc:.0f}-{d.attaccanti_perc:.0f}"
            if d is not None
            else "—"
        )
        print(
            f"  {r.squadra:<12} {(r.allenatore or 'ALLENATORE NON TROVATO'):<23} "
            f"{modulo:<9} xG {xg:>5} PPDA {ppda:>5} rosa {rosa:>3} "
            f"{cartellini:>8}  D-C-A {split:>9}"
        )

    print(f"\n  allenatore : {con_allenatore}/{totale}")
    print(f"  modulo     : {con_modulo}/{totale}")
    print(f"  metriche   : {con_metriche}/{totale}")
    print(f"  rosa       : {con_rosa}/{totale}")

    # Gli scoperti sono la lista di lavoro, come gli irrisolti di report.py.
    scoperti = [r.squadra for r in records if not r.allenatore]
    if scoperti:
        print(f"\n  senza allenatore: {', '.join(scoperti)}")
    senza_metriche = [r.squadra for r in records if r.xg_totali is None]
    if senza_metriche:
        print(f"  senza metriche  : {', '.join(senza_metriche)}")
        print("  (atteso per una neopromossa: in Serie A non ha ancora giocato)")


def main() -> int:
    parser = argparse.ArgumentParser(description="Genera dataset/coaches.json")
    parser.add_argument("--limit", type=int, help="usa solo le prime N squadre")
    parser.add_argument("--dry-run", action="store_true", help="mostra il report senza scrivere")
    parser.add_argument("--no-cache", action="store_true", help="ignora la cache HTTP su disco")
    args = parser.parse_args()

    try:
        squadre = squadre_dal_listone()
    except CoachesError as error:
        print(str(error), file=sys.stderr)
        return 1

    print(
        f"Listone: {len(squadre)} squadre | stagione metriche {config.UNDERSTAT_SEASON} "
        f"| stagione in corso {config.TM_SEASON}"
    )

    http = HttpClient(use_cache=not args.no_cache)
    try:
        records = coaches.collect(http, squadre, limit=args.limit)
    except (CoachesError, HttpError) as error:
        print(f"\nGenerazione interrotta: {error}", file=sys.stderr)
        print("Il file precedente resta invariato.", file=sys.stderr)
        return 1

    report(records)

    if args.dry_run:
        print("\n--dry-run: nessun file scritto.")
        return 0

    # Una prova su poche squadre non deve sovrascrivere il file completo: e' la
    # stessa protezione che `build_dataset.py` da' al dataset dei giocatori.
    if args.limit:
        print(
            f"\n--limit {args.limit}: esecuzione parziale, {coaches.OUTPUT.name} "
            "non e' stato toccato."
        )
        return 0

    percorso = coaches.write(records)
    print(f"\nScritto {percorso}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
