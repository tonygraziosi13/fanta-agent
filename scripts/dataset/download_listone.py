"""
Download autenticato del listone ufficiale (step 1 della pipeline).

--- Perche' serve il login ---
Il file .xlsx delle quotazioni e' riservato agli utenti registrati: senza
sessione il server risponde 401. In cambio da' il tracciato record completo e i
due fogli "Tutti"/"Ceduti", che sono l'unica dichiarazione esplicita di chi e'
uscito dalla Serie A.

--- Perche' un browser e non `requests` ---
Il form del sito non viene compilato a mano: la pagina invia comunque le
credenziali via JavaScript a `POST /api/v1/User/login`. Chiamando quell'endpoint
*dalla pagina* i cookie di sessione finiscono nel contesto del browser, senza
dipendere dal banner dei cookie o dal layout della UI — che cambiano, mentre
l'endpoint no.

--- Le credenziali non stanno qui ---
Si leggono da `FANTACALCIO_USER` / `FANTACALCIO_PASS`, senza valori di default.
In CI arrivano da GitHub Secrets. Il PoC da cui questo file discende le aveva
scritte in chiaro, ed e' il motivo per cui quella cartella non e' mai stata
committata.

Attenzione: il form chiede lo **username**, non l'indirizzo email.

--- Cosa restituisce, e perche' anche l'HTML ---
La pagina delle quotazioni e' gia' aperta per trovare l'URL di download, e
contiene il marcatore `out-of-game` per ogni ceduto. Restituirla insieme
all'.xlsx costa zero richieste in piu' e da' una seconda lettura indipendente di
chi e' uscito, utile se un giorno i due fogli non bastassero piu'.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

from . import config

BASE_URL = "https://www.fantacalcio.it"
QUOTAZIONI_URL = config.QUOTAZIONI_URL
LOGIN_API = "/api/v1/User/login"

# La sessione sopravvive fra due esecuzioni: riusarla evita un login inutile a
# ogni corsa, che e' anche la cosa piu' gentile verso il sito.
#
# Deliberatamente FUORI da `config.CACHE_DIR`: quella cartella viene salvata
# nella cache di GitHub Actions, e questo file contiene i cookie di sessione di
# un account reale. Una cache di CI e' leggibile da chiunque abbia accesso in
# lettura al repository — non e' il posto dove lasciare una sessione autenticata.
STORAGE_STATE = config.ROOT / ".cache" / "session" / "fantacalcio.json"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# L'id nell'URL (/api/v1/Excel/prices/<id>/1) cambia a ogni stagione: va letto
# dalla pagina, non scritto a mano.
EXCEL_HREF = re.compile(r"/api/v1/Excel/prices/\d+/\d+")


class DownloadError(RuntimeError):
    """
    Il percorso autenticato non e' percorribile.

    Non e' fatale per la pipeline: chi chiama ricade sullo scraping della pagina
    pubblica, che non richiede login. Perdere il download significa perdere il
    tracciato completo, non il listone.
    """


@dataclass
class Downloaded:
    xlsx: Path
    """HTML della pagina quotazioni, gia' caricata per trovare il link."""
    html: Optional[str] = None


def credentials() -> tuple[str, str]:
    user = os.environ.get("FANTACALCIO_USER", "").strip()
    password = os.environ.get("FANTACALCIO_PASS", "")
    if not user or not password:
        raise DownloadError(
            "FANTACALCIO_USER / FANTACALCIO_PASS non impostate: "
            "il download autenticato del listone non e' disponibile."
        )
    return user, password


def login(page, user: str, password: str) -> None:
    """
    Autentica la sessione del browser chiamando l'endpoint di login.

    Pubblica perche' la usa anche `asta.py`: l'area leghe sta su un
    sottodominio ma condivide i cookie, e duplicare questa funzione
    significherebbe avere due punti in cui l'endpoint di autenticazione puo'
    cambiare senza che il secondo se ne accorga.
    """
    result = page.evaluate(
        """async ([endpoint, utente, segreto]) => {
            const r = await fetch(endpoint, {
                method: 'POST',
                credentials: 'include',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({username: utente, password: segreto})
            });
            let testo = '';
            try { testo = await r.text(); } catch (e) {}
            return {status: r.status, body: testo};
        }""",
        [LOGIN_API, user, password],
    )

    if result["status"] != 200:
        raise DownloadError(f"Il server ha risposto {result['status']} al login.")

    try:
        data = json.loads(result["body"])
    except ValueError:
        raise DownloadError("Risposta di login non interpretabile.") from None

    if not data.get("success"):
        raise DownloadError(
            f"Login rifiutato: {data.get('errors') or 'credenziali non valide'}"
        )


