"""
Stato d'asta: merge e pulizia dei nomi, senza browser.

La navigazione Playwright resta fuori, come resta fuori SQLite dai test
dell'app: richiede un browser vero e un account, e non e' quel che si rompe in
silenzio. Quel che si rompe in silenzio e' il merge — un rilancio a meta' asta
che azzera crediti e rose non solleva niente, riscrive e basta.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from dataset import asta
from dataset.asta import (
    DEFAULT_CREDITI,
    DEFAULT_SLOT,
    chiave,
    pulisci_nomi,
    sono_lo_stesso,
    unisci,
)


def salvata(nome, crediti=500, slot=None, rosa=None, proprietario=None, sono_io=False):
    """Una squadra come appare nel file gia' scritto."""
    return {
        "nome_squadra": nome,
        "proprietario": proprietario,
        "sono_io": sono_io,
        "crediti_residui": crediti,
        "slot_liberi": slot or dict(DEFAULT_SLOT),
        "rosa": rosa or [],
    }


class PulisciNomiTest(unittest.TestCase):
    def test_scarta_intestazioni_e_vuoti(self):
        nomi = pulisci_nomi(["Squadra", "  ", "Real Sporcaccioni", "\n", "Crediti"])

        self.assertEqual(nomi, ["Real Sporcaccioni"])

    def test_deduplica_preservando_l_ordine(self):
        """
        Lo stemma e il nome sono due nodi con lo stesso testo nella stessa riga:
        e' la stessa situazione dei club nella pagina di Transfermarkt.
        """
        nomi = pulisci_nomi(["Atletico Bar", "Real Sporcaccioni", "Atletico Bar"])

        self.assertEqual(nomi, ["Atletico Bar", "Real Sporcaccioni"])

    def test_collassa_gli_spazi(self):
        self.assertEqual(pulisci_nomi(["  Real   Sporcaccioni \n"]), ["Real Sporcaccioni"])

    def test_scarta_i_blocchi_di_pagina(self):
        """
        Un nome di squadra non e' un paragrafo: se e' lunghissimo, quel che
        abbiamo preso e' un pezzo di interfaccia e non una riga di elenco.
        """
        lungo = "Benvenuto nella tua lega, qui trovi tutte le informazioni sui partecipanti"

        self.assertEqual(pulisci_nomi([lungo, "Atletico Bar"]), ["Atletico Bar"])


class ChiaveTest(unittest.TestCase):
    def test_tollera_maiuscole_spazi_e_accenti(self):
        self.assertEqual(chiave("Io eTe"), chiave("IO  ETE"))
        self.assertEqual(chiave("Perù FC"), chiave("peru fc"))


