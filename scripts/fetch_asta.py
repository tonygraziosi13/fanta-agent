#!/usr/bin/env python3
"""
Estrae i partecipanti della lega e inizializza lo stato d'asta.

    python scripts/fetch_asta.py                  # corsa normale
    python scripts/fetch_asta.py --headed         # browser visibile (primo collaudo)
    python scripts/fetch_asta.py --lega "Altra"   # un'altra lega
    python scripts/fetch_asta.py --dump           # salva HTML e screenshot di ogni passo

Serve il login: `FANTACALCIO_USER` e `FANTACALCIO_PASS`. L'area leghe e' privata
e non ha un percorso pubblico di riserva — a differenza del listone, qui o si
entra o non si legge niente.

Un rilancio **non azzera** lo stato: le squadre gia' nel file mantengono crediti,
slot e rosa, e solo le nuove partono dai default. E' cio' che rende sicuro
rigenerare a meta' asta quando entra un partecipante in ritardo.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

from dataset import asta
from dataset.asta import AstaError
from dataset.download_listone import DownloadError


def report(merge: asta.Merge, percorso: Path) -> None:
    print(f"\n{'=' * 62}\nPARTECIPANTI  ({len(merge.squadre)})\n{'=' * 62}")

    for squadra in merge.squadre:
        slot = "/".join(f"{r}{squadra.slot_liberi.get(r, 0)}" for r in ("P", "D", "C", "A"))
        stato = ""
        if squadra.nome_squadra in merge.nuove:
            stato = "nuova"
        elif squadra.nome_squadra in merge.sparite:
            stato = "non piu' in elenco"
        print(
            f"  {'>' if squadra.sono_io else ' '} {squadra.nome_squadra:<28} "
            f"{(squadra.proprietario or '—'):<18} {squadra.crediti_residui:>4} cr  "
            f"{slot:<16} rosa {len(squadra.rosa):>2}  {stato}"
        )

    mie = [s.nome_squadra for s in merge.squadre if s.sono_io]
    if mie:
        print(f"\n  la tua squadra: {mie[0]}  (marcata con > qui sopra)")
    else:
        # Senza questa riga il buco si scoprirebbe solo dall'agente, molto dopo:
        # `get_opponents` risponderebbe senza sapere quali crediti sono i tuoi.
        print(
            "\n  ATTENZIONE: nessuna squadra riconosciuta come tua.\n"
            "  Il nickname mostrato dal sito non somiglia allo username del login.\n"
            '  Indicala a mano con --mia-squadra "Nome Squadra".'
        )

    print(f"\n  nuove      : {len(merge.nuove)}")
    print(f"  preservate : {len(merge.preservate)}")
    if merge.sparite:
        # Non cancellate di proposito: distinguere "ha lasciato la lega" da "ha
        # rinominato la squadra" e' impossibile, e una rosa costruita in asta non
        # si butta via su un'ipotesi.
        print(f"  sparite    : {len(merge.sparite)} ({', '.join(merge.sparite)})")
        print("  (restano nel file: potrebbero essere solo state rinominate)")

    print(f"\nScritto {percorso}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Genera scripts/dataset/stato_asta.json")
    parser.add_argument("--lega", default=asta.LEGA_PREDEFINITA, help="nome della lega")
    parser.add_argument(
        "--headed",
        action="store_true",
        help="mostra il browser: serve al primo collaudo del login",
    )
    parser.add_argument(
        "--dump", action="store_true", help="salva HTML e screenshot di ogni passo"
    )
    parser.add_argument(
        "--mia-squadra",
        help="nome esatto della tua squadra; senza, si deduce dal nickname del proprietario",
    )
    parser.add_argument("--out", type=Path, default=asta.OUTPUT, help="percorso del file")
    args = parser.parse_args()

    print(f"Lega: {args.lega!r} | browser {'visibile' if args.headed else 'headless'}")

    try:
        partecipanti, utente = asta.raccogli(
            lega=args.lega, headless=not args.headed, dump_sempre=args.dump
        )
    except (AstaError, DownloadError) as error:
        print(f"\nEstrazione interrotta:\n{error}", file=sys.stderr)
        print("\nLo stato precedente resta invariato.", file=sys.stderr)
        return 1

    merge = asta.unisci(
        partecipanti, asta.leggi_stato(args.out), utente=utente, mia_squadra=args.mia_squadra
    )
    percorso = asta.scrivi(merge.squadre, args.out)
    report(merge, percorso)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