def _excel_url(page) -> str:
    anchor = page.locator('a[href*="/api/v1/Excel/prices/"]').first
    if anchor.count() > 0:
        href = anchor.get_attribute("href")
        if href:
            return href if href.startswith("http") else BASE_URL + href

    found = EXCEL_HREF.search(page.content())
    if found:
        return BASE_URL + found.group(0)

    raise DownloadError("Link di download del listone non trovato sulla pagina.")


def _save(response, destination_dir: Path) -> Path:
    body = response.body()

    # Un .xlsx e' uno ZIP: deve iniziare con 'PK'. Se arriva altro — tipicamente
    # una pagina di errore in HTML — il download non e' andato a buon fine, e
    # accorgersene qui evita di far fallire il parser con un messaggio oscuro.
    if not body.startswith(b"PK"):
        raise DownloadError("Il server non ha restituito un file Excel valido.")

    name = None
    disposition = response.headers.get("content-disposition", "")
    found = re.search(r'filename\*?=(?:UTF-8\'\')?"?([^";]+)"?', disposition)
    if found:
        name = Path(found.group(1).strip()).name
    if not name:
        name = f"listone_{datetime.now():%Y%m%d_%H%M%S}.xlsx"

    destination_dir.mkdir(parents=True, exist_ok=True)
    path = destination_dir / name
    path.write_bytes(body)
    return path


def apri_contesto(browser):
    """
    Un contesto browser con la sessione salvata, se c'e'.

    Estratta da `download()` perche' serve identica ad `asta.py`: stesso
    user agent, stessa lingua, stessa sessione riusata. Riscriverla altrove
    significherebbe poterla far divergere senza accorgersene.
    """
    options = {
        "user_agent": USER_AGENT,
        "accept_downloads": True,
        "locale": "it-IT",
        "viewport": {"width": 1440, "height": 900},
    }
    if STORAGE_STATE.exists():
        options["storage_state"] = str(STORAGE_STATE)
    return browser.new_context(**options)


def salva_sessione(context) -> None:
    """Conserva i cookie per la prossima esecuzione: un login in meno al sito."""
    STORAGE_STATE.parent.mkdir(parents=True, exist_ok=True)
    context.storage_state(path=str(STORAGE_STATE))


def avvia_playwright():
    """`sync_playwright()`, con un errore leggibile se manca il pacchetto."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise DownloadError(
            "playwright non installato: pip install -r scripts/requirements.txt "
            "&& playwright install chromium"
        ) from None
    return sync_playwright()


def download(destination_dir: Path = config.CACHE_DIR, headless: bool = True) -> Downloaded:
    """Scarica l'.xlsx delle quotazioni. Solleva `DownloadError` se non ci riesce."""
    user, password = credentials()

    with avvia_playwright() as engine:
        browser = engine.chromium.launch(headless=headless)
        context = apri_contesto(browser)
        try:
            page = context.new_page()
            page.goto(QUOTAZIONI_URL, wait_until="domcontentloaded", timeout=60_000)

            url = _excel_url(page)
            html = page.content()

            # Se la sessione salvata e' scaduta il server risponde 401: si rifa'
            # il login e si riprova, invece di fallire alla prima esecuzione dopo
            # una settimana di pausa.
            response = context.request.get(url, timeout=120_000)
            if response.status == 401:
                login(page, user, password)
                salva_sessione(context)
                response = context.request.get(url, timeout=120_000)

            if not response.ok:
                raise DownloadError(
                    f"Il server ha risposto {response.status} all'URL del listone."
                )

            return Downloaded(xlsx=_save(response, destination_dir), html=html)
        finally:
            context.close()
            browser.close()
