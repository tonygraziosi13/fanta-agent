"""
Test dell'aggiornamento del listone dalle quotazioni ufficiali.

Due cose vanno protette qui, e non sono il parsing in se'.

La prima: **un ceduto non si cancella mai**. La pagina ufficiale non toglie
nessuno dall'elenco, marca e basta; se il parsing perdesse quel marcatore, un
giocatore venduto tornerebbe acquistabile, e se il merge lo scartasse le
watchlist che lo contengono si spezzerebbero. E' la stessa regola che il sync
applica lato app (US20-3), qui a monte.

La seconda: il CSV prodotto deve essere **identico nel tracciato** a quello che
scrive `xlsx_to_csv.py`. Sono due strade verso lo stesso file, e se divergessero
l'app vedrebbe due listoni diversi a seconda di come e' stato generato.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from dataset import quotazioni


def riga(pid, nome, ruolo, mantra, sigla, qa, qi, fvm, fuori=False) -> str:
    """Riproduce la struttura reale di una riga della pagina quotazioni."""
    marcatore = '<span class="out-of-game" title="Ceduto"></span>' if fuori else ""
    return f"""
    <tr class="player-row" data-filter-keywords="{nome}" data-filter-team-id="9"
        data-filter-role-classic="{ruolo.lower()}" data-filter-role-mantra="{mantra}">
      <th><a href="https://www.fantacalcio.it/serie-a/squadre/inter/{nome.lower()}/{pid}">{nome}</a>
          {marcatore}</th>
      <td data-col-key="sq">{sigla}</td>
      <td data-col-key="c_qi">{qi}</td>
      <td data-col-key="c_qa">{qa}</td>
      <td data-col-key="c_fvm">{fvm}</td>
      <td data-col-key="m_qi">{qi}</td>
      <td data-col-key="m_qa">{qa}</td>
      <td data-col-key="m_fvm">{fvm}</td>
    </tr>"""


PAGINA = "<table><tbody>" + "".join([
    riga(2764, "Martinez L.", "A", "pc", "INT", 35, 33, 370),
    riga(254, "Dimarco", "D", "e|w", "INT", 32, 32, 265),
    riga(5841, "Svilar", "P", "por", "ROM", 18, 18, 65),
    riga(999, "Lukaku", "A", "pc", "NAP", 20, 20, 180, fuori=True),
]) + "</tbody></table>"


def csv_row(pid, nome, ruolo="A", qa="10", attivo="1", squadra="Inter"):
    return {
        "Id": str(pid), "R": ruolo, "RM": "Pc", "Nome": nome, "Squadra": squadra,
        "Qt.A": qa, "Qt.I": qa, "Diff.": "0", "Qt.A M": qa, "Qt.I M": qa,
        "Diff.M": "0", "FVM": "100", "FVM M": "100", "IsActive": attivo,
    }


class ParseTest(unittest.TestCase):
    def setUp(self):
        self.righe = quotazioni.parse_quotazioni(PAGINA, {})
        self.per_nome = {r.name: r for r in self.righe}

    def test_legge_tutte_le_righe(self):
        self.assertEqual(len(self.righe), 4)

    def test_id_dallhref(self):
        """L'id e' la chiave primaria del listone: sbagliarlo sposta le quotazioni."""
        self.assertEqual(self.per_nome["Svilar"].id, 5841)

    def test_ruolo_mantra_nel_formato_del_listone(self):
        self.assertEqual(self.per_nome["Dimarco"].role_mantra, "E;W")
        self.assertEqual(self.per_nome["Svilar"].role_mantra, "Por")

    def test_quotazioni_e_differenza(self):
        row = self.per_nome["Martinez L."].to_csv()
        self.assertEqual(row["Qt.A"], 35)
        self.assertEqual(row["Qt.I"], 33)
        self.assertEqual(row["Diff."], 2)

    def test_out_of_game_marca_il_ceduto(self):
        self.assertFalse(self.per_nome["Lukaku"].is_active)
        self.assertTrue(self.per_nome["Svilar"].is_active)

    def test_squadra_dalla_sigla(self):
        self.assertEqual(self.per_nome["Svilar"].team, "Roma")

    def test_squadra_dal_csv_precedente_ha_la_precedenza(self):
        """Il nome che l'app gia' mostra vince sulla tabella delle sigle."""
        righe = quotazioni.parse_quotazioni(PAGINA, {"5841": "Roma Capitale"})
        self.assertEqual({r.name: r.team for r in righe}["Svilar"], "Roma Capitale")

    def test_pagina_irriconoscibile_solleva(self):
        """Meglio fermarsi che riscrivere il listone con zero giocatori."""
        with self.assertRaises(quotazioni.QuotazioniError):
            quotazioni.parse_quotazioni("<html><body>manutenzione</body></html>", {})


class MergeTest(unittest.TestCase):
    def setUp(self):
        self.righe = quotazioni.parse_quotazioni(PAGINA, {})

    def test_tracciato_identico_a_xlsx_to_csv(self):
        righe = quotazioni.merge_with_previous(self.righe, [])
        self.assertEqual(list(righe[0].keys()), quotazioni.HEADER)

    def test_il_ceduto_resta_nel_csv(self):
        righe = quotazioni.merge_with_previous(self.righe, [])
        lukaku = next(r for r in righe if r["Nome"] == "Lukaku")
        self.assertEqual(lukaku["IsActive"], 0)

    def test_chi_sparisce_dallelenco_non_si_perde(self):
        precedenti = [csv_row(4242, "Fantasma")]
        righe = quotazioni.merge_with_previous(self.righe, precedenti)
        fantasma = next(r for r in righe if r["Nome"] == "Fantasma")
        self.assertEqual(fantasma["IsActive"], 0)

    def test_attivi_prima_dei_ceduti(self):
        righe = quotazioni.merge_with_previous(self.righe, [])
        flags = [int(r["IsActive"]) for r in righe]
        self.assertEqual(flags, sorted(flags, reverse=True))

    def test_ordine_per_reparto_e_quotazione(self):
        righe = [r for r in quotazioni.merge_with_previous(self.righe, []) if r["IsActive"]]
        self.assertEqual([r["R"] for r in righe], ["P", "D", "A"])


class DiffTest(unittest.TestCase):
    def setUp(self):
        self.righe = quotazioni.parse_quotazioni(PAGINA, {})

    def test_nuovi_e_ceduti(self):
        precedenti = [csv_row(999, "Lukaku"), csv_row(5841, "Svilar", ruolo="P")]
        diff = quotazioni.diff_with_previous(self.righe, precedenti)
        self.assertEqual({r.name for r in diff.nuovi}, {"Martinez L.", "Dimarco"})
        self.assertEqual([r.name for r in diff.ceduti], ["Lukaku"])

    def test_quotazione_cambiata(self):
        precedenti = [csv_row(5841, "Svilar", ruolo="P", qa="15")]
        diff = quotazioni.diff_with_previous(self.righe, precedenti)
        self.assertIn(("Svilar", 15, 18), diff.quotazioni_cambiate)

    def test_nessuna_differenza(self):
        precedenti = [
            csv_row(r.id, r.name, r.role, str(r.qt_a), "1" if r.is_active else "0")
            for r in self.righe
        ]
        diff = quotazioni.diff_with_previous(self.righe, precedenti)
        self.assertTrue(diff.is_empty)


if __name__ == "__main__":
    unittest.main()