class UnisciTest(unittest.TestCase):
    def test_una_squadra_nuova_parte_dai_default(self):
        merge = unisci(["Atletico Bar"], [])

        self.assertEqual(len(merge.squadre), 1)
        squadra = merge.squadre[0]
        self.assertEqual(squadra.crediti_residui, DEFAULT_CREDITI)
        self.assertEqual(squadra.slot_liberi, DEFAULT_SLOT)
        self.assertEqual(squadra.rosa, [])
        self.assertEqual(merge.nuove, ["Atletico Bar"])

    def test_una_squadra_gia_presente_conserva_tutto(self):
        """
        Il cuore della decisione presa qui: rilanciare lo script a meta' asta,
        perche' e' entrato un partecipante in ritardo, non deve azzerare due ore
        di lavoro. Se questo test cade, il danno non solleva niente — riscrive.
        """
        precedente = [
            salvata(
                "Atletico Bar",
                crediti=137,
                slot={"P": 1, "D": 3, "C": 2, "A": 0},
                rosa=[{"id": 5841, "prezzo": 63}],
            )
        ]

        merge = unisci(["Atletico Bar"], precedente)
        squadra = merge.squadre[0]

        self.assertEqual(squadra.crediti_residui, 137)
        self.assertEqual(squadra.slot_liberi, {"P": 1, "D": 3, "C": 2, "A": 0})
        self.assertEqual(squadra.rosa, [{"id": 5841, "prezzo": 63}])
        self.assertEqual(merge.nuove, [])
        self.assertEqual(merge.preservate, ["Atletico Bar"])

    def test_l_abbinamento_tollera_la_grafia_e_tiene_quella_nuova(self):
        """
        Il sito puo' cambiare spaziatura o maiuscole senza che sia un'altra
        squadra. Nel file finisce la grafia che il sito mostra *adesso*.
        """
        merge = unisci(["Atletico  BAR"], [salvata("atletico bar", crediti=200)])

        self.assertEqual(len(merge.squadre), 1)
        self.assertEqual(merge.squadre[0].nome_squadra, "Atletico BAR")
        self.assertEqual(merge.squadre[0].crediti_residui, 200)

    def test_una_squadra_sparita_resta_in_coda_ed_e_segnalata(self):
        """
        Distinguere "ha lasciato la lega" da "ha rinominato la squadra" e'
        impossibile dall'esterno, e cancellare una rosa costruita in asta e'
        irreversibile. Stesso istinto di `quotazioni.merge_with_previous`.
        """
        precedente = [salvata("Vecchia Gloria", crediti=42, rosa=[{"id": 1}])]

        merge = unisci(["Atletico Bar"], precedente)

        self.assertEqual([s.nome_squadra for s in merge.squadre], ["Atletico Bar", "Vecchia Gloria"])
        self.assertEqual(merge.sparite, ["Vecchia Gloria"])
        # E la sua rosa e' ancora li'.
        self.assertEqual(merge.squadre[1].rosa, [{"id": 1}])
        self.assertEqual(merge.squadre[1].crediti_residui, 42)

    def test_una_rinomina_non_crea_un_doppione(self):
        """
        Il caso vero: ginso rinomina "COCO FANS" in "FRATELLI MANNA SRL". Senza
        riconoscerlo si ritroverebbe due volte al tavolo, con 500 crediti a
        testa — cioe' un avversario inventato che secondo l'app puo' rilanciare.
        """
        precedente = [
            salvata("COCO FANS", crediti=310, proprietario="ginso", rosa=[{"id": 7, "prezzo": 41}])
        ]

        merge = unisci([("FRATELLI MANNA SRL", "ginso")], precedente)

        self.assertEqual([s.nome_squadra for s in merge.squadre], ["FRATELLI MANNA SRL"])
        self.assertEqual(merge.rinominate, [("COCO FANS", "FRATELLI MANNA SRL")])
        self.assertEqual(merge.sparite, [])
        self.assertEqual(merge.nuove, [])

    def test_la_rinominata_porta_con_se_crediti_slot_e_rosa(self):
        """Il nome cambia, l'asta gia' giocata no."""
        precedente = [
            salvata(
                "COCO FANS",
                crediti=310,
                slot={"P": 2, "D": 6, "C": 8, "A": 6},
                rosa=[{"id": 7, "prezzo": 41}],
                proprietario="ginso",
                sono_io=True,
            )
        ]

        squadra = unisci([("FRATELLI MANNA SRL", "ginso")], precedente).squadre[0]

        self.assertEqual(squadra.crediti_residui, 310)
        self.assertEqual(squadra.slot_liberi, {"P": 2, "D": 6, "C": 8, "A": 6})
        self.assertEqual(squadra.rosa, [{"id": 7, "prezzo": 41}])
        self.assertTrue(squadra.sono_io)

    def test_due_sparite_dello_stesso_proprietario_non_si_indovinano(self):
        """
        Con due candidate non c'e' modo di sapere quale sia diventata quale, e
        spostare una rosa costruita in asta su un'ipotesi e' irreversibile. Si
        ricade sul comportamento prudente di prima.
        """
        precedente = [
            salvata("Prima", proprietario="ginso", rosa=[{"id": 1}]),
            salvata("Seconda", proprietario="ginso", rosa=[{"id": 2}]),
        ]

        merge = unisci([("Terza", "ginso")], precedente)

        self.assertEqual(merge.rinominate, [])
        self.assertEqual(merge.nuove, ["Terza"])
        self.assertEqual(sorted(merge.sparite), ["Prima", "Seconda"])

    def test_senza_proprietario_non_si_accoppia_niente(self):
        """
        Un proprietario vuoto accoppierebbe fra loro tutte le squadre di cui non
        sappiamo niente: e' l'assenza di prova, non una prova.
        """
        merge = unisci(["Nuova"], [salvata("Vecchia", rosa=[{"id": 1}])])

        self.assertEqual(merge.rinominate, [])
        self.assertEqual(merge.sparite, ["Vecchia"])

    def test_proprietari_diversi_restano_squadre_diverse(self):
        merge = unisci([("Nuova", "mario")], [salvata("Vecchia", proprietario="ginso")])

        self.assertEqual(merge.rinominate, [])
        self.assertEqual(merge.nuove, ["Nuova"])
        self.assertEqual(merge.sparite, ["Vecchia"])

    def test_l_ordine_e_quello_del_sito(self):
        precedente = [salvata("Zeta"), salvata("Alfa")]

        merge = unisci(["Alfa", "Beta", "Zeta"], precedente)

        self.assertEqual([s.nome_squadra for s in merge.squadre], ["Alfa", "Beta", "Zeta"])

    def test_due_squadre_non_condividono_gli_slot(self):
        """
        `dict(DEFAULT_SLOT)` e non il riferimento: con lo stesso dizionario,
        scalare un portiere a una squadra lo scalerebbe a tutte.
        """
        merge = unisci(["Alfa", "Beta"], [])
        merge.squadre[0].slot_liberi["P"] -= 1

        self.assertEqual(merge.squadre[1].slot_liberi["P"], DEFAULT_SLOT["P"])

    def test_uno_stato_precedente_corrotto_non_blocca(self):
        """Un file illeggibile vale come assente: si riparte, non ci si ferma."""
        with TemporaryDirectory() as tmp:
            rotto = Path(tmp) / "stato_asta.json"
            rotto.write_text("{ non e' json", encoding="utf-8")

            self.assertEqual(asta.leggi_stato(rotto), [])


