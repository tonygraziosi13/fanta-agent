"""
Lettura dell'.xlsx ufficiale del listone.

Un .xlsx e' uno ZIP di XML: `zipfile` + `ElementTree` bastano, e leggere il file
senza pandas ne' openpyxl tiene questo modulo dentro la stdlib. Non e' purismo —
e' il pezzo di catena che deve funzionare su un runner appena creato, prima che
qualcuno si accorga che una dipendenza manca.

--- Da dove viene `IsActive` ---
Dai **fogli**, non dalle righe. Il file ufficiale ha un foglio "Tutti" (la rosa
reale) e un foglio "Ceduti", e l'appartenenza al secondo e' l'unico modo di
sapere che un giocatore e' uscito: l'elenco delle quotazioni non toglie nessuno,
i venduti restano con la loro quotazione. Senza questa distinzione un ceduto
tornerebbe acquistabile in asta.

Un giocatore puo' comparire in entrambi i fogli — venduto e poi ricomprato nella
stessa sessione di mercato. Vince "Tutti": e' la rosa reale.
"""

from __future__ import annotations

import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from .quotazioni import QuotazioneRow

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

# Tracciato record ufficiale, nell'ordine in cui compare nel foglio.
EXPECTED_HEADER = [
    "Id", "R", "RM", "Nome", "Squadra",
    "Qt.A", "Qt.I", "Diff.",
    "Qt.A M", "Qt.I M", "Diff.M",
    "FVM", "FVM M",
]


class XlsxError(RuntimeError):
    """Il file non e' un listone ufficiale, o non lo e' piu'."""


def _shared_strings(z: zipfile.ZipFile) -> list[str]:
    """Le celle testuali di un xlsx sono indici in questa tabella."""
    try:
        raw = z.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ET.fromstring(raw)
    # Un <si> puo' contenere piu' <t> (rich text frammentato): vanno concatenati.
    return ["".join(t.text or "" for t in si.iter(NS + "t")) for si in root]


def _sheet_paths(z: zipfile.ZipFile) -> dict[str, str]:
    """Nome del foglio -> path XML interno, risolvendo le relationship del workbook."""
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rel_ns = "{http://schemas.openxmlformats.org/package/2006/relationships}"
    id_to_target = {
        r.get("Id"): (r.get("Target") or "").lstrip("/")
        for r in rels.iter(rel_ns + "Relationship")
    }

    workbook = ET.fromstring(z.read("xl/workbook.xml"))
    doc_rel = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"

    paths: dict[str, str] = {}
    for sheet in workbook.iter(NS + "sheet"):
        target = id_to_target.get(sheet.get(doc_rel), "")
        if not target.startswith("xl/"):
            target = "xl/" + target
        paths[sheet.get("name")] = target
    return paths


def _rows(z: zipfile.ZipFile, path: str, strings: list[str]) -> list[list[str]]:
    root = ET.fromstring(z.read(path))
    out: list[list[str]] = []
    for row in root.iter(NS + "row"):
        cells: list[str] = []
        for cell in row.iter(NS + "c"):
            # Tre modi di scrivere la stessa cosa, e un .xlsx puo' usarli tutti
            # e tre nello stesso foglio: indice nella shared table (t="s"),
            # testo scritto sul posto (t="inlineStr") o valore nudo.
            if cell.get("t") == "inlineStr":
                inline = cell.find(NS + "is")
                cells.append(
                    "".join(t.text or "" for t in inline.iter(NS + "t"))
                    if inline is not None
                    else ""
                )
                continue

            value = cell.find(NS + "v")
            if value is None or value.text is None:
                cells.append("")
            elif cell.get("t") == "s":
                cells.append(strings[int(value.text)])
            else:
                cells.append(value.text)
        out.append(cells)
    return out


def _players(rows: list[list[str]], sheet: str) -> list[list[str]]:
    """
    Isola le righe dati saltando il titolo decorativo e l'intestazione.

    L'intestazione si cerca per *contenuto* e non per indice: i fogli iniziano
    con una riga di titolo, e se il formato ufficiale ne guadagnasse un'altra un
    indice fisso importerebbe spazzatura senza che nulla protesti.
    """
    header_index = next(
        (i for i, r in enumerate(rows) if r[: len(EXPECTED_HEADER)] == EXPECTED_HEADER),
        None,
    )
    if header_index is None:
        raise XlsxError(
            f"Intestazione ufficiale non trovata nel foglio '{sheet}'. "
            f"Attesa: {EXPECTED_HEADER}. Il tracciato record e' cambiato."
        )

    players: list[list[str]] = []
    for row in rows[header_index + 1 :]:
        row = row[: len(EXPECTED_HEADER)]
        if not row or not row[0].strip():  # riga vuota / coda del foglio
            continue
        row += [""] * (len(EXPECTED_HEADER) - len(row))  # trailing omesse da Excel
        players.append(row)
    return players


def _to_int(value: str) -> int:
    try:
        return int(float((value or "0").replace(",", ".")))
    except ValueError:
        return 0


def _to_row(cells: list[str], is_active: bool) -> QuotazioneRow:
    mantra = (cells[2] or "").strip()
    return QuotazioneRow(
        id=_to_int(cells[0]),
        role=(cells[1] or "").strip().upper(),
        role_mantra=mantra or None,
        name=(cells[3] or "").strip(),
        team=(cells[4] or "").strip(),
        qt_a=_to_int(cells[5]),
        qt_i=_to_int(cells[6]),
        qt_a_m=_to_int(cells[8]),
        qt_i_m=_to_int(cells[9]),
        fvm=_to_int(cells[11]),
        fvm_m=_to_int(cells[12]),
        is_active=is_active,
    )


def read_rows(path: Path) -> list[QuotazioneRow]:
    """Il listone dell'.xlsx nella stessa forma che produce lo scraping HTML."""
    if not path.exists():
        raise XlsxError(f"File non trovato: {path}")

    with zipfile.ZipFile(path) as archive:
        strings = _shared_strings(archive)
        paths = _sheet_paths(archive)

        missing = [name for name in ("Tutti", "Ceduti") if name not in paths]
        if missing:
            raise XlsxError(
                f"Fogli {missing} assenti. Trovati: {list(paths)}. "
                "Senza 'Ceduti' non si distingue un giocatore uscito dalla Serie A."
            )

        attivi = _players(_rows(archive, paths["Tutti"], strings), "Tutti")
        ceduti = _players(_rows(archive, paths["Ceduti"], strings), "Ceduti")

    # Chi e' stato venduto e poi ricomprato compare in entrambi: vince "Tutti".
    ids_attivi = {r[0] for r in attivi}
    ceduti = [r for r in ceduti if r[0] not in ids_attivi]

    righe = [_to_row(r, True) for r in attivi] + [_to_row(r, False) for r in ceduti]
    return [r for r in righe if r.id > 0]
