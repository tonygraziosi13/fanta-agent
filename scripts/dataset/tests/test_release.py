"""
Test del gate di rilascio.

Il gate esiste per non pubblicare automaticamente un dataset peggiore di quello
online, e il caso che deve distinguere e' sottile: una fonte **caduta adesso**
blocca il rilascio, una fonte **rotta da sempre** no. Sbagliare il secondo
renderebbe il gate un allarme perennemente rosso, cioe' un allarme spento.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from dataset import release


def source(matched: int, failed: str | None = None) -> dict:
    return {
        "matched": matched,
        "coverage": round(matched / 505, 3),
        "unresolved": 505 - matched,
        "failed": failed,
        "strategies": {},
    }


# Riproduce la forma reale di dataset/players.json: fantacalcio, understat e
# transfermarkt rispondono, fbref e' respinta da Cloudflare (403).
BASE_SOURCES = {
    "fantacalcio": source(389),
    "understat": source(369),
    "transfermarkt": source(421),
    "fbref": source(0, "FBref respinta da Cloudflare: HTTP 403"),
}


def manifest(version: str, players: int = 505) -> dict:
    return {
        "version": version[:16],
        "hash": version,
        "season": "2025-26",
        "generated_at": "2026-08-19T00:00:00+00:00",
        "players_count": players,
        "size_bytes": 487444,
        "payload": "players.json",
    }


def payload(sources: dict) -> dict:
    return {"schema": 1, "season": "2025-26", "sources": sources, "players": []}


OLD_MANIFEST = manifest("9b0f68c7" * 8)
OLD_PAYLOAD = payload(BASE_SOURCES)


def decide(new_sources: dict, version: str = "aa" * 32, players: int = 505):
    return release.decide(
        manifest(version, players), payload(new_sources), OLD_MANIFEST, OLD_PAYLOAD
    )


class DecideTest(unittest.TestCase):
    def test_hash_identico_non_pubblica(self):
        """Stesso contenuto: ripubblicare cambierebbe solo `generated_at`."""
        decision = release.decide(
            OLD_MANIFEST, OLD_PAYLOAD, OLD_MANIFEST, OLD_PAYLOAD
        )
        self.assertEqual(decision.action, release.UNCHANGED)
        self.assertFalse(decision.should_publish)
        self.assertFalse(decision.is_failure)

    def test_dataset_migliorato_pubblica(self):
        migliorato = dict(BASE_SOURCES, understat=source(380))
        decision = decide(migliorato)
        self.assertEqual(decision.action, release.PUBLISH)
        self.assertTrue(decision.should_publish)

    def test_oscillazione_non_e_regressione(self):
        """Qualche unita' in meno capita fra due esecuzioni: non e' un guasto."""
        decision = decide(dict(BASE_SOURCES, transfermarkt=source(415)))
        self.assertEqual(decision.action, release.PUBLISH)

    def test_fonte_caduta_blocca(self):
        caduta = dict(
            BASE_SOURCES, transfermarkt=source(0, "Transfermarkt: HTTP 403")
        )
        decision = decide(caduta)
        self.assertEqual(decision.action, release.REGRESSION)
        self.assertTrue(decision.is_failure)
        self.assertIn("transfermarkt", " ".join(decision.reasons))

    def test_copertura_crollata_blocca(self):
        """Nessuna eccezione, solo match crollati: il caso del sito ristrutturato."""
        decision = decide(dict(BASE_SOURCES, understat=source(100)))
        self.assertEqual(decision.action, release.REGRESSION)

    def test_fonte_rotta_da_sempre_non_blocca(self):
        """
        Il confronto e' con la baseline reale, non con un ideale: una fonte che
        fallisce da sempre, chiamata regressione a ogni esecuzione, renderebbe
        il gate un allarme che nessuno guarda piu'.
        """
        decision = decide(BASE_SOURCES | {"understat": source(370)})
        self.assertEqual(decision.action, release.PUBLISH)
        fbref = next(d for d in decision.deltas if d.name == "fbref")
        self.assertFalse(fbref.regressed)

    def test_togliere_una_fonte_gia_a_zero_non_blocca(self):
        """
        Il caso di SofaScore, rimossa dalla pipeline: era a copertura zero e
        dichiarata fallita, quindi la sua sparizione dal payload non ha niente da
        far perdere. Senza questa uscita, ritirare una fonte ormai inutile
        bloccherebbe il primo rilascio successivo — e l'unico modo di sbloccarlo
        sarebbe pubblicare a mano scavalcando il gate.
        """
        senza_fbref = {k: v for k, v in BASE_SOURCES.items() if k != "fbref"}
        decision = decide(senza_fbref)

        self.assertEqual(decision.action, release.PUBLISH)

    def test_fonte_sparita_dal_payload_blocca(self):
        senza = {k: v for k, v in BASE_SOURCES.items() if k != "fantacalcio"}
        decision = decide(senza)
        self.assertEqual(decision.action, release.REGRESSION)

    def test_fonte_nuova_non_blocca(self):
        decision = decide(BASE_SOURCES | {"nuovafonte": source(12)})
        self.assertEqual(decision.action, release.PUBLISH)

    def test_listone_dimezzato_blocca(self):
        """Un listone crollato non e' una fonte caduta: e' la generazione rotta."""
        decision = decide(BASE_SOURCES, players=200)
        self.assertEqual(decision.action, release.REGRESSION)

    def test_primo_rilascio_senza_baseline(self):
        decision = release.decide(manifest("bb" * 32), payload(BASE_SOURCES))
        self.assertEqual(decision.action, release.PUBLISH)
        self.assertIsNone(decision.previous_version)

    def test_render_segnala_le_regressioni(self):
        testo = release.render(decide(dict(BASE_SOURCES, understat=source(10))))
        self.assertIn("RILASCIO BLOCCATO", testo)
        self.assertIn("understat", testo)


if __name__ == "__main__":
    unittest.main()
