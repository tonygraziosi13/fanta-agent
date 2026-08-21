"""
Dati tattici per squadra: parsing e aggregazione, senza rete.

Il test che conta piu' di tutti e' quello sul PPDA. E' un rapporto, e la media
dei rapporti non e' il rapporto delle somme: sbagliarlo produce un numero
plausibile, dello stesso ordine di grandezza, che nessuno noterebbe mai
guardando il file. Gli altri controllano le forme HTML che, cambiando, farebbero
uscire dei `null` invece di un errore.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from dataset import coaches
from dataset.coaches import (
    CoachesError,
    aggregate_history,
    aggregate_squads,
    parse_clubs,
    parse_formation,
    parse_head_coach,
)
from dataset.normalize import normalize_team

# Riproduce la forma reale: lo stesso club compare piu' volte nella pagina.
CLUBS_HTML = """
<table class="items"><tbody>
  <tr><td><a href="/ac-mailand/startseite/verein/5/saison_id/2026" title="AC Milan">
      <img src="milan.png"/></a></td></tr>
  <tr><td><a href="/ac-mailand/startseite/verein/5/saison_id/2026">AC Milan</a></td></tr>
  <tr><td><a href="/ac-monza/startseite/verein/2919/saison_id/2026" title="AC Monza">
      <img src="monza.png"/></a></td></tr>
</tbody></table>
"""

# Ogni membro dello staff sta in una tabella annidata: nome, poi ruolo.
# Il vice viene prima dell'allenatore di proposito: se il codice prendesse la
# prima ancora `/profil/trainer/` che trova, questo test fallirebbe.
STAFF_HTML = """
<table class="items"><tbody>
  <tr><td>
    <table><tr><td><a href="/carlos-fernandes/profil/trainer/100686">Carlos Fernandes</a></td></tr>
           <tr><td>Vice allenatore</td></tr></table>
  </td></tr>
  <tr><td>
    <table><tr><td><a href="/ruben-amorim/profil/trainer/65202">Rúben Amorim</a></td></tr>
           <tr><td>Allenatore</td></tr></table>
  </td></tr>
  <tr><td>
    <table><tr><td><a href="/jorge-vital/profil/trainer/5226">Jorge Vital</a></td></tr>
           <tr><td>Preparatore dei portieri</td></tr></table>
  </td></tr>
</tbody></table>
"""

PROFILE_HTML = """
<table>
  <tr><th>Data di nascita:</th><td>27/01/1985</td></tr>
  <tr><th>Nazionalità:</th><td>Portogallo</td></tr>
  <tr><th>Modulo più utilizzato ultimi 2 anni:</th><td>3-4-2-1</td></tr>
</table>
"""


class ParseClubsTest(unittest.TestCase):
    def test_deduplica_per_id(self):
        """Lo stesso club compare come stemma e come nome: e' una squadra sola."""
        clubs = parse_clubs(CLUBS_HTML)

        self.assertEqual(len(clubs), 2)
        self.assertEqual({c.club_id for c in clubs}, {"5", "2919"})

    def test_estrae_nome_e_slug(self):
        milan = next(c for c in parse_clubs(CLUBS_HTML) if c.club_id == "5")

        self.assertEqual(milan.name, "AC Milan")
        self.assertEqual(milan.slug, "ac-mailand")

    def test_ac_monza_collassa_su_monza(self):
        """
        Per struttura e non per elenco: "ac monza" non e' fra gli alias, e la
        sigla societaria viene tolta da `_strip_club_form`. E' il caso che
        aveva lasciato scoperto il portiere del Monza nel dataset giocatori.
        """
        monza = next(c for c in parse_clubs(CLUBS_HTML) if c.club_id == "2919")

        self.assertEqual(monza.key, normalize_team("Monza"))
        self.assertEqual(monza.key, "monza")


class ParseCoachTest(unittest.TestCase):
    def test_prende_l_allenatore_non_il_vice(self):
        """
        "Vice allenatore" contiene "allenatore": un confronto per sottostringa
        restituirebbe il vice, che nella pagina viene prima.
        """
        head = parse_head_coach(STAFF_HTML)

        self.assertIsNotNone(head)
        self.assertEqual(head[0], "Rúben Amorim")
        self.assertIn("/profil/trainer/65202", head[1])

    def test_staff_senza_allenatore(self):
        senza = STAFF_HTML.replace("<td>Allenatore</td>", "<td>Team manager</td>")

        self.assertIsNone(parse_head_coach(senza))


