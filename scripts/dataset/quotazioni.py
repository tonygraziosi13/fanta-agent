"""
Il listone come fonte scaricata, non come artefatto committato a mano.

--- Il buco che questo modulo chiude ---
`assets/data/listone.csv` nasceva da un `.xlsx` scaricato a mano e convertito con
`xlsx_to_csv.py`. Tutto il resto della catena era automatico — la pipeline
rigenera le metriche, il workflow pubblica, l'app sincronizza a ogni avvio caldo
— ma il primo anello era fermo al giorno in cui qualcuno si era ricordato di
aggiornare il file. Risultato misurato il 19/08/2026: 15 giocatori nuovi assenti
dall'app (Vicario, Molina, Spence, Milik…) e 2 rimasti in lista dopo essere
usciti. Nessuna quotazione cambiata: a muoversi non erano i prezzi, era il
mercato.

--- Perche' proprio questa fonte ---
La pagina quotazioni di Fantacalcio.it e' l'unica che espone lo *stesso* `Id` del
listone, nell'href di ogni giocatore. E' l'identificativo primario di US19-2:
niente entity resolution, join esatta, zero possibilita' di agganciare le
quotazioni al giocatore sbagliato. E' server-rendered, a differenza delle pagine
rendimento di Transfermarkt, quindi si legge con gli stessi strumenti del resto
della pipeline.

--- L'invariante che questo modulo deve rispettare ---
I giocatori spariti dalla lista **non si cancellano**: restano con `IsActive = 0`.
E' la stessa regola che governa il sync lato app (US20-3), e per lo stesso
motivo: una watchlist puo' contenerli, e cancellarli la spezzerebbe. Qui la
regola vale a monte, sul CSV.

Puro dove conta: `parse_quotazioni` e `merge_with_previous` non toccano la rete e
sono testati in `tests/test_quotazioni.py`.
"""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

from bs4 import BeautifulSoup

from . import config
from .http import HttpClient

# L'href porta squadra e id: /serie-a/squadre/inter/martinez-l/2764
PLAYER_HREF = re.compile(r"/serie-a/squadre/([^/]+)/[^/]+/(\d+)")

# Tracciato ufficiale, identico a quello che scrive xlsx_to_csv.py: i due
# percorsi devono produrre lo stesso file, o l'app vedrebbe due listoni diversi
# a seconda di come e' stato generato.
HEADER = [
    "Id", "R", "RM", "Nome", "Squadra",
    "Qt.A", "Qt.I", "Diff.",
    "Qt.A M", "Qt.I M", "Diff.M",
    "FVM", "FVM M", "IsActive",
]

# Ordine di reparto del listone ufficiale.
ROLE_ORDER = {"P": 0, "D": 1, "C": 2, "A": 3}


class QuotazioniError(RuntimeError):
    """La pagina non e' interpretabile: meglio fermarsi che scrivere un listone monco."""


@dataclass(frozen=True)
class QuotazioneRow:
    id: int
    role: str
    role_mantra: str
    name: str
    team: str
    qt_a: int
    qt_i: int
    qt_a_m: int
    qt_i_m: int
    fvm: int
    fvm_m: int
    is_active: bool = True

    def to_csv(self, is_active: Optional[bool] = None) -> dict[str, object]:
        if is_active is None:
            is_active = self.is_active
        return {
            "Id": self.id,
            "R": self.role,
            "RM": self.role_mantra,
            "Nome": self.name,
            "Squadra": self.team,
            "Qt.A": self.qt_a,
            "Qt.I": self.qt_i,
            "Diff.": self.qt_a - self.qt_i,
            "Qt.A M": self.qt_a_m,
            "Qt.I M": self.qt_i_m,
            "Diff.M": self.qt_a_m - self.qt_i_m,
            "FVM": self.fvm,
            "FVM M": self.fvm_m,
            "IsActive": 1 if is_active else 0,
        }


