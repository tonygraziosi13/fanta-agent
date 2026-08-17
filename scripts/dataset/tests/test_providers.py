"""
Test dei provider che non richiedono rete.

Coprono il parsing dell'HTML e le trasformazioni pure: sono le parti che si
rompono in silenzio quando una fonte cambia struttura, senza sollevare
un'eccezione — semplicemente i match crollano a zero.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from dataset.providers.fantacalcio_stats import FantacalcioStatsProvider
from dataset.providers.sofascore import build_heatmap
from dataset.providers.transfermarkt import TransfermarktProvider

# Riproduce la struttura reale della riga di ricerca di Transfermarkt.
# Il club e' "AS Roma" di proposito: e' il caso che ha rotto il parsing.
TRANSFERMARKT_SEARCH_HTML = """
<table class="items"><tbody>
  <tr>
    <td>
      <img title="Mile Svilar" alt="Mile Svilar"/>
      <a href="/mile-svilar/profil/spieler/338670">Mile Svilar</a>
      <img title="AS Roma" alt="AS Roma"/>
    </td>
    <td class="zentriert">POR</td>
    <td class="zentriert">26</td>
  </tr>
</tbody></table>
"""

FANTACALCIO_HTML = """
<table id="stats"><tbody>
  <tr class="player-row">
    <th class="player-name">
      <a href="https://www.fantacalcio.it/serie-a/squadre/roma/malen/5585/2025-26"><span>Malen</span></a>
    </th>
    <td data-col-key="sq">ROM</td>
    <td data-col-key="pg">18</td>
    <td data-col-key="mv">6,72</td>
    <td data-col-key="mfv">8,97</td>
    <td data-col-key="gol">14</td>
    <td data-col-key="ass">2</td>
    <td data-col-key="amm">1</td>
    <td data-col-key="esp">-</td>
  </tr>
