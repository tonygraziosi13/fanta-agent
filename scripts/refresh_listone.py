#!/usr/bin/env python3
"""
Aggiorna `assets/data/listone.csv` dalle quotazioni ufficiali.

    python scripts/refresh_listone.py              # scarica, confronta, riscrive
    python scripts/refresh_listone.py --dry-run    # dice cosa cambierebbe, non tocca nulla
    python scripts/refresh_listone.py --no-cache   # ignora la cache HTTP
    python scripts/refresh_listone.py --no-login   # salta il download autenticato

--- Due strade per lo stesso listone ---
1. **Download autenticato** (`FANTACALCIO_USER` / `FANTACALCIO_PASS`): login con
   un browser headless e scaricamento dell'.xlsx ufficiale. E' il percorso
   primario perche' da' il tracciato record completo e i fogli "Tutti"/"Ceduti",
   cioe' una dichiarazione esplicita di chi e' uscito dalla Serie A.
2. **Scraping della pagina pubblica**, che non richiede login e ricava lo stesso
   dallo stato `out-of-game` di ogni riga.

La seconda scatta da sola quando la prima non e' percorribile: credenziali
assenti, Playwright non installato, sito che rifiuta l'IP. Non e' un ramo di
emergenza da riscoprire il giorno del guasto — e' il percorso che ha retto
finora, ed e' quello che tiene in piedi il rilascio automatico se un runner CI
non riesce ad autenticarsi.

`xlsx_to_csv.py` resta per convertire a mano un .xlsx gia' scaricato, senza rete.

Va lanciato **prima** di `build_dataset.py`: la pipeline costruisce le metriche
attorno all'anagrafica di questo CSV, quindi un listone vecchio produce un
dataset vecchio per quanto fresche siano le fonti delle statistiche.

Esce non-zero solo se la pagina e' irriconoscibile o irraggiungibile: in quel
caso il listone attuale resta intatto, che e' sempre meglio di uno monco.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

from dataset import config, quotazioni
from dataset.http import HttpClient, HttpError


def _righe_da_login() -> tuple[list, str]:
    """
    Percorso primario: .xlsx autenticato, piu' l'HTML della pagina per conferma.

    Solleva `DownloadError` — che il chiamante tratta come "usa l'altra strada" —
    invece di terminare: qui un fallimento non e' un errore della pipeline.
    """
    from dataset import download_listone, listone_xlsx

    scaricato = download_listone.download()
    righe = listone_xlsx.read_rows(scaricato.xlsx)

    # Seconda lettura, gratuita: la pagina era gia' aperta per trovare il link.
    # I due fogli dell'.xlsx e il marcatore `out-of-game` dicono la stessa cosa
    # per vie diverse, e quando divergono e' la pagina ad avere ragione — e' cio'
    # che il sito mostra *adesso*, mentre il file e' una fotografia.
    corretti = 0
    if scaricato.html:
        try:
            dal_dom = {
                r.id: r.is_active
                for r in quotazioni.parse_quotazioni(
                    scaricato.html, quotazioni.team_names_from_csv()
                )
            }
        except quotazioni.QuotazioniError:
            dal_dom = {}

        aggiornate = []
        for riga in righe:
            attivo = dal_dom.get(riga.id)
            if attivo is not None and attivo != riga.is_active:
                corretti += 1
                riga = replace(riga, is_active=attivo)
            aggiornate.append(riga)
        righe = aggiornate

    nota = f"download autenticato ({scaricato.xlsx.name})"
    if corretti:
        nota += f", {corretti} stati corretti dalla pagina"
    return righe, nota


def main() -> int:
    parser = argparse.ArgumentParser(description="Aggiorna il listone dalle quotazioni ufficiali")
    parser.add_argument("--dry-run", action="store_true", help="mostra il diff senza scrivere")
    parser.add_argument("--no-cache", action="store_true", help="ignora la cache HTTP su disco")
    parser.add_argument(
        "--no-login",
        action="store_true",
        help="salta il download autenticato e usa solo la pagina pubblica",
    )
    args = parser.parse_args()

    righe: list = []
    origine = ""

    if not args.no_login:
        try:
            righe, origine = _righe_da_login()
        except Exception as error:
            # Qualunque inciampo del percorso autenticato — credenziali assenti,
            # Playwright mancante, sito che rifiuta — vale come "prova l'altra
            # strada". Il messaggio resta visibile: se il download smette di
            # funzionare va saputo, anche quando il fallback salva la corsa.
            print(f"Download autenticato non disponibile: {error}")
            print("Ricado sullo scraping della pagina pubblica.")

    if not righe:
        http = HttpClient(delay=config.DEFAULT_DELAY_SECONDS, use_cache=not args.no_cache)
        try:
            html = quotazioni.fetch(http)
        except HttpError as error:
            print(f"Quotazioni non raggiungibili: {error}", file=sys.stderr)
            print("Il listone attuale resta invariato.", file=sys.stderr)
            return 1

        try:
            righe = quotazioni.parse_quotazioni(html, quotazioni.team_names_from_csv())
        except quotazioni.QuotazioniError as error:
            print(str(error), file=sys.stderr)
            return 1
        origine = "pagina pubblica"

    precedenti = quotazioni.read_previous()
    diff = quotazioni.diff_with_previous(righe, precedenti)

    print(f"Fonte: {origine}")
    print(f"Listone in repo: {len(precedenti)} righe | fonte ufficiale: {len(righe)} giocatori")
    print(f"  nuovi: {len(diff.nuovi)}  ceduti: {len(diff.ceduti)}  "
          f"spariti: {len(diff.usciti)}  quotazioni cambiate: {len(diff.quotazioni_cambiate)}  "
          f"invariati: {diff.invariati}")

    for riga in diff.nuovi[:20]:
        print(f"    + {riga.name:<22} {riga.team:<12} {riga.role}  qt_a={riga.qt_a}")
    if len(diff.nuovi) > 20:
        print(f"      … e altri {len(diff.nuovi) - 20}")
    for riga in diff.ceduti[:20]:
        print(f"    - {riga.name:<22} {riga.team:<12} ceduto (resta con IsActive=0)")
    for riga in diff.usciti[:20]:
        print(f"    ? {riga.get('Nome',''):<22} {riga.get('Squadra','')}  sparito dall'elenco")
    for nome, prima, dopo in diff.quotazioni_cambiate[:20]:
        print(f"    ~ {nome:<22} qt_a {prima} -> {dopo}")

    if diff.is_empty:
        print("Nessuna differenza: il listone e' gia' aggiornato.")
        return 0

    if args.dry_run:
        print("--dry-run: nessun file scritto.")
        return 0

    quotazioni.write_csv(quotazioni.merge_with_previous(righe, precedenti))
    print(f"Scritto {config.LISTONE_CSV}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
