"""
Unica porta verso la rete (DIP).

Nessun provider importa `requests`: passano tutti di qui. Cosi' cache, rate
limit, retry, timeout — e da ora anche la sicurezza rispetto ai thread —
esistono in un punto solo, e un provider si testa sostituendo questo oggetto
senza toccare la rete.

La cache su disco non e' un'ottimizzazione: Transfermarkt richiede due chiamate
per giocatore, cioe' ~1000 richieste per una singola generazione. Senza cache,
ogni ritentativo dopo un errore ripartirebbe da zero e ribusserebbe mille volte
a un sito che non ci deve nulla.

--- Perche' questo file conosce i thread ---
La pipeline elabora piu' giocatori insieme (`config.MAX_WORKERS`). Tre cose qui
dentro non sopravvivono a quel cambiamento se lasciate come stavano, ed e' il
motivo per cui il codice sotto e' piu' esplicito di quanto sembri servire:

  1. `requests.Session` non e' garantita thread-safe -> una per thread.
  2. Il throttle leggeva e scriveva un dict condiviso -> serve un lock.
  3. La cache scriveva in place -> due thread sullo stesso URL producevano un
     file troncato, che al giro dopo veniva riletto come se fosse valido.

La politica di cortesia resta *per host* e vive in `config.HOST_LIMITS`: quanti
slot in parallelo e quanto distanziati. E' li' che FBref viene pinnato a un solo
slot ogni tre secondi, senza che il suo provider debba saperne nulla.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

import requests

from . import config


class _HostGate:
    """
    Il permesso di parlare con un host: quanti insieme, e quanto distanziati.

    Il semaforo limita la concorrenza, l'intervallo limita la frequenza. Sono
    due vincoli diversi e servono entrambi: un solo slot senza intervallo
    martella comunque, e un intervallo senza limite di slot lascia partire
    quattro richieste nello stesso istante.
    """

    def __init__(self, concurrency: int, delay: float) -> None:
        self.slots = threading.BoundedSemaphore(max(1, concurrency))
        self.delay = delay
        self._lock = threading.Lock()
        self._last_call = 0.0

    def __enter__(self) -> "_HostGate":
        self.slots.acquire()
        # L'attesa avviene *dentro* il lock di proposito: e' cio' che mette i
        # thread in coda invece di farli partire tutti insieme dopo la pausa.
        with self._lock:
            wait = self.delay - (time.monotonic() - self._last_call)
            if wait > 0:
                time.sleep(wait)
            self._last_call = time.monotonic()
        return self

    def __exit__(self, *_exc: object) -> None:
        self.slots.release()


class HttpResponse:
    """Il minimo che serve ai provider: corpo e URL finale dopo i redirect."""

    __slots__ = ("text", "url", "from_cache")

    def __init__(self, text: str, url: str, from_cache: bool = False) -> None:
        self.text = text
        self.url = url
        self.from_cache = from_cache


class HttpError(RuntimeError):
    """Errore di rete o risposta rifiutata dalla fonte."""

    def __init__(self, message: str, status: Optional[int] = None) -> None:
        super().__init__(message)
        self.status = status


class HttpClient:
    def __init__(
        self,
        cache_dir: Path = config.CACHE_DIR,
        delay: float = config.DEFAULT_DELAY_SECONDS,
        user_agent: str = config.USER_AGENT,
        use_cache: bool = True,
    ) -> None:
        self.cache_dir = cache_dir
        self.delay = delay
        self.user_agent = user_agent
        self.use_cache = use_cache
        self._gates: dict[str, _HostGate] = {}
        self._gates_lock = threading.Lock()
        self._local = threading.local()
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    # --- Sessione per thread -------------------------------------------------

    @property
    def _session(self) -> requests.Session:
        session = getattr(self._local, "session", None)
        if session is None:
            session = requests.Session()
            self._local.session = session
        return session

    # --- Cache ---------------------------------------------------------------

    def _cache_path(self, method: str, url: str, payload: Optional[dict]) -> Path:
        raw = json.dumps([method, url, payload or {}], sort_keys=True)
        digest = hashlib.sha256(raw.encode()).hexdigest()[:32]
        return self.cache_dir / f"{digest}.cache"

    def _write_cache(self, path: Path, text: str) -> None:
        """
        Scrittura atomica: file temporaneo e poi rename.

        Con piu' thread due richieste allo stesso URL possono tornare insieme, e
        scrivendo in place la seconda troverebbe la prima a meta'. Il rename e'
        atomico: un lettore vede o il file vecchio o quello nuovo, mai un file a
        meta'. Il suffisso col thread id evita che i due temporanei collidano.
        """
        tmp = path.with_suffix(f".{threading.get_ident()}.tmp")
        tmp.write_text(text, encoding="utf-8")
        tmp.replace(path)

    # --- Cortesia ------------------------------------------------------------

    def _gate(self, url: str) -> _HostGate:
        """
        Il rate limit e' per host: rallentare Understat perche' Transfermarkt e'
        lento non aiuta nessuno.
        """
        host = urlparse(url).netloc
        with self._gates_lock:
            gate = self._gates.get(host)
            if gate is None:
                concurrency, delay = config.HOST_LIMITS.get(
                    host.removeprefix("www."), (config.MAX_WORKERS, self.delay)
                )
                gate = _HostGate(concurrency, delay)
                self._gates[host] = gate
            return gate

    # --- Richieste -----------------------------------------------------------

    def fetch(self, url: str, **kwargs: Any) -> str:
        return self.fetch_response(url, **kwargs).text

    def fetch_json(self, url: str, **kwargs: Any) -> Any:
        return json.loads(self.fetch(url, **kwargs))

    def fetch_response(
        self,
        url: str,
        *,
        method: str = "GET",
        params: Optional[dict] = None,
        data: Optional[dict] = None,
        headers: Optional[dict] = None,
        user_agent: Optional[str] = None,
    ) -> HttpResponse:
        """
        Come `fetch`, ma restituisce anche l'URL finale.

        Serve alla ricerca di FBref: con un solo risultato il sito reindirizza
        direttamente alla scheda, e riconoscerlo evita di parsare una lista di
        risultati che non c'e'.
        """
        payload = {"params": params, "data": data}
        cache_file = self._cache_path(method, url, payload)

        if self.use_cache and cache_file.exists():
            return HttpResponse(
                text=cache_file.read_text(encoding="utf-8"),
                url=self._read_final_url(cache_file) or url,
                from_cache=True,
            )

        request_headers = {"User-Agent": user_agent or self.user_agent}
        if headers:
            request_headers.update(headers)

        last_error: Optional[Exception] = None
        for attempt in range(config.HTTP_RETRIES):
            with self._gate(url):
                try:
                    response = self._session.request(
                        method,
                        url,
                        params=params,
                        data=data,
                        headers=request_headers,
                        timeout=config.HTTP_TIMEOUT_SECONDS,
                    )
                    # 4xx diversi da 429 non migliorano riprovando: e' una porta
                    # chiusa, non un ingorgo. Si fallisce subito e lo dice il
                    # report. Lo status viaggia nell'eccezione perche' a FBref
                    # serve distinguere un 403 di Cloudflare da un 404.
                    if 400 <= response.status_code < 500 and response.status_code != 429:
                        raise HttpError(
                            f"HTTP {response.status_code} su {url}",
                            status=response.status_code,
                        )
                    response.raise_for_status()

                    text = response.text
                    if self.use_cache:
                        self._write_cache(cache_file, text)
                        self._write_final_url(cache_file, response.url)
                    return HttpResponse(text=text, url=response.url, from_cache=False)
                except HttpError:
                    raise
                except Exception as error:  # rete instabile, 5xx, timeout
                    last_error = error

            # Backoff esponenziale, e fuori dal gate: se il server e' in
            # difficolta' martellarlo peggiora la situazione per tutti, ma
            # tenere occupato uno slot mentre si aspetta blocca gli altri thread.
            time.sleep(self.delay * (2**attempt))

        raise HttpError(f"{url}: {last_error}")

    # --- URL finale, accanto alla risposta in cache --------------------------

    def _write_final_url(self, cache_file: Path, final_url: str) -> None:
        try:
            self._write_cache(cache_file.with_suffix(".url"), final_url)
        except OSError:
            pass  # l'URL finale e' un di piu': se non si scrive, pazienza

    def _read_final_url(self, cache_file: Path) -> Optional[str]:
        path = cache_file.with_suffix(".url")
        try:
            return path.read_text(encoding="utf-8") if path.exists() else None
        except OSError:
            return None