class ParseFormationTest(unittest.TestCase):
    def test_legge_il_modulo(self):
        self.assertEqual(parse_formation(PROFILE_HTML), "3-4-2-1")

    def test_trova_il_modulo_anche_se_la_riga_si_sposta(self):
        """
        Le righe di quella tabella cambiano da un allenatore all'altro: chi non
        ha allenato una nazionale ne ha una in meno. Un indice fisso leggerebbe
        il campo sbagliato senza accorgersene.
        """
        spostato = """
        <table>
          <tr><th>Modulo più utilizzato ultimi 2 anni:</th><td>4-3-3</td></tr>
          <tr><th>Data di nascita:</th><td>01/01/1970</td></tr>
        </table>
        """
        self.assertEqual(parse_formation(spostato), "4-3-3")

    def test_un_valore_non_valido_diventa_null(self):
        """Meglio nessun modulo che una stringa spuria travestita da dato."""
        rotto = PROFILE_HTML.replace("<td>3-4-2-1</td>", "<td>non disponibile</td>")

        self.assertIsNone(parse_formation(rotto))

    def test_profilo_senza_riga_modulo(self):
        senza = PROFILE_HTML.replace("Modulo più utilizzato ultimi 2 anni:", "Contratto fino al:")

        self.assertIsNone(parse_formation(senza))


class AggregateTest(unittest.TestCase):
    def test_il_ppda_non_si_media(self):
        """
        Il cuore della decisione presa qui.

        Due partite: una di dominio (285 passaggi concessi, 15 azioni difensive
        -> PPDA 19) e una equilibrata (20 e 20 -> PPDA 1). La media aritmetica
        direbbe 10; il PPDA di stagione e' 305/35 = 8.71, ed e' la definizione
        stessa della metrica.

        Sbagliarlo produce un numero plausibile che nessuno verificherebbe.
        """
        history = [
            {"xG": 1.0, "xGA": 0.5, "ppda": {"att": 285, "def": 15}},
            {"xG": 1.0, "xGA": 0.5, "ppda": {"att": 20, "def": 20}},
        ]

        _xg, _xga, ppda = aggregate_history(history)

        self.assertAlmostEqual(ppda, 305 / 35, places=2)
        media_sbagliata = (285 / 15 + 20 / 20) / 2
        self.assertNotAlmostEqual(ppda, media_sbagliata, places=1)

    def test_somma_xg_e_xga(self):
        history = [
            {"xG": 1.25, "xGA": 0.75, "ppda": {"att": 10, "def": 10}},
            {"xG": 2.25, "xGA": 1.25, "ppda": {"att": 10, "def": 10}},
        ]

        xg, xga, _ppda = aggregate_history(history)

        self.assertAlmostEqual(xg, 3.5)
        self.assertAlmostEqual(xga, 2.0)

    def test_stagione_vuota_non_e_zero_ppda(self):
        """Senza partite non c'e' pressing da misurare: null, non zero."""
        xg, xga, ppda = aggregate_history([])

        self.assertEqual((xg, xga), (0.0, 0.0))
        self.assertIsNone(ppda)

    def test_forma_inattesa_solleva(self):
        """
        Uno zero di xG e' indistinguibile da una squadra che non tira mai:
        se la fonte cambia forma bisogna fermarsi, non pubblicare.
        """
        with self.assertRaises(CoachesError):
            aggregate_history([{"xG": 1.0, "xGA": 0.5}])  # manca ppda


def giocatore(squadra, ruolo="F S", presenze=30, gol=0, gialli=0, rossi=0):
    return {
        "team_title": squadra,
        "position": ruolo,
        "games": presenze,
        "goals": gol,
        "yellow_cards": gialli,
        "red_cards": rossi,
    }


