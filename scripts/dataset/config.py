"""Costanti e parametri della pipeline. Unico posto da toccare a cambio stagione."""

from __future__ import annotations

from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

LISTONE_CSV = ROOT / "assets" / "data" / "listone.csv"
OUTPUT_DIR = ROOT / "dataset"
OUTPUT_PAYLOAD = OUTPUT_DIR / "players.json"
OUTPUT_MANIFEST = OUTPUT_DIR / "manifest.json"
CACHE_DIR = ROOT / ".cache" / "dataset"
MANUAL_MAP = Path(__file__).resolve().parent / "manual_map.json"
# Stato del delta di esecuzione: {id: [stato, livello]}. Sta nella cache e non
# in `dataset/` di proposito — non e' contenuto da pubblicare, e se sparisce il
# peggio che succede e' una rigenerazione completa.
STATE_FILE = CACHE_DIR / "levels.json"

# Stagione da cui provengono le METRICHE, non quella del listone.
# A mercato in corso il listone e' gia' 2026/27 mentre l'unica stagione giocata
# e' la precedente: e' esattamente il dato che serve in fase d'asta.
STATS_SEASON = "2025-26"


def ultima_stagione_conclusa(oggi: "date | None" = None) -> int:
    """
    Anno d'inizio dell'ultima stagione finita — Understat identifica la stagione
    con quello.

    I campionati iniziano ad agosto: da agosto in poi la stagione conclusa e'
    quella cominciata l'anno prima (agosto 2026 -> 2025, cioe' 2025/26), mentre
    a campionato in corso bisogna tornare indietro di un altro anno.

    Calcolata e non scritta a mano: era una costante da ricordarsi di cambiare
    ogni estate, e dimenticarla produce un dataset intero della stagione
    sbagliata senza che nulla protesti.
    """
    oggi = oggi or date.today()
    return oggi.year - 1 if oggi.month >= 8 else oggi.year - 2


UNDERSTAT_SEASON = str(ultima_stagione_conclusa())

UNDERSTAT_BASE = "https://understat.com"
UNDERSTAT_URL = "https://understat.com/main/getPlayersStats/"

# LIVELLO 1 — le top 5 leghe europee, non piu' la sola Serie A.
#
# Con la sola Serie A la copertura si ferma a chi ha gia' giocato qui: i nuovi
# acquisti dall'estero restano scoperti *per costruzione*, e nessuna correzione
# del matching li recupera. Cinque leghe costano cinque richieste in tutto —
# l'indice e' per lega, non per giocatore — e trasformano un tetto strutturale
# in una lacuna che riguarda solo chi arriva da fuori dalle top 5.
UNDERSTAT_LEAGUES = ("Serie_A", "EPL", "La_liga", "Bundesliga", "Ligue_1")
# Retrocompatibilita' per chi importa la costante singola.
UNDERSTAT_LEAGUE = UNDERSTAT_LEAGUES[0]

FANTACALCIO_STATS_URL = f"https://www.fantacalcio.it/statistiche-serie-a/{STATS_SEASON}/riepilogo"
TRANSFERMARKT_SEARCH_URL = "https://www.transfermarkt.it/schnellsuche/ergebnis/schnellsuche"
TRANSFERMARKT_BASE = "https://www.transfermarkt.it"

# LIVELLO 2 — FBref, per chi gioca fuori dalle top 5 (Serie B, resto del mondo).
FBREF_BASE = "https://fbref.com"
FBREF_SEARCH_URL = f"{FBREF_BASE}/en/search/search.fcgi"
# FBref sta dietro Cloudflare e da certi indirizzi risponde 403 a qualunque
# richiesta non fatta da un browser. Insistere costa FBREF_DELAY_SECONDS a
# giocatore per nulla: dopo questo numero di rifiuti consecutivi il livello si
# disattiva per il resto della corsa e tutti passano al livello 3.
FBREF_MAX_FAILURES = 3

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

# --- Parallelismo ---
# Quanti giocatori elaborare insieme. Quattro e' il compromesso fra velocita' e
# rischio di 429/403: oltre, i server iniziano a chiudere la porta — e una fonte
# che ci blocca costa molto piu' del tempo che avremmo risparmiato.
MAX_WORKERS = 4

# Limiti per host: (richieste contemporanee, secondi fra due richieste dello
# stesso slot). E' l'unico posto in cui vive la politica di cortesia, e vale
# per tutti i provider perche' tutti passano da `http.py`.
#
# FBref e' il caso speciale: taglia l'accesso intorno alle dieci richieste al
# minuto, quindi e' pinnato a *un* solo slot con tre secondi di distanza. Con
# quattro thread che pescassero in parallelo si arriverebbe subito al 429.
HOST_LIMITS: dict[str, tuple[int, float]] = {
    "fbref.com": (1, 3.0),
}
# Per gli host non elencati: MAX_WORKERS slot a DEFAULT_DELAY_SECONDS l'uno.
DEFAULT_HOST_LIMIT = (MAX_WORKERS, DEFAULT_DELAY_SECONDS)

# Finestra dello storico infortuni usata per l'indice di rischio.
INJURY_SEASONS_WINDOW = 3
# Giorni di stop in finestra che corrispondono a rischio massimo (indice 1.0).
# ~una stagione intera persa su tre: oltre, la scala smette di discriminare.
INJURY_RISK_SATURATION_DAYS = 300

# --- Gate di rilascio (US19-T3) ---
# Quota del `matched` precedente sotto la quale una fonte si considera in
# regressione e il rilascio si blocca. Non e' zero di proposito: le coperture
# oscillano di qualche unita' fra due esecuzioni (un giocatore trasferito, una
# riga in piu' nella tabella sorgente) e un gate che scatta su quello sarebbe
# rumore. Un crollo al 70% invece non e' oscillazione: e' una fonte che ha
# cambiato struttura, o che ci sta rifiutando.
RELEASE_MIN_COVERAGE_RATIO = 0.7

# --- Listone ufficiale (quotazioni) ---
# La pagina espone lo stesso `Id` del listone nell'href di ogni giocatore, ed e'
# server-rendered: e' cio' che permette di rigenerare l'anagrafica senza passare
# dall'.xlsx scaricato a mano. Vedi `quotazioni.py`.
QUOTAZIONI_URL = "https://www.fantacalcio.it/quotazioni-fantacalcio"

# Rete di sicurezza per le sigle di squadra: normalmente il nome per esteso si
# impara dal CSV precedente, che e' gia' quello che l'app mostra. Questa tabella
# serve solo per una squadra che nel CSV non c'e' ancora — una neopromossa al
# primo aggiornamento dopo il cambio stagione.
TEAM_BY_ABBREVIATION = {
    "ATA": "Atalanta", "BOL": "Bologna", "CAG": "Cagliari", "COM": "Como",
    "CRE": "Cremonese", "FIO": "Fiorentina", "FRO": "Frosinone", "GEN": "Genoa",
    "INT": "Inter", "JUV": "Juventus", "LAZ": "Lazio", "LEC": "Lecce",
    "MIL": "Milan", "MON": "Monza", "NAP": "Napoli", "PAR": "Parma",
    "PIS": "Pisa", "ROM": "Roma", "SAL": "Salernitana", "SAS": "Sassuolo",
    "SPE": "Spezia", "TOR": "Torino", "UDI": "Udinese", "VEN": "Venezia",
    "VER": "Verona", "EMP": "Empoli",
}