def _to_int(text: Optional[str]) -> Optional[int]:
    if not text:
        return None
    cleaned = text.strip().replace(",", ".")
    try:
        return int(float(cleaned))
    except ValueError:
        return None


def _mantra(raw: str) -> str:
    """"e|w" -> "E;W". Le sigle del listone sono capitalizzate e separate da ';'."""
    codici = [token.strip().capitalize() for token in raw.split("|") if token.strip()]
    return ";".join(codici)


def team_names_from_csv(path: Path = config.LISTONE_CSV) -> dict[str, str]:
    """
    Impara la corrispondenza sigla -> nome squadra dal CSV attuale.

    Preferita a una tabella scritta a mano perche' si aggiorna da se': il nome
    esatto che l'app gia' mostra resta quello, senza che nessuno debba
    ricordarsi di allineare due liste. La tabella in `config.py` copre solo cio'
    che il CSV non sa ancora dire — una neopromossa al primo anno.
    """
    if not path.exists():
        return {}

    per_id: dict[str, str] = {}
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            per_id[str(row.get("Id", "")).strip()] = (row.get("Squadra") or "").strip()
    return per_id


def parse_quotazioni(html: str, teams_by_id: dict[str, str]) -> list[QuotazioneRow]:
    """
    Dalla pagina alle righe del listone. Puro: riceve l'HTML, non lo scarica.

    `teams_by_id` serve a dare alla sigla di squadra il nome per esteso che l'app
    gia' usa; per un giocatore mai visto si ricade sulla tabella di `config.py`,
    e se anche quella non sa rispondere il chiamante lo saprà (`unknown_teams`).
    """
    soup = BeautifulSoup(html, "lxml")
    righe: list[QuotazioneRow] = []

    for tr in soup.select("tr.player-row"):
        link = tr.select_one('a[href*="/serie-a/squadre/"]')
        if link is None:
            continue
        match = PLAYER_HREF.search(link.get("href", ""))
        if match is None:
            continue

        slug, player_id = match.group(1), int(match.group(2))
        celle = {
            td.get("data-col-key"): td.get_text(strip=True)
            for td in tr.select("[data-col-key]")
        }

        nome = (tr.get("data-filter-keywords") or link.get_text(strip=True)).strip()
        ruolo = (tr.get("data-filter-role-classic") or "").strip().upper()
        if not nome or ruolo not in ROLE_ORDER:
            continue

        sigla = (celle.get("sq") or "").strip().upper()
        squadra = (
            teams_by_id.get(str(player_id))
            or config.TEAM_BY_ABBREVIATION.get(sigla)
            or slug.replace("-", " ").title()
        )

        qt_a = _to_int(celle.get("c_qa"))
        qt_i = _to_int(celle.get("c_qi"))
        if qt_a is None or qt_i is None:
            continue

        righe.append(
            QuotazioneRow(
                id=player_id,
                role=ruolo,
                role_mantra=_mantra(tr.get("data-filter-role-mantra") or ""),
                name=nome,
                team=squadra,
                qt_a=qt_a,
                qt_i=qt_i,
                qt_a_m=_to_int(celle.get("m_qa")) or qt_a,
                qt_i_m=_to_int(celle.get("m_qi")) or qt_i,
                fvm=_to_int(celle.get("c_fvm")) or 0,
                fvm_m=_to_int(celle.get("m_fvm")) or 0,
                # `out-of-game` e' il flag ufficiale del ceduto/fuori rosa. La
                # pagina non toglie nessuno dall'elenco — i ceduti restano con
                # la loro quotazione — quindi senza questo marcatore l'unico
                # modo di riconoscerli sarebbe il foglio "Ceduti" dell'.xlsx,
                # cioe' di nuovo un aggiornamento a mano.
                is_active=tr.select_one(".out-of-game") is None,
            )
        )

    if not righe:
        raise QuotazioniError(
            "Nessuna riga giocatore riconosciuta: la pagina ha probabilmente "
            "cambiato struttura. Il listone attuale resta intatto."
        )

    return righe


