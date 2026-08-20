"""
Lettura dell'.xlsx ufficiale (step 1 della pipeline).

L'.xlsx si costruisce qui dentro con `zipfile`, senza dipendenze e senza file di
prova da versionare: un .xlsx *e'* uno ZIP di XML, quindi scriverne uno finto e'
poco piu' che scrivere due stringhe.

Il caso che conta e' `IsActive`: viene dal foglio di provenienza, non da una
colonna. E' l'unico modo di sapere che un giocatore e' uscito dalla Serie A —
l'elenco delle quotazioni non toglie nessuno, i venduti restano con la loro
quotazione — e sbagliarlo rimette in asta un giocatore che non c'e' piu'.
"""

from __future__ import annotations

import sys
import unittest
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from dataset import listone_xlsx
from dataset.listone_xlsx import EXPECTED_HEADER, XlsxError

NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def _sheet_xml(rows: list[list[str]]) -> str:
    """Un foglio con tutte le celle come `inlineStr`, per non serializzare la shared table."""
    body = []
    for row in rows:
        cells = "".join(
            f'<c t="inlineStr"><is><t>{value}</t></is></c>' for value in row
        )
        body.append(f"<row>{cells}</row>")
    return f'<worksheet xmlns="{NS}"><sheetData>{"".join(body)}</sheetData></worksheet>'


def _player(player_id: str, name: str, team: str = "Roma") -> list[str]:
    return [player_id, "A", "Pc", name, team, "20", "18", "2", "22", "20", "2", "80", "85"]


def build_xlsx(path: Path, tutti: list[list[str]], ceduti: list[list[str]]) -> None:
    titolo = ["Quotazioni Fantacalcio Stagione 2026 27"]

    with zipfile.ZipFile(path, "w") as z:
        z.writestr(
            "xl/workbook.xml",
            f'<workbook xmlns="{NS}" xmlns:r="http://schemas.openxmlformats.org/'
            'officeDocument/2006/relationships"><sheets>'
            '<sheet name="Tutti" sheetId="1" r:id="rId1"/>'
            '<sheet name="Ceduti" sheetId="2" r:id="rId2"/>'
            "</sheets></workbook>",
        )
        z.writestr(
            "xl/_rels/workbook.xml.rels",
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>'
            '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/>'
            "</Relationships>",
        )
        z.writestr("xl/worksheets/sheet1.xml", _sheet_xml([titolo, EXPECTED_HEADER, *tutti]))
        z.writestr("xl/worksheets/sheet2.xml", _sheet_xml([titolo, EXPECTED_HEADER, *ceduti]))


class ReadRowsTest(unittest.TestCase):
    def _read(self, tutti, ceduti):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "listone.xlsx"
            build_xlsx(path, tutti, ceduti)
            return listone_xlsx.read_rows(path)

    def test_is_active_viene_dal_foglio(self):
        righe = self._read(
            [_player("101", "Dybala")],
            [_player("999", "Ceduto", "Milan")],
        )

        per_id = {r.id: r for r in righe}
        self.assertTrue(per_id[101].is_active)
        self.assertFalse(per_id[999].is_active)

    def test_il_ceduto_resta_nel_listone(self):
        """
        Non si cancella: le watchlist gia' costruite ci sono attaccate, e un
        giocatore che sparisce dal CSV sparisce anche dalle liste dell'utente.
        """
        righe = self._read([_player("101", "Dybala")], [_player("999", "Ceduto")])

        self.assertEqual(len(righe), 2)

    def test_venduto_e_ricomprato_resta_attivo(self):
        """Compare in entrambi i fogli: vince 'Tutti', che e' la rosa reale."""
        righe = self._read([_player("101", "Dybala")], [_player("101", "Dybala")])

        self.assertEqual(len(righe), 1)
        self.assertTrue(righe[0].is_active)

    def test_legge_le_quotazioni(self):
        righe = self._read([_player("101", "Dybala")], [])

        riga = righe[0]
        self.assertEqual(riga.name, "Dybala")
        self.assertEqual(riga.team, "Roma")
        self.assertEqual(riga.role, "A")
        self.assertEqual(riga.role_mantra, "Pc")
        self.assertEqual((riga.qt_a, riga.qt_i, riga.fvm), (20, 18, 80))

    def test_diff_si_calcola_e_non_si_legge(self):
        """
        `Diff.` e' `Qt.A - Qt.I`: `QuotazioneRow` lo deriva, cosi' il numero
        mostrato e le due quotazioni non possono divergere.
        """
        riga = self._read([_player("101", "Dybala")], [])[0]

        self.assertEqual(riga.to_csv()["Diff."], 2)

    def test_intestazione_cambiata_non_passa_in_silenzio(self):
        """
        Se il tracciato record cambia, meglio un errore che un CSV di spazzatura:
        un listone sbagliato produce un dataset sbagliato per tutta la stagione.
        """
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "listone.xlsx"
            build_xlsx(path, [], [])
            # Riscrive il foglio con un'intestazione diversa.
            with zipfile.ZipFile(path, "w") as z:
                z.writestr(
                    "xl/workbook.xml",
                    f'<workbook xmlns="{NS}" xmlns:r="http://schemas.openxmlformats.org/'
                    'officeDocument/2006/relationships"><sheets>'
                    '<sheet name="Tutti" sheetId="1" r:id="rId1"/>'
                    '<sheet name="Ceduti" sheetId="2" r:id="rId2"/>'
                    "</sheets></workbook>",
                )
                z.writestr(
                    "xl/_rels/workbook.xml.rels",
                    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>'
                    '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/>'
                    "</Relationships>",
                )
                z.writestr("xl/worksheets/sheet1.xml", _sheet_xml([["Nome", "Prezzo"]]))
                z.writestr("xl/worksheets/sheet2.xml", _sheet_xml([["Nome", "Prezzo"]]))

            with self.assertRaises(XlsxError):
                listone_xlsx.read_rows(path)


class CredentialsTest(unittest.TestCase):
    def test_senza_credenziali_si_ricade_sull_altra_strada(self):
        """
        Il download autenticato dichiara di non essere percorribile invece di
        terminare: chi chiama passa allo scraping della pagina pubblica, che non
        richiede login. E' quello che tiene in piedi il rilascio automatico se un
        runner CI non riesce ad autenticarsi.
        """
        import os

        from dataset.download_listone import DownloadError, credentials

        vecchie = {k: os.environ.pop(k, None) for k in ("FANTACALCIO_USER", "FANTACALCIO_PASS")}
        try:
            with self.assertRaises(DownloadError):
                credentials()
        finally:
            for chiave, valore in vecchie.items():
                if valore is not None:
                    os.environ[chiave] = valore


if __name__ == "__main__":
    unittest.main()
