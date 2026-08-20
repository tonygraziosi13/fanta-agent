"""
La cascata a tre livelli e il delta di esecuzione.

Sono le due regole che decidono *quante richieste* la pipeline fa, e nessuna
delle due si rompe in modo rumoroso: una cascata che non filtra continua a
produrre un dataset corretto, solo pagando mille richieste in piu' a fonti che
poi ci rifiutano. E' esattamente il tipo di regressione che nessun altro test
intercetta.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from dataset import delta
from dataset.builder import build_records
from dataset.model import (
    Advanced,
    CascadeState,
    Contribution,
    Performance,
    RosterEntry,
    Section,
)


def entry(player_id: int, name: str = "Rossi", team: str = "Roma") -> RosterEntry:
    return RosterEntry(
        id=player_id,
        role="A",
        role_mantra=None,
        name=name,
        team=team,
        qt_a=10, qt_i=10, diff=0,
        qt_a_m=10, qt_i_m=10, diff_m=0,
        fvm=20, fvm_m=20,
        is_active=True,
    )


class CascadeStateTest(unittest.TestCase):
    def test_chi_ha_le_metriche_non_e_piu_in_coda(self):
        """E' l'unica ragione per cui FBref gira su trenta giocatori e non su 500."""
        roster = [entry(1), entry(2)]
        state = CascadeState()
        state.absorb({1: Contribution(advanced=Advanced(xg=0.5))})

        pendenti = [e.id for e in state.pending(roster, Section.ADVANCED)]

        self.assertEqual(pendenti, [2])

    def test_i_soli_minuti_non_coprono_il_rendimento(self):
        """
        Understat scrive i minuti anche a chi ha gia' il rendimento ufficiale.
        Se quel campo contasse come copertura, chi ha *solo* i minuti verrebbe
        escluso dal livello 3 — cioe' proprio da chi potrebbe dargli gol e
        assist.
        """
        state = CascadeState()
        state.absorb({1: Contribution(performance=Performance(minuti=900))})

        self.assertFalse(state.covers(1, Section.PERFORMANCE))

        state.absorb({1: Contribution(performance=Performance(presenze=30))})
        self.assertTrue(state.covers(1, Section.PERFORMANCE))

    def test_advanced_vuoto_non_copre(self):
        """Un contributo con tutti i campi a None non e' un dato: e' un buco."""
        state = CascadeState()
        state.absorb({1: Contribution(advanced=Advanced())})

        self.assertFalse(state.covers(1, Section.ADVANCED))


class MergeOrderTest(unittest.TestCase):
    def test_understat_non_cancella_le_presenze_ufficiali(self):
        """
        `merge_section` sovrascrive un non-null con un altro non-null: se
        Understat scrivesse le presenze di un'altra lega sopra quelle di
        Fantacalcio.it, l'utente vedrebbe in Serie A le partite giocate in Ligue 1.
        La difesa sta nel provider, che per chi e' gia' coperto scrive i soli
        minuti; qui si verifica che l'effetto arrivi fino al record finale.
        """
        roster = [entry(1)]
        records = build_records(
            roster,
            {
                "fantacalcio": {
                    1: Contribution(performance=Performance(presenze=30, media_voto=6.5))
                },
                "understat": {1: Contribution(performance=Performance(minuti=2700))},
            },
        )

        performance = records[0].performance
        self.assertEqual(performance.presenze, 30)
        self.assertEqual(performance.media_voto, 6.5)
        self.assertEqual(performance.minuti, 2700)

    def test_il_nome_esteso_viaggia_fra_i_livelli(self):
        """
        "Martinez" restituisce una pagina di omonimi; "Josep Martinez" trova il
        portiere. Il nome per esteso e' l'unica cosa che il livello 1 puo'
        regalare al livello 3, e va conservata nello stato.
        """
        state = CascadeState()
        state.full_names["5116"] = "Josep Martinez"

        self.assertEqual(state.full_names.get("5116"), "Josep Martinez")


class DeltaTest(unittest.TestCase):
    def _payload(self, *records: dict) -> dict:
        return {"players": list(records)}

    def _record(self, player_id: int, xg=0.4) -> dict:
        return {"id": player_id, "advanced": {"xg": xg}, "performance": {"presenze": 10}}

    def test_senza_dataset_precedente_si_rifa_tutto(self):
        piano = delta.plan([entry(1), entry(2)], None, {})

        self.assertEqual([e.id for e in piano.da_rifare], [1, 2])
        self.assertEqual(piano.saltati, 0)

    def test_chi_e_completo_si_riprende(self):
        piano = delta.plan(
            [entry(1)],
            self._payload(self._record(1)),
            {"1": [delta.COMPLETO, "1-understat"]},
        )

        self.assertEqual(piano.da_rifare, [])
        self.assertEqual(piano.saltati, 1)

    def test_un_fallito_torna_in_coda(self):
        """Un fallimento e' spesso un 403 di passaggio: vale un secondo tentativo."""
        piano = delta.plan(
            [entry(1)],
            self._payload(self._record(1)),
            {"1": [delta.FALLITO, "-"]},
        )

        self.assertEqual([e.id for e in piano.da_rifare], [1])

    def test_una_scheda_senza_livello_torna_in_coda(self):
        """
        Prodotta da una versione precedente della pipeline: e' proprio quella
        che i livelli nuovi possono recuperare.
        """
        piano = delta.plan([entry(1)], self._payload(self._record(1)), {})

        self.assertEqual([e.id for e in piano.da_rifare], [1])

    def test_livello_1_senza_metriche_e_una_contraddizione(self):
        piano = delta.plan(
            [entry(1)],
            self._payload({"id": 1, "advanced": {"xg": None}, "performance": {}}),
            {"1": [delta.PARZIALE, "1-understat"]},
        )

        self.assertEqual([e.id for e in piano.da_rifare], [1])

    def test_il_livello_3_senza_metriche_non_si_ripete(self):
        """
        Li' non c'e' altro da prendere: Transfermarkt non pubblica xG. Rifarlo a
        ogni avvio impedirebbe al delta di svuotarsi mai — il modo tipico in cui
        una cache incrementale smette di esserlo senza che nessuno se ne accorga.
        """
        piano = delta.plan(
            [entry(1)],
            self._payload({"id": 1, "advanced": {"xg": None}, "performance": {"gol": 3}}),
            {"1": [delta.PARZIALE, "3-transfermarkt"]},
        )

        self.assertEqual(piano.da_rifare, [])

    def test_un_giocatore_nuovo_e_sempre_da_fare(self):
        piano = delta.plan(
            [entry(1), entry(2)],
            self._payload(self._record(1)),
            {"1": [delta.COMPLETO, "1-understat"]},
        )

        self.assertEqual([e.id for e in piano.da_rifare], [2])
        self.assertEqual(piano.saltati, 1)

    def test_full_ignora_tutto(self):
        piano = delta.plan(
            [entry(1)],
            self._payload(self._record(1)),
            {"1": [delta.COMPLETO, "1-understat"]},
            full=True,
        )

        self.assertEqual([e.id for e in piano.da_rifare], [1])

    def test_classify_legge_il_livello_dalla_copertura(self):
        record = {"advanced": {"xg": 0.4}, "performance": {"gol": 2}}

        self.assertEqual(
            delta.classify(record, {"understat": True}), [delta.COMPLETO, "1-understat"]
        )
        self.assertEqual(
            delta.classify(record, {"fbref": True}), [delta.COMPLETO, "2-fbref"]
        )
        self.assertEqual(
            delta.classify({"advanced": {}, "performance": {}}, {}),
            [delta.FALLITO, delta.SENZA_LIVELLO],
        )


if __name__ == "__main__":
    unittest.main()