class SquadStatsTest(unittest.TestCase):
    """Turnover, cartellini e distribuzione dei gol dal blocco `players`."""

    def test_il_trasferito_conta_nel_turnover_di_entrambe_ma_i_cartellini_in_nessuna(self):
        """
        La decisione meno deducibile di tutto il modulo, e quella che qualcuno
        rifarebbe "uniforme" credendo di semplificare.

        Understat da' una riga sola per stagione, con le statistiche gia' sommate
        fra le due squadre: la ripartizione non esiste. Il turnover lo conta in
        entrambe perche' entrambe lo hanno davvero schierato — e' esattamente
        cio' che l'indice misura. I cartellini in nessuna, perche' darli a tutte
        e due significherebbe gonfiare due numeri con dati inventati.
        """
        squads = aggregate_squads(
            [
                giocatore("Napoli", gialli=5),
                giocatore("Torino", gialli=3),
                giocatore("Napoli,Torino", gialli=10, gol=7),
            ]
        )

        # Il turnover li conta tutti e due.
        self.assertEqual(squads["napoli"].giocatori_impiegati, 2)
        self.assertEqual(squads["torino"].giocatori_impiegati, 2)

        # I cartellini del trasferito non finiscono da nessuna parte.
        self.assertEqual(squads["napoli"].gialli, 5)
        self.assertEqual(squads["torino"].gialli, 3)

        # E nemmeno i suoi gol: numeratore e denominatore restano sulla stessa
        # popolazione.
        self.assertIsNone(squads["napoli"].distribuzione)

    def test_il_turnover_esclude_chi_non_e_mai_sceso_in_campo(self):
        """Chi ha zero presenze e' in rosa, non e' stato impiegato."""
        squads = aggregate_squads(
            [giocatore("Milan", presenze=20), giocatore("Milan", presenze=0)]
        )

        self.assertEqual(squads["milan"].giocatori_impiegati, 1)

    def test_le_percentuali_sommano_a_cento(self):
        squads = aggregate_squads(
            [
                giocatore("Milan", "D", gol=10),
                giocatore("Milan", "M", gol=20),
                giocatore("Milan", "F S", gol=70),
            ]
        )

        d = squads["milan"].distribuzione
        self.assertEqual((d.difensori, d.centrocampisti, d.attaccanti), (10, 20, 70))
        self.assertEqual(d.totale, 100)
        self.assertAlmostEqual(
            d.difensori_perc + d.centrocampisti_perc + d.attaccanti_perc, 100.0, places=1
        )
        self.assertAlmostEqual(d.attaccanti_perc, 70.0)

    def test_i_portieri_restano_fuori_dal_denominatore(self):
        """
        Un gol di portiere in campionato capita una volta ogni due stagioni:
        entrasse nel totale, le tre percentuali non sommerebbero piu' a 100 e
        nessuno capirebbe perche'.
        """
        squads = aggregate_squads(
            [giocatore("Milan", "F S", gol=9), giocatore("Milan", "GK", gol=1)]
        )

        d = squads["milan"].distribuzione
        self.assertEqual(d.totale, 9)
        self.assertAlmostEqual(d.attaccanti_perc, 100.0)

    def test_i_ruoli_composti_prendono_il_primo(self):
        """"F M S" e' un attaccante che ha giocato anche a centrocampo."""
        squads = aggregate_squads([giocatore("Milan", "F M S", gol=5)])

        self.assertEqual(squads["milan"].distribuzione.attaccanti, 5)

    def test_squadra_senza_gol_non_ha_distribuzione(self):
        """`0/0` non e' `0%`: senza gol non c'e' niente da distribuire."""
        squads = aggregate_squads([giocatore("Milan", "D", gol=0, gialli=4)])

        self.assertIsNone(squads["milan"].distribuzione)
        # I cartellini pero' ci sono: sono due domande diverse.
        self.assertEqual(squads["milan"].gialli, 4)

    def test_squadra_assente_non_e_zero(self):
        """
        Una neopromossa non compare fra i giocatori di Serie A. Quattro `null`,
        non quattro zeri: zero direbbe "non ha schierato nessuno", che e' falso.
        """
        squads = aggregate_squads([giocatore("Milan")])

        self.assertNotIn("frosinone", squads)

    def test_solo_trasferiti_niente_cartellini(self):
        """
        Senza nemmeno un giocatore mono-squadra il totale sarebbe zero, che e'
        un numero plausibile e sbagliato. Il turnover invece si sa.
        """
        squads = aggregate_squads([giocatore("Napoli,Torino", gialli=6)])

        self.assertEqual(squads["napoli"].giocatori_impiegati, 1)
        self.assertIsNone(squads["napoli"].gialli)
        self.assertIsNone(squads["napoli"].rossi)

    def test_somma_gialli_e_rossi(self):
        squads = aggregate_squads(
            [
                giocatore("Milan", gialli=7, rossi=1),
                giocatore("Milan", gialli=3, rossi=0),
            ]
        )

        self.assertEqual(squads["milan"].gialli, 10)
        self.assertEqual(squads["milan"].rossi, 1)

    def test_forma_inattesa_solleva(self):
        """Zero cartellini e' indistinguibile da una squadra irreprensibile."""
        with self.assertRaises(CoachesError):
            aggregate_squads([{"team_title": "Milan", "games": "molte"}])


