"""
Test dell'entity resolution (US19-T2).

    python -m unittest discover -s scripts -p "test_*.py"

Solo stdlib: nessuna rete, nessun provider, nessuna dipendenza di scraping.
Il resolver e' la parte della pipeline in cui un errore non si vede — produce
comunque un dataset, solo con i dati della persona sbagliata — quindi e' quella
che vale la pena bloccare con dei test.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from dataset.model import RosterEntry
from dataset.normalize import (
    normalize_team,
    normalize_teams,
    normalize_text,
    parse_listone_name,
    parse_source_name,
)
from dataset.resolver import EntityResolver, make_candidate


def entry(name: str, team: str, role: str = "A", player_id: int = 1) -> RosterEntry:
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


class NormalizeTest(unittest.TestCase):
    def test_toglie_accenti_e_lettere_speciali(self):
        self.assertEqual(normalize_text("Milinković-Savić"), "milinkovic savic")
        # La 'ø' non e' scomponibile in NFKD: senza tabella dedicata sparirebbe.
        self.assertEqual(normalize_text("Højlund"), "hojlund")

    def test_apostrofi_equivalenti(self):
        # Il listone usa l'apostrofo ASCII, le fonti quello tipografico.
        self.assertEqual(normalize_text("N'Dri"), normalize_text("N’Dri"))

    def test_iniziali_singole_e_multiple(self):
        self.assertEqual(parse_listone_name("Martinez Jo.").surname, "martinez")
        self.assertEqual(parse_listone_name("Martinez Jo.").initials, "jo")
        # "F.P." = Francesco Pio: senza il pattern multi-punto resterebbe
        # attaccato al cognome.
        self.assertEqual(parse_listone_name("Esposito F.P.").surname, "esposito")

    def test_particelle_restano_nel_cognome(self):
        self.assertEqual(parse_source_name("Giovanni Di Lorenzo").surname, "di lorenzo")
        self.assertEqual(parse_source_name("Virgil van Dijk").surname, "van dijk")

    def test_squadre_multiple(self):
        # Understat elenca entrambi i club di chi si e' trasferito a stagione in corso.
        self.assertEqual(normalize_teams("Napoli,Torino"), {"napoli", "torino"})
        self.assertEqual(normalize_team("AC Milan"), "milan")

    def test_sigla_societaria_tolta_per_struttura(self):
        """
        Regressione: "ac monza" non era nella tabella degli alias, e il portiere
        del Monza restava senza statistiche pur avendo davanti un candidato con
        cognome, ruolo e squadra giusti. Nessun errore, solo un match in meno.
        Ora la sigla si toglie per struttura e la tabella non va piu' inseguita
        a ogni promozione.
        """
        for grezzo, atteso in [
            ("AC Monza", "monza"),
            ("Venezia FC", "venezia"),
            ("Frosinone Calcio", "frosinone"),
            ("Bologna FC 1909", "bologna"),
            ("US Cremonese", "cremonese"),
        ]:
            self.assertEqual(normalize_team(grezzo), atteso, grezzo)

    def test_alias_restano_per_cio_che_la_struttura_non_deduce(self):
        self.assertEqual(normalize_team("FC Internazionale"), "inter")
        self.assertEqual(normalize_team("Hellas Verona"), "verona")

    def test_non_confonde_club_diversi(self):
        # Togliere le sigle non deve fondere squadre che sigle a parte
        # restano distinte.
        self.assertNotEqual(normalize_team("Club Atletico Morelia"), normalize_team("AC Monza"))
        self.assertEqual(normalize_team("svincolato"), "svincolato")


class ResolverTest(unittest.TestCase):
    def test_caso_martinez_non_fonde_portiere_e_attaccante(self):
        """Il test che giustifica il vincolo di ruolo: stesso cognome, stessa squadra."""
        candidates = [
            make_candidate("7006", "Lautaro Martínez", {"inter"}, role="A"),
            make_candidate("9999", "Josep Martínez", {"inter"}, role="P"),
        ]
        resolver = EntityResolver("understat", candidates)

        portiere = resolver.resolve(entry("Martinez Jo.", "Inter", role="P"), "inter")
        attaccante = resolver.resolve(entry("Martinez L.", "Inter", role="A"), "inter")

        self.assertIsNotNone(portiere)
        self.assertIsNotNone(attaccante)
        self.assertEqual(portiere.candidate.key, "9999")
        self.assertEqual(attaccante.candidate.key, "7006")

    def test_cognome_composto_contro_nome_completo(self):
        candidates = [make_candidate("1", "Vanja Milinković-Savić", {"torino"}, role="P")]
        resolver = EntityResolver("understat", candidates)
        # Il listone lo da' gia' al Napoli: la squadra e' cambiata nel mercato.
        match = resolver.resolve(entry("Milinkovic-Savic V.", "Napoli", role="P"), "napoli")
        self.assertIsNotNone(match)
        self.assertEqual(match.candidate.key, "1")

    def test_nome_della_fonte_piu_lungo(self):
        candidates = [make_candidate("8313", "Pierre Kalulu Kyatengwa", {"juventus"}, role="D")]
        resolver = EntityResolver("understat", candidates)
        match = resolver.resolve(entry("Kalulu", "Juventus", role="D"), "juventus")
        self.assertIsNotNone(match)
        self.assertEqual(match.strategy, "contenimento-token")

    def test_squadra_diversa_non_impedisce_il_match(self):
        """Le metriche sono della stagione scorsa: i trasferimenti sono la norma."""
        candidates = [make_candidate("5", "Rasmus Højlund", {"manchester united"}, role="A")]
        resolver = EntityResolver("understat", candidates)
        match = resolver.resolve(entry("Hojlund", "Napoli", role="A"), "napoli")
        self.assertIsNotNone(match)

    def test_ambiguita_irrisolvibile_resta_irrisolta(self):
        """Meglio nessun dato che il dato di un'altra persona."""
        candidates = [
            make_candidate("1", "Marco Rossi", {"lazio"}, role="C"),
            make_candidate("2", "Luca Rossi", {"roma"}, role="C"),
        ]
        resolver = EntityResolver("understat", candidates)
        self.assertIsNone(resolver.resolve(entry("Rossi", "Como", role="C"), "como"))

    def test_mappa_manuale_ha_la_precedenza(self):
        candidates = [
            make_candidate("1", "Marco Rossi", {"lazio"}, role="C"),
            make_candidate("2", "Luca Rossi", {"roma"}, role="C"),
        ]
        resolver = EntityResolver("understat", candidates, {"understat": {"77": "2"}})
        match = resolver.resolve(entry("Rossi", "Como", role="C", player_id=77), "como")
        self.assertIsNotNone(match)
        self.assertEqual(match.candidate.key, "2")
        self.assertEqual(match.strategy, "mappa-manuale")

    def test_candidato_conteso_va_a_chi_ha_la_squadra_giusta(self):
        """
        Due omonimi nel listone, un solo candidato nella fonte: senza la
        risoluzione dei conflitti se lo prenderebbe il primo del CSV.
        """
        candidates = [make_candidate("8478", "Lorenzo Colombo", {"genoa"}, role="A")]
        resolver = EntityResolver("understat", candidates)

        riserva = entry("Colombo", "Empoli", role="A", player_id=100)
        titolare = entry("Colombo", "Genoa", role="A", player_id=200)
        matched = resolver.resolve_all([riserva, titolare])

        self.assertIn(200, matched)
        self.assertNotIn(100, matched)

    def test_giocatore_nuovo_in_serie_a_resta_senza_match(self):
        """Non e' un errore: e' l'assenza di dati, e va dichiarata."""
        resolver = EntityResolver("understat", [make_candidate("1", "Marco Rossi", {"lazio"})])
        matched = resolver.resolve_all([entry("Neopromosso", "Pisa", player_id=42)])
        self.assertEqual(matched, {})
        self.assertEqual([e.id for e in resolver.unresolved], [42])


if __name__ == "__main__":
    unittest.main()