class MiaSquadraTest(unittest.TestCase):
    """
    Riconoscere la propria squadra e' cio' che permette all'agente di
    distinguere "i miei crediti" da "i crediti di chi mi contende il giocatore".
    """

    def test_il_nickname_abbreviato_combacia_con_lo_username(self):
        """
        Il sito mostra "tonygra13", il login e' "tonygraziosi1302": non c'e' un
        identificatore comune, solo il prefisso.
        """
        self.assertTrue(sono_lo_stesso("tonygra13", "tonygraziosi1302"))

    def test_una_squadra_con_due_proprietari(self):
        """
        Il sito scrive i comproprietari nella stessa cella, separati da un punto
        medio: "giacomo · tonygra13". Confrontare la stringa intera non trova
        mai niente, ed e' esattamente il caso della squadra dell'utente.
        """
        self.assertTrue(sono_lo_stesso("giacomo · tonygra13", "tonygraziosi1302"))
        self.assertFalse(sono_lo_stesso("giacomo · marco", "tonygraziosi1302"))

    def test_due_nickname_diversi_non_combaciano(self):
        self.assertFalse(sono_lo_stesso("Adolf", "tonygraziosi1302"))
        self.assertFalse(sono_lo_stesso("giacomo", "tonygraziosi1302"))

    def test_un_prefisso_corto_non_basta(self):
        """
        Sotto i sette caratteri due nickname qualunque possono somigliarsi per
        caso, e marcare la squadra sbagliata come propria e' peggio che non
        marcarne nessuna.
        """
        self.assertFalse(sono_lo_stesso("tony", "tonygraziosi1302"))

    def test_marca_la_squadra_dal_proprietario(self):
        merge = unisci(
            [("FC PIJATELI", "tonygra13"), ("BUNGA BUNGA", "Davide Lacerenza")],
            [],
            utente="tonygraziosi1302",
        )

        self.assertTrue(merge.squadre[0].sono_io)
        self.assertFalse(merge.squadre[1].sono_io)
        self.assertEqual(merge.squadre[1].proprietario, "Davide Lacerenza")

    def test_l_indicazione_esplicita_vince_sull_euristica(self):
        """`--mia-squadra` dispone, l'euristica si limita a proporre."""
        merge = unisci(
            [("FC PIJATELI", "tonygra13"), ("BUNGA BUNGA", "Davide Lacerenza")],
            [],
            utente="tonygraziosi1302",
            mia_squadra="BUNGA BUNGA",
        )

        self.assertFalse(merge.squadre[0].sono_io)
        self.assertTrue(merge.squadre[1].sono_io)

    def test_conserva_il_proprietario_gia_salvato(self):
        """Se il sito smette di esporlo, non si perde quello che avevamo."""
        merge = unisci(
            ["BUNGA BUNGA"], [salvata("BUNGA BUNGA", proprietario="Davide Lacerenza")]
        )

        self.assertEqual(merge.squadre[0].proprietario, "Davide Lacerenza")

    def test_conserva_sono_io_gia_salvato(self):
        merge = unisci(["FC PIJATELI"], [salvata("FC PIJATELI", sono_io=True)])

        self.assertTrue(merge.squadre[0].sono_io)

    def test_accetta_anche_i_soli_nomi(self):
        """La forma senza proprietario resta valida: tiene leggibili i test."""
        merge = unisci(["Alfa", "Beta"], [])

        self.assertEqual(len(merge.squadre), 2)
        self.assertIsNone(merge.squadre[0].proprietario)
        self.assertFalse(merge.squadre[0].sono_io)


class ContrattoTest(unittest.TestCase):
    def test_le_chiavi_del_file(self):
        """
        La forma che il consumatore trovera' nel JSON. Un campo rinominato qui
        romperebbe l'agente in silenzio.
        """
        from dataclasses import asdict

        record = asdict(unisci(["Atletico Bar"], []).squadre[0])

        self.assertEqual(
            list(record),
            [
                "nome_squadra",
                "proprietario",
                "sono_io",
                "crediti_residui",
                "slot_liberi",
                "rosa",
            ],
        )
        self.assertEqual(list(record["slot_liberi"]), ["P", "D", "C", "A"])
        self.assertEqual(record["slot_liberi"], {"P": 3, "D": 8, "C": 8, "A": 6})
        self.assertEqual(record["crediti_residui"], 500)

    def test_scrittura_e_rilettura(self):
        with TemporaryDirectory() as tmp:
            percorso = Path(tmp) / "stato_asta.json"
            merge = unisci(["Alfa", "Beta"], [])
            asta.scrivi(merge.squadre, percorso)

            riletto = asta.leggi_stato(percorso)
            self.assertEqual(len(riletto), 2)
            self.assertEqual(riletto[0]["nome_squadra"], "Alfa")

            # E il giro completo preserva: e' la garanzia end-to-end del merge.
            riletto[0]["crediti_residui"] = 250
            asta.scrivi(unisci(["Alfa", "Beta"], riletto).squadre, percorso)
            self.assertEqual(asta.leggi_stato(percorso)[0]["crediti_residui"], 250)


if __name__ == "__main__":
    unittest.main()