@dataclass
class RosterDiff:
    """Cosa cambia fra il listone in repo e quello ufficiale. E' il report."""

    nuovi: list[QuotazioneRow]
    usciti: list[dict[str, str]]
    ceduti: list[QuotazioneRow]
    quotazioni_cambiate: list[tuple[str, int, int]]
    invariati: int

    @property
    def is_empty(self) -> bool:
        return not (self.nuovi or self.usciti or self.ceduti or self.quotazioni_cambiate)


def diff_with_previous(
    righe: Iterable[QuotazioneRow], precedenti: list[dict[str, str]]
) -> RosterDiff:
    per_id = {r.id: r for r in righe}
    vecchi = {int(r["Id"]): r for r in precedenti if str(r.get("Id", "")).strip().isdigit()}
    attivi_prima = {i for i, r in vecchi.items() if r.get("IsActive") == "1"}

    nuovi = [r for i, r in per_id.items() if i not in vecchi]
    # Sparito del tutto dall'elenco: non dovrebbe accadere — la pagina tiene i
    # ceduti — ma se accade il giocatore va conservato, non perso.
    usciti = [vecchi[i] for i in sorted(attivi_prima - set(per_id))]
    # Ceduto da quando il CSV e' stato generato: c'e' ancora, ma marcato.
    ceduti = [per_id[i] for i in sorted(attivi_prima & set(per_id)) if not per_id[i].is_active]
    cambiate = [
        (per_id[i].name, int(vecchi[i]["Qt.A"]), per_id[i].qt_a)
        for i in sorted(set(per_id) & set(vecchi))
        if str(vecchi[i].get("Qt.A", "")).isdigit() and int(vecchi[i]["Qt.A"]) != per_id[i].qt_a
    ]
    invariati = len(set(per_id) & set(vecchi)) - len(cambiate)
    return RosterDiff(
        nuovi=nuovi,
        usciti=usciti,
        ceduti=ceduti,
        quotazioni_cambiate=cambiate,
        invariati=invariati,
    )


def merge_with_previous(
    righe: Iterable[QuotazioneRow], precedenti: list[dict[str, str]]
) -> list[dict[str, object]]:
    """
    Il listone nuovo, piu' i ceduti conservati.

    Chi non compare piu' nella lista ufficiale **non sparisce**: rientra in coda
    con `IsActive = 0`, conservando i suoi dati come li conosceva il CSV
    precedente. Cancellarlo romperebbe le watchlist che lo contengono, ed e'
    esattamente cio' che l'invariante US20-3 vieta un livello piu' in la'.
    """
    per_id = {r.id: r for r in righe}
    vecchi = {int(r["Id"]): r for r in precedenti if str(r.get("Id", "")).strip().isdigit()}

    def ordina(row: dict[str, object]) -> tuple[int, int, int, str]:
        # Attivi prima, poi i ceduti; dentro ogni gruppo per reparto e
        # quotazione decrescente, come il listone ufficiale.
        return (
            0 if int(row["IsActive"] or 0) else 1,
            ROLE_ORDER.get(str(row["R"]), 9),
            -int(row["Qt.A"] or 0),
            str(row["Nome"]),
        )

    righe_csv = [r.to_csv() for r in per_id.values()]

    # Chi e' sparito dall'elenco resta, con i dati che il CSV precedente
    # conosceva: cancellarlo spezzerebbe le watchlist che lo contengono.
    for player_id, row in vecchi.items():
        if player_id in per_id:
            continue
        conservato: dict[str, object] = {campo: row.get(campo, "") for campo in HEADER}
        conservato["IsActive"] = 0
        righe_csv.append(conservato)

    return sorted(righe_csv, key=ordina)


def read_previous(path: Path = config.LISTONE_CSV) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(rows: list[dict[str, object]], path: Path = config.LISTONE_CSV) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=HEADER)
        writer.writeheader()
        writer.writerows(rows)


def fetch(http: HttpClient) -> str:
    return http.fetch(config.QUOTAZIONI_URL, user_agent=config.BROWSER_USER_AGENT)