class CollectTest(unittest.TestCase):
    """La cardinalita': un record per squadra del listone, sempre."""

    class FakeHttp:
        def __init__(self, pages: dict[str, str]) -> None:
            self.pages = pages
            self.calls: list[str] = []

        def fetch(self, url, params=None, **kwargs):
            if "getLeagueData" in url or "/league/" in url:
                key = "understat"
            elif "wettbewerb" in url:
                key = "clubs"
            elif "mitarbeiter" in url:
                key = "staff"
            else:
                key = "profile"
            self.calls.append(key)
            return self.pages[key]

    UNDERSTAT_JSON = "{\"teams\": {\"1\": {\"id\": \"1\", \"title\": \"Milan\", \"history\": [{\"xG\": 2.0, \"xGA\": 1.0, \"ppda\": {\"att\": 100, \"def\": 10}}]}}, \"players\": [{\"team_title\": \"Milan\", \"position\": \"F S\", \"games\": 30, \"goals\": 12, \"yellow_cards\": 4, \"red_cards\": 1}, {\"team_title\": \"Milan\", \"position\": \"D\", \"games\": 28, \"goals\": 3, \"yellow_cards\": 7, \"red_cards\": 0}, {\"team_title\": \"Milan\", \"position\": \"GK\", \"games\": 38, \"goals\": 0, \"yellow_cards\": 1, \"red_cards\": 0}]}"

    def _http(self):
        return self.FakeHttp(
            {
                "understat": self.UNDERSTAT_JSON,
                "clubs": CLUBS_HTML,
                "staff": STAFF_HTML,
                "profile": PROFILE_HTML,
            }
        )

    def test_una_squadra_scoperta_resta_nell_elenco(self):
        """
        Il Cagliari non e' nella pagina di Transfermarkt finta e non ha metriche
        Understat: deve comparire lo stesso, con i campi a null. Chi legge il
        file non deve distinguere "chiave mancante" da "dato mancante".
        """
        records = coaches.collect(
            self._http(), {"milan": "Milan", "cagliari": "Cagliari"}
        )

        self.assertEqual(len(records), 2)
        cagliari = next(r for r in records if r.squadra == "Cagliari")
        self.assertIsNone(cagliari.allenatore)
        self.assertIsNone(cagliari.modulo_base)
        self.assertIsNone(cagliari.xg_totali)

    def test_usa_il_nome_del_listone_non_quello_di_transfermarkt(self):
        """
        Transfermarkt scrive "AC Milan", il listone "Milan". Nel file va il
        secondo: e' il vocabolario dell'app, ed e' cio' che permettera'
        all'agente di unire questo file ai giocatori senza normalizzare di nuovo.
        """
        records = coaches.collect(self._http(), {"milan": "Milan"})

        self.assertEqual(records[0].squadra, "Milan")
        self.assertEqual(records[0].allenatore, "Rúben Amorim")
        self.assertEqual(records[0].modulo_base, "3-4-2-1")
        self.assertAlmostEqual(records[0].ppda_stagione, 10.0)

    def test_le_statistiche_di_rosa_arrivano_nel_record(self):
        records = coaches.collect(self._http(), {"milan": "Milan"})
        milan = records[0]

        # Tre giocatori con presenze, portiere compreso: il turnover li conta.
        self.assertEqual(milan.giocatori_impiegati_storico, 3)
        self.assertEqual(milan.gialli_totali, 12)
        self.assertEqual(milan.rossi_totali, 1)

        # Il portiere non entra nel denominatore: 15 gol, non 15 piu' i suoi 0.
        d = milan.distribuzione_gol
        self.assertEqual((d.difensori, d.attaccanti, d.totale), (3, 12, 15))
        self.assertAlmostEqual(d.attaccanti_perc, 80.0)

    def test_la_neopromossa_esce_con_quattro_null(self):
        records = coaches.collect(self._http(), {"milan": "Milan", "frosinone": "Frosinone"})
        frosinone = next(r for r in records if r.squadra == "Frosinone")

        self.assertIsNone(frosinone.giocatori_impiegati_storico)
        self.assertIsNone(frosinone.gialli_totali)
        self.assertIsNone(frosinone.rossi_totali)
        self.assertIsNone(frosinone.distribuzione_gol)

    def test_il_contratto_del_file(self):
        """
        Le chiavi che il consumatore trovera' nel JSON. Un campo rinominato qui
        romperebbe l'agente in silenzio, e nessun altro test lo intercetta.
        """
        from dataclasses import asdict

        record = asdict(coaches.collect(self._http(), {"milan": "Milan"})[0])

        self.assertEqual(
            list(record),
            [
                "allenatore",
                "squadra",
                "modulo_base",
                "xg_totali",
                "xga_totali",
                "ppda_stagione",
                "giocatori_impiegati_storico",
                "gialli_totali",
                "rossi_totali",
                "distribuzione_gol",
            ],
        )
        self.assertEqual(
            list(record["distribuzione_gol"]),
            [
                "difensori",
                "centrocampisti",
                "attaccanti",
                "totale",
                "difensori_perc",
                "centrocampisti_perc",
                "attaccanti_perc",
            ],
        )

    def test_limit_riduce_le_squadre(self):
        records = coaches.collect(
            self._http(), {"milan": "Milan", "cagliari": "Cagliari"}, limit=1
        )

        self.assertEqual(len(records), 1)


if __name__ == "__main__":
    unittest.main()
