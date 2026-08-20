"""
FBref (livello 2) e Understat multi-lega (livello 1).

Il parsing di FBref ha una particolarita' che nessun altro provider ha: le
tabelle utili stanno dentro *commenti HTML*, perche' il sito le monta in
javascript. Un parser che guardasse solo il DOM visibile non solleverebbe nulla
— restituirebbe semplicemente tiri e passaggi chiave sempre a null, che sembra
un giocatore che non tira mai.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from dataset import config
from dataset.http import HttpError, HttpResponse
from dataset.model import Advanced, CascadeState, Contribution, RosterEntry, Section
from dataset.providers.fbref import (
    FbrefProvider,
    aggregate_by_season,
    season_start_year,
    table_by_prefix,
    tables_by_id,
)
from dataset.providers.understat import decode_escapes, extract_players_data

STAGIONE = config.UNDERSTAT_SEASON

# Le tabelle di dettaglio arrivano commentate: e' il caso che conta.
PROFILE_HTML = f"""
<html><body>
<table id="stats_standard_dom_lg"><tbody>
  <tr>
    <th data-stat="year_id">{STAGIONE}-{int(STAGIONE) + 1}</th>
    <td data-stat="games">20</td><td data-stat="minutes">1,800</td>
    <td data-stat="goals">7</td><td data-stat="assists">3</td>
    <td data-stat="cards_yellow">4</td><td data-stat="cards_red">0</td>
    <td data-stat="xg">6.4</td><td data-stat="npxg">5.1</td><td data-stat="xg_assist">2.2</td>
  </tr>
  <tr>
    <th data-stat="year_id">{STAGIONE}-{int(STAGIONE) + 1}</th>
    <td data-stat="games">5</td><td data-stat="minutes">400</td>
    <td data-stat="goals">2</td><td data-stat="assists">1</td>
    <td data-stat="cards_yellow">1</td><td data-stat="cards_red">1</td>
    <td data-stat="xg">1.6</td><td data-stat="npxg">1.6</td><td data-stat="xg_assist">0.8</td>
  </tr>
  <tr><th data-stat="year_id">Total</th><td data-stat="games">25</td></tr>
</tbody></table>
<!--
<table id="stats_shooting_dom_lg"><tbody>
  <tr><th data-stat="year_id">{STAGIONE}-{int(STAGIONE) + 1}</th><td data-stat="shots">44</td></tr>
</tbody></table>
-->
<!--
<table id="stats_passing_dom_lg"><tbody>
  <tr><th data-stat="year_id">{STAGIONE}-{int(STAGIONE) + 1}</th><td data-stat="assisted_shots">18</td></tr>
</tbody></table>
-->
</body></html>
"""

SEARCH_HTML = """
<div class="search-item">
  <a href="/en/players/abcd1234/Mario-Rossi">Mario Rossi</a>
  <div>Roma · Serie B</div>
