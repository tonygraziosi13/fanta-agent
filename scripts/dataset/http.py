"""
Unica porta verso la rete (DIP).

Nessun provider importa `requests`: passano tutti di qui. Cosi' cache, rate
limit, retry e timeout esistono in un punto solo — e un provider si testa
sostituendo questo oggetto, senza toccare la rete.

La cache su disco non e' un'ottimizzazione: Transfermarkt richiede due chiamate
per giocatore, cioe' ~1000 richieste per una singola generazione. Senza cache,
ogni ritentativo dopo un errore ripartirebbe da zero e ribusserebbe mille volte
a un sito che non ci deve nulla.
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

import requests

from . import config


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
        self._last_call: dict[str, float] = {}
        self._session = requests.Session()
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    # --- Cache ---------------------------------------------------------------

    def _cache_path(self, method: str, url: str, payload: Optional[dict]) -> Path:
        raw = json.dumps([method, url, payload or {}], sort_keys=True)
        digest = hashlib.sha256(raw.encode()).hexdigest()[:32]
        return self.cache_dir / f"{digest}.cache"

    # --- Cortesia ------------------------------------------------------------

    def _throttle(self, url: str) -> None:
        """
        Il rate limit e' per host: rallentare Understat perche' Transfermarkt e'
        lento non aiuta nessuno.
        """
        host = urlparse(url).netloc
        elapsed = time.monotonic() - self._last_call.get(host, 0.0)
        if elapsed < self.delay:
            time.sleep(self.delay - elapsed)
        self._last_call[host] = time.monotonic()

    # --- Richieste -----------------------------------------------------------

    def fetch(
        self,
        url: str,
        *,
        method: str = "GET",
        params: Optional[dict] = None,
        data: Optional[dict] = None,
        headers: Optional[dict] = None,
        user_agent: Optional[str] = None,
    ) -> str:
        payload = {"params": params, "data": data}
        cache_file = self._cache_path(method, url, payload)

        if self.use_cache and cache_file.exists():
            return cache_file.read_text(encoding="utf-8")

        request_headers = {"User-Agent": user_agent or self.user_agent}
        if headers:
            request_headers.update(headers)

        last_error: Optional[Exception] = None
        for attempt in range(config.HTTP_RETRIES):
            self._throttle(url)
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
                # chiusa, non un ingorgo. Si fallisce subito e lo dice il report.
                if 400 <= response.status_code < 500 and response.status_code != 429:
                    raise HttpError(f"HTTP {response.status_code} su {url}")
                response.raise_for_status()

                text = response.text
                if self.use_cache:
                    cache_file.write_text(text, encoding="utf-8")
                return text
            except HttpError:
                raise
            except Exception as error:  # rete instabile, 5xx, timeout
                last_error = error
                # Backoff esponenziale: se il server e' in difficolta',
                # martellarlo peggiora la situazione per tutti.
                time.sleep(self.delay * (2**attempt))

        raise HttpError(f"{url}: {last_error}")

    def fetch_json(self, url: str, **kwargs: Any) -> Any:
        return json.loads(self.fetch(url, **kwargs))


class HttpError(RuntimeError):
    """Errore di rete o risposta rifiutata dalla fonte."""
