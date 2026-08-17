#!/usr/bin/env python3
"""
Converte il listone ufficiale Fantacalcio (.xlsx) nell'asset CSV consumato dall'app.

Perche' esiste questo script:
    Le User Stories (US7-T1/T2) richiedono un CSV negli assets dell'app, ma la fonte
    ufficiale distribuita e' un .xlsx a 6 fogli. Questo script e' il ponte, ed e'
    rieseguibile a ogni aggiornamento del listone (le quotazioni cambiano a ogni
    sessione di mercato).

Perche' solo stdlib:
    Un .xlsx e' uno ZIP di XML. zipfile + ElementTree bastano: niente pandas/openpyxl
    da installare, lo script gira su qualsiasi Python 3 senza virtualenv.

Fogli:
    'Tutti'    -> giocatori in rosa            -> IsActive = 1
    'Ceduti'   -> giocatori ceduti/svincolati  -> IsActive = 0
    Portieri/Difensori/Centrocampisti/Attaccanti sono viste ridondanti di 'Tutti': ignorati.

Uso:
    python scripts/xlsx_to_csv.py [input.xlsx] [output.csv]
"""

from __future__ import annotations

import csv
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = ROOT / "Quotazioni_Fantacalcio_Stagione_2026_27.xlsx"
DEFAULT_OUTPUT = ROOT / "assets" / "data" / "listone.csv"

# Tracciato record ufficiale, nell'ordine in cui compare nel foglio.
# L'app aggiunge in coda IsActive, derivata dal foglio di provenienza.
EXPECTED_HEADER = [
    "Id", "R", "RM", "Nome", "Squadra",
    "Qt.A", "Qt.I", "Diff.",
    "Qt.A M", "Qt.I M", "Diff.M",
    "FVM", "FVM M",
]
OUTPUT_HEADER = EXPECTED_HEADER + ["IsActive"]


def _shared_strings(z: zipfile.ZipFile) -> list[str]:
    """La sharedStrings table: le celle testuali di un xlsx sono indici in questa lista."""
    try:
        raw = z.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ET.fromstring(raw)
    # Un <si> puo' contenere piu' <t> (rich text frammentato): vanno concatenati.
    return ["".join(t.text or "" for t in si.iter(NS + "t")) for si in root]


def _sheet_paths(z: zipfile.ZipFile) -> dict[str, str]:
    """Mappa nome-foglio -> path XML interno, risolvendo le relationship del workbook."""
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rel_ns = "{http://schemas.openxmlformats.org/package/2006/relationships}"
    id_to_target = {
        r.get("Id"): r.get("Target").lstrip("/")
        for r in rels.iter(rel_ns + "Relationship")
    }

    wb = ET.fromstring(z.read("xl/workbook.xml"))
    doc_rel = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"

    paths: dict[str, str] = {}
    for sheet in wb.iter(NS + "sheet"):
        target = id_to_target.get(sheet.get(doc_rel), "")
        if not target.startswith("xl/"):
            target = "xl/" + target
        paths[sheet.get("name")] = target
    return paths


def _rows(z: zipfile.ZipFile, path: str, strings: list[str]) -> list[list[str]]:
    """Estrae le righe di un foglio come liste di stringhe."""
    root = ET.fromstring(z.read(path))
    out: list[list[str]] = []
    for row in root.iter(NS + "row"):
        cells: list[str] = []
        for c in row.iter(NS + "c"):
            v = c.find(NS + "v")
            if v is None or v.text is None:
                cells.append("")
            elif c.get("t") == "s":
                cells.append(strings[int(v.text)])
            else:
                cells.append(v.text)
        out.append(cells)
    return out


def _extract_players(rows: list[list[str]], sheet: str) -> list[list[str]]:
    """
    Isola le righe dati saltando il titolo decorativo e l'header.

    I fogli iniziano con una riga di titolo ('Quotazioni Fantacalcio Stagione 2026 27')
    seguita dall'header vero. Cerchiamo l'header per contenuto invece di assumerne
    l'indice: se il formato ufficiale guadagna una riga, lo script non si rompe in
    silenzio importando spazzatura.
    """
    header_idx = next(
        (i for i, r in enumerate(rows) if r[: len(EXPECTED_HEADER)] == EXPECTED_HEADER),
        None,
    )
    if header_idx is None:
        raise SystemExit(
            f"[FATAL] Header ufficiale non trovato nel foglio '{sheet}'.\n"
            f"        Atteso: {EXPECTED_HEADER}\n"
            f"        Il tracciato record e' cambiato: aggiornare EXPECTED_HEADER "
            f"e lo schema in src/core/db/schema.ts."
        )

    players = []
    for row in rows[header_idx + 1:]:
        row = row[: len(EXPECTED_HEADER)]
        if not row or not row[0].strip():  # riga vuota / coda del foglio
            continue
        row += [""] * (len(EXPECTED_HEADER) - len(row))  # celle trailing vuote omesse da Excel
        players.append(row)
    return players


def convert(src: Path, dst: Path) -> None:
    if not src.exists():
        raise SystemExit(f"[FATAL] File sorgente non trovato: {src}")

    with zipfile.ZipFile(src) as z:
        strings = _shared_strings(z)
        paths = _sheet_paths(z)

        for required in ("Tutti", "Ceduti"):
            if required not in paths:
                raise SystemExit(
                    f"[FATAL] Foglio '{required}' assente. Fogli trovati: {list(paths)}"
                )

        active = _extract_players(_rows(z, paths["Tutti"], strings), "Tutti")
        ceduti = _extract_players(_rows(z, paths["Ceduti"], strings), "Ceduti")

    # Un ceduto potrebbe comparire in entrambi i fogli: 'Tutti' vince (e' la rosa reale).
    active_ids = {r[0] for r in active}
    ceduti = [r for r in ceduti if r[0] not in active_ids]

    dst.parent.mkdir(parents=True, exist_ok=True)
    with dst.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(OUTPUT_HEADER)
        w.writerows(r + ["1"] for r in active)
        w.writerows(r + ["0"] for r in ceduti)

    print(f"[OK] {dst.relative_to(ROOT) if dst.is_relative_to(ROOT) else dst}")
    print(f"     {len(active)} attivi + {len(ceduti)} ceduti = {len(active) + len(ceduti)} record")


if __name__ == "__main__":
    convert(
        Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_INPUT,
        Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUTPUT,
    )