</div>
"""


class FakeFbrefHttp:
    """Sostituto di `HttpClient` per FBref: risponde per tipo di URL."""

    def __init__(self, *, refuse: int = 0) -> None:
        self.calls: list[str] = []
        self.refuse = refuse

    def fetch_response(self, url, params=None, **kwargs):
        kind = "search" if "search.fcgi" in url else "profile"
        self.calls.append(kind)
        if self.refuse:
            self.refuse -= 1
            raise HttpError(f"HTTP 403 su {url}", status=403)
        body = SEARCH_HTML if kind == "search" else PROFILE_HTML
        return HttpResponse(text=body, url=url)


def entry(player_id: int = 1, name: str = "Rossi", team: str = "Roma") -> RosterEntry:
    return RosterEntry(
        id=player_id, role="A", role_mantra=None, name=name, team=team,
        qt_a=10, qt_i=10, diff=0, qt_a_m=10, qt_i_m=10, diff_m=0,
        fvm=20, fvm_m=20, is_active=True,
    )


class ParsingTest(unittest.TestCase):
    def test_le_tabelle_commentate_vengono_lette(self):
        tables = tables_by_id(PROFILE_HTML)

        self.assertIn("stats_standard_dom_lg", tables)
        # Queste due sono dentro un commento HTML: senza riparsarlo mancherebbero.
        self.assertIn("stats_shooting_dom_lg", tables)
        self.assertIn("stats_passing_dom_lg", tables)

    def test_due_righe_della_stessa_stagione_si_sommano(self):
        """
        Chi si trasferisce a gennaio ha due righe per la stessa annata: prenderne
        una sola restituirebbe mezzo campionato.
        """
        tables = tables_by_id(PROFILE_HTML)
        per_anno = aggregate_by_season(
            table_by_prefix(tables, "stats_standard"),
            {"presenze": "games", "minuti": "minutes", "gol": "goals"},
        )

        self.assertEqual(per_anno[int(STAGIONE)]["presenze"], 25)
        self.assertEqual(per_anno[int(STAGIONE)]["minuti"], 2200)
        self.assertEqual(per_anno[int(STAGIONE)]["gol"], 9)

    def test_le_righe_di_totale_si_scartano(self):
        """'Total' e 'Career' non sono stagioni: contarle raddoppierebbe tutto."""
        self.assertIsNone(season_start_year("Total"))
        self.assertIsNone(season_start_year(""))
        self.assertEqual(season_start_year("2024-2025"), 2024)
        # Campionati a stagione solare (Brasile, MLS).
        self.assertEqual(season_start_year("2025"), 2025)

    def test_preferisce_il_campionato_alla_coppa(self):
        tables = {"stats_standard_dom_cup": "coppa", "stats_standard_dom_lg": "campionato"}

        self.assertEqual(table_by_prefix(tables, "stats_standard"), "campionato")


class CollectTest(unittest.TestCase):
    def test_estrae_rendimento_e_metriche(self):
        http = FakeFbrefHttp()
        outcome = FbrefProvider().collect([entry()], http, {}, CascadeState())

        contribution = outcome.contributions[1]
        self.assertEqual(contribution.performance.presenze, 25)
        self.assertEqual(contribution.performance.minuti, 2200)
        self.assertEqual(contribution.advanced.xg, 8.0)
        self.assertEqual(contribution.advanced.tiri, 44)
        self.assertEqual(contribution.advanced.key_passes, 18)

    def test_xg_chain_e_buildup_restano_null(self):
        """
        FBref non li calcola. Riempirli di zeri cancellerebbe la differenza fra
        un giocatore risolto al livello 1 e uno al livello 2.
        """
        http = FakeFbrefHttp()
        outcome = FbrefProvider().collect([entry()], http, {}, CascadeState())

        advanced = outcome.contributions[1].advanced
        self.assertIsNone(advanced.xg_chain)
        self.assertIsNone(advanced.xg_buildup)

    def test_non_gira_su_chi_e_gia_coperto(self):
        """La ragione per cui questo provider costa trenta richieste e non mille."""
        state = CascadeState()
        state.absorb({1: Contribution(advanced=Advanced(xg=1.0))})

        http = FakeFbrefHttp()
        outcome = FbrefProvider().collect([entry()], http, {}, state)

        self.assertEqual(http.calls, [])
        self.assertEqual(outcome.contributions, {})

    def test_interruttore_dopo_tre_rifiuti(self):
        """
        Cloudflare risponde 403 a tutti o a nessuno: insistere costa tre secondi
        a giocatore per nulla. Dopo tre rifiuti il livello si spegne.
        """
        http = FakeFbrefHttp(refuse=99)
        roster = [entry(i) for i in range(1, 21)]

        provider = FbrefProvider()
        outcome = provider.collect(roster, http, {}, CascadeState())

        self.assertTrue(provider.tripped)
        self.assertEqual(len(http.calls), config.FBREF_MAX_FAILURES)
        self.assertIsNotNone(outcome.failure)
        # Nessuno resta nel limbo: chi non e' stato cercato lo dice il report.
        self.assertEqual(len(outcome.unresolved), len(roster))

    def test_un_404_non_apre_l_interruttore(self):
        """
        Un giocatore che non esiste su FBref non dice nulla sulla nostra
        possibilita' di leggere il sito: spegnere il livello per quello
        significherebbe perdere i successivi per colpa di uno introvabile.
        """
        provider = FbrefProvider()
        provider._http = FakeFbrefHttp()
        provider._record(refused=False)

        for _ in range(config.FBREF_MAX_FAILURES + 2):
            provider._record(refused=False)

        self.assertFalse(provider.tripped)


class UnderstatMultiLegaTest(unittest.TestCase):
    def test_estrae_il_blocco_inline(self):
        players = [{"id": "1", "player_name": "Lautaro Martínez", "xG": "12.5"}]
        escaped = "".join(f"\\x{ord(c):02x}" if ord(c) < 128 else c for c in json.dumps(players))
        html = f"var playersData = JSON.parse('{escaped}');"

        estratti = extract_players_data(html)

        self.assertIsNotNone(estratti)
        self.assertEqual(estratti[0]["player_name"], "Lautaro Martínez")

    def test_blocco_assente_non_e_lega_vuota(self):
        """
        None significa "chiedi all'endpoint JSON", una lista vuota significa
        "questa lega non ha giocatori". Confonderli fa perdere una lega intera.
        """
        self.assertIsNone(extract_players_data("<html>niente</html>"))

    def test_gli_accenti_sopravvivono(self):
        """
        Senza il giro latin-1 -> utf-8 il nome arriverebbe storpiato, e un nome
        storpiato non combacia con nessuna riga del listone.
        """
        self.assertEqual(decode_escapes("Mart\\xc3\\xadnez"), "Martínez")


if __name__ == "__main__":
    unittest.main()