</tbody></table>
"""


class TransfermarktParsingTest(unittest.TestCase):
    def test_il_ruolo_si_legge_dalla_cella_non_dal_testo_della_riga(self):
        """
        Regressione: "AS Roma" contiene "AS", che e' la sigla di ala sinistra.
        Leggendo il ruolo dal testo intero, un portiere diventava attaccante e il
        vincolo di ruolo lo scartava da tutti i portieri del listone.
        """
        candidates, slugs = TransfermarktProvider()._parse_search(TRANSFERMARKT_SEARCH_HTML)

        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0].role, "P")
        self.assertEqual(candidates[0].key, "338670")
        self.assertEqual(slugs["338670"], "mile-svilar")


INJURIES_HTML = """
<table><thead><tr><th>Stagione</th><th>Infortunio</th><th>da</th><th>fino al</th><th>giorni</th><th>Partite perse</th></tr></thead>
<tbody><tr><td>25/26</td><td>Problema muscolare</td><td>01/01/2026</td><td>21/01/2026</td><td>20 giorni</td><td>3</td></tr></tbody></table>
<table><thead><tr><th>Stagione</th><th>giorni</th><th>Infortuni</th><th>Partite perse</th></tr></thead>
<tbody><tr><td>25/26</td><td>20 giorni</td><td>1</td><td>3</td></tr></tbody></table>
"""


class FakeHttp:
    """
    Sostituto di `HttpClient`: e' possibile solo perche' nessun provider importa
    `requests` per conto proprio. Qui si vede il valore concreto di quella regola.
    """

    def __init__(self, pages: dict[str, str]) -> None:
        self.pages = pages
        self.calls: list[str] = []

    def fetch(self, url, params=None, **kwargs):
        key = "search" if "schnellsuche" in url else "injuries"
        self.calls.append(key)
        return self.pages[key]


def roster_entry(player_id: int, name: str, team: str, role: str = "P"):
    from dataset.model import RosterEntry

    return RosterEntry(
        id=player_id,
        role=role,
        role_mantra=None,
        name=name,
        team=team,
        qt_a=1,
        qt_i=1,
        diff=0,
        qt_a_m=1,
        qt_i_m=1,
        diff_m=0,
        fvm=1,
        fvm_m=1,
        is_active=True,
    )


class TransfermarktCollectTest(unittest.TestCase):
    def test_flusso_completo_su_un_giocatore(self):
        http = FakeHttp({"search": TRANSFERMARKT_SEARCH_HTML, "injuries": INJURIES_HTML})
        outcome = TransfermarktProvider().collect([roster_entry(1, "Svilar", "Roma")], http, {})

        self.assertIn(1, outcome.contributions)
        injuries = outcome.contributions[1].injuries
        self.assertEqual(injuries.days, 20)
        self.assertEqual(injuries.matches, 3)
        self.assertEqual(len(injuries.history), 1)
        # 20 giorni su una soglia di saturazione di 300: rischio quasi nullo.
        self.assertLess(injuries.risk, 0.1)

    def test_un_profilo_non_va_a_due_giocatori(self):
        """
        Due omonimi, un solo profilo: senza la fase di risoluzione dei conflitti
        entrambi riceverebbero lo storico clinico della stessa persona.
        """
        http = FakeHttp({"search": TRANSFERMARKT_SEARCH_HTML, "injuries": INJURIES_HTML})
        outcome = TransfermarktProvider().collect(
            [roster_entry(1, "Svilar", "Roma"), roster_entry(2, "Svilar", "Como")], http, {}
        )

        self.assertEqual(len(outcome.contributions), 1)
        self.assertEqual([e.id for e in outcome.unresolved], [2])
        # E la pagina infortuni si scarica una volta sola.
        self.assertEqual(http.calls.count("injuries"), 1)


    def test_la_mappa_manuale_scavalca_anche_la_ricerca(self):
        """
        Il caso Josep Martinez: la ricerca per cognome mostra una pagina sola e
        lui non ci compare. Un override che agisse solo sulla scelta fra i
        candidati trovati sarebbe inutile proprio quando serve.
        """
        http = FakeHttp({"search": TRANSFERMARKT_SEARCH_HTML, "injuries": INJURIES_HTML})
        outcome = TransfermarktProvider().collect(
            [roster_entry(5116, "Martinez Jo.", "Inter")],
            http,
            {"transfermarkt": {"5116": "388516"}},
        )

        self.assertIn(5116, outcome.contributions)
        self.assertEqual(outcome.matches[5116].strategy, "mappa-manuale")
        # Nessuna ricerca effettuata: si va dritti alla pagina infortuni.
        self.assertEqual(http.calls, ["injuries"])


class FantacalcioParsingTest(unittest.TestCase):
    def test_estrae_id_ufficiale_e_metriche(self):
        parsed = FantacalcioStatsProvider()._parse(FANTACALCIO_HTML)

        # L'id nell'URL e' lo stesso del listone: e' cio' che rende esatta la join.
        self.assertIn(5585, parsed)
        performance = parsed[5585]["performance"]
        self.assertEqual(performance.presenze, 18)
        # Virgola decimale italiana.
        self.assertAlmostEqual(performance.media_voto, 6.72)
        self.assertAlmostEqual(performance.fantamedia, 8.97)
        self.assertEqual(performance.gol, 14)
        # "-" significa assente, non zero.
        self.assertIsNone(performance.espulsioni)


class HeatmapTest(unittest.TestCase):
    def test_normalizza_sul_proprio_massimo(self):
        heatmap = build_heatmap([{"x": 10, "y": 10, "count": 5}, {"x": 90, "y": 90, "count": 1}], rows=2, cols=2)

        self.assertIsNotNone(heatmap)
        self.assertEqual(len(heatmap.cells), 4)
        self.assertEqual(max(heatmap.cells), 1.0)

    def test_nessun_punto_nessuna_heatmap(self):
        # Una griglia di zeri si disegnerebbe come "non gioca mai in campo".
        self.assertIsNone(build_heatmap([]))

    def test_ignora_punti_malformati(self):
        self.assertIsNone(build_heatmap([{"x": "boh", "y": None}], rows=2, cols=2))


if __name__ == "__main__":
    unittest.main()
