"""Costanti e parametri della pipeline. Unico posto da toccare a cambio stagione."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

LISTONE_CSV = ROOT / "assets" / "data" / "listone.csv"
OUTPUT_DIR = ROOT / "dataset"
OUTPUT_PAYLOAD = OUTPUT_DIR / "players.json"
OUTPUT_MANIFEST = OUTPUT_DIR / "manifest.json"
CACHE_DIR = ROOT / ".cache" / "dataset"
MANUAL_MAP = Path(__file__).resolve().parent / "manual_map.json"

# Stagione da cui provengono le METRICHE, non quella del listone.
# A mercato in corso il listone e' gia' 2026/27 mentre l'unica stagione giocata
# e' la precedente: e' esattamente il dato che serve in fase d'asta.
STATS_SEASON = "2025-26"
# Understat identifica la stagione con l'anno di inizio.
UNDERSTAT_SEASON = "2025"

UNDERSTAT_URL = "https://understat.com/main/getPlayersStats/"
UNDERSTAT_LEAGUE = "Serie_A"
FANTACALCIO_STATS_URL = f"https://www.fantacalcio.it/statistiche-serie-a/{STATS_SEASON}/riepilogo"
TRANSFERMARKT_SEARCH_URL = "https://www.transfermarkt.it/schnellsuche/ergebnis/schnellsuche"
TRANSFERMARKT_BASE = "https://www.transfermarkt.it"
SOFASCORE_API = "https://api.sofascore.com/api/v1"
# Serie A su SofaScore.
SOFASCORE_TOURNAMENT_ID = 23

# Identificarsi e' la cosa corretta da fare, e rende il traffico riconoscibile
# a chi amministra i siti da cui stiamo leggendo.
USER_AGENT = (
    "fanta-agent/0.1 (progetto personale fantacalcio; "
    "https://github.com/tonygraziosi13/fanta-agent)"
)
# Alcune fonti rifiutano gli User-Agent non-browser. Dove serve si usa questo,
# senza altre tecniche: se una fonte ci blocca comunque, il provider si arrende
# e lo dichiara nel report.
BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)

# Secondi fra due richieste alla stessa fonte. Conservativo di proposito:
# la cache su disco rende il costo una tantum, quindi non c'e' fretta.
DEFAULT_DELAY_SECONDS = 1.0
HTTP_TIMEOUT_SECONDS = 25
HTTP_RETRIES = 3

# Finestra dello storico infortuni usata per l'indice di rischio.
INJURY_SEASONS_WINDOW = 3
# Giorni di stop in finestra che corrispondono a rischio massimo (indice 1.0).
# ~una stagione intera persa su tre: oltre, la scala smette di discriminare.
INJURY_RISK_SATURATION_DAYS = 300

# Griglia in cui la pipeline aggrega le coordinate della heatmap.
HEATMAP_ROWS = 8
HEATMAP_COLS = 6
