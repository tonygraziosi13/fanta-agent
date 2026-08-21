"""
Dati tattici per squadra: allenatore, modulo, e come la squadra crea e pressa.

--- A cosa serve ---
Il motore agentico avra' bisogno di sapere *come gioca* una squadra, non solo
come rende il singolo. Il modulo dice quanti slot ci sono per reparto — un
3-5-2 e un 4-3-3 valorizzano esterni diversi — e xG/xGA/PPDA dicono se quella
squadra crea, subisce e pressa alto. Sono le tre domande che un fantallenatore
si fa prima di puntare su un difensore o su un esterno.

--- Da dove arrivano i dati ---
    Transfermarkt   le 20 squadre, l'allenatore in carica, il suo modulo
    Understat       xG, xGA e PPDA di squadra, piu' turnover, cartellini e
                    distribuzione dei gol per reparto

Le statistiche di rosa non costano richieste: `getLeagueData` restituisce
`{teams, players, dates}` in una risposta sola, e per un po' ne abbiamo usata
meta'. Il blocco `players` e' lo stesso che il provider dei giocatori legge in
produzione, quindi la pagina Rosa di Transfermarkt — venti richieste in piu',
parsing HTML fragile, conteggi mescolati fra campionato e coppe — non serve.

--- Perche' dalle pagine squadra e non dalla lista di competizione ---
La pagina degli allenatori di competizione non esiste piu' (risponde 404), ma
anche esistesse il percorso per club sarebbe piu' affidabile: e' l'unico che
resta corretto quando una neopromossa cambia allenatore ad agosto, cioe'
esattamente quando questo file viene rigenerato.

Il costo e' ~41 richieste invece di una. Sono sequenziali di proposito: a un
secondo l'una fanno quaranta secondi, una volta a stagione, e la cache su disco
rende gratuito ogni tentativo successivo. Un pool di thread risparmierebbe
mezzo minuto in cambio di codice da leggere due volte.

--- Chi comanda sull'elenco delle squadre ---
Non Transfermarkt: `assets/data/listone.csv`. E' l'anagrafica attorno a cui e'
costruita tutta la pipeline, ed e' la stessa lista che l'utente vede nell'app.
La pagina di competizione dipende dal `saison_id` giusto e a cavallo di due
stagioni puo' ancora mostrare i club dell'anno prima; il listone no.

Nessun `import requests`: si passa da `HttpClient` come ogni altro modulo, e da
li' arrivano User-Agent da browser, rate limit per host, cache e retry.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Iterable, Optional

from . import config
from .http import HttpClient, HttpError
from .normalize import normalize_team, normalize_teams
from .providers.understat import extract_json_block, role_of

OUTPUT = config.OUTPUT_DIR / "coaches.json"

SERIE_A_URL = f"{config.TRANSFERMARKT_BASE}/serie-a/startseite/wettbewerb/IT1"
CLUB_HREF = re.compile(r"/([^/]+)/startseite/verein/(\d+)")
COACH_HREF = re.compile(r"/([^/]+)/profil/trainer/(\d+)")

# Nella pagina "Organigramma" ogni membro dello staff sta in una tabella
# annidata: il nome in una riga, il ruolo in quella dopo. Serve la corrispondenza
# *esatta*: "Vice allenatore" contiene "allenatore" e prenderebbe il posto del
# primo allenatore se il confronto fosse per sottostringa.
HEAD_COACH_ROLE = "allenatore"

# L'etichetta sul profilo e' "Modulo più utilizzato ultimi 2 anni", non "Modulo
# preferito" come si potrebbe supporre. Si cerca per parola chiave e non per
# testo esatto: e' una stringa tradotta, e cambia con la lingua del dominio.
FORMATION_LABEL = "modulo"

# "3-5-2", "4-2-3-1": da due a quattro reparti. Tutto il resto — un trattino
# solo, una frase, una cella vuota — non e' un modulo e diventa null.
FORMATION = re.compile(r"\d(?:-\d){1,3}")


class CoachesError(RuntimeError):
    """Una fonte ha cambiato forma: meglio fermarsi che scrivere zeri."""


@dataclass(frozen=True)
class ClubRef:
    """Una squadra come Transfermarkt la identifica."""

    name: str
    slug: str
    club_id: str

    @property
    def key(self) -> str:
        return normalize_team(self.name)


@dataclass(frozen=True)
class GoalSplit:
    """
    Da quale reparto arrivano i gol.

    I conteggi viaggiano accanto alle percentuali perche' una percentuale da
    sola non si interpreta: "30% dai difensori" pesa in modo molto diverso su 40
    gol o su 80, e il totale non e' ricavabile da `xg_totali`, che sono i gol
    *attesi* e non quelli fatti.

    `totale` sono i gol dei giocatori di movimento: i portieri restano fuori dai
    tre secchielli e dal denominatore, cosi' le percentuali sommano a 100. Un gol
    di portiere in campionato capita una volta ogni due stagioni, e un quarto
    secchiello vuoto per 19 squadre su 20 costerebbe piu' di quanto vale.
    """

    difensori: int
    centrocampisti: int
    attaccanti: int
    totale: int
    difensori_perc: float
    centrocampisti_perc: float
    attaccanti_perc: float


@dataclass(frozen=True)
class SquadStats:
    """Quel che la rosa di una squadra dice sull'allenatore che la schiera."""

    giocatori_impiegati: Optional[int]
    gialli: Optional[int]
    rossi: Optional[int]
    distribuzione: Optional[GoalSplit]

    @classmethod
    def vuote(cls) -> "SquadStats":
        return cls(giocatori_impiegati=None, gialli=None, rossi=None, distribuzione=None)


@dataclass
class CoachRecord:
    """Una riga del file finale."""

    allenatore: Optional[str]
    squadra: str
    modulo_base: Optional[str]
    xg_totali: Optional[float]
    xga_totali: Optional[float]
    ppda_stagione: Optional[float]
    giocatori_impiegati_storico: Optional[int]
    gialli_totali: Optional[int]
    rossi_totali: Optional[int]
    distribuzione_gol: Optional[GoalSplit]


# --- Parsing: puro, testabile senza rete -------------------------------------


def _soup(html: str):
    from bs4 import BeautifulSoup

    try:
        return BeautifulSoup(html, "lxml")
    except Exception:
        return BeautifulSoup(html, "html.parser")


def parse_clubs(html: str) -> list[ClubRef]:
    """Le squadre della competizione, deduplicate per id."""
    clubs: dict[str, ClubRef] = {}

    for anchor in _soup(html).select('a[href*="/startseite/verein/"]'):
        found = CLUB_HREF.search(anchor.get("href", ""))
        if found is None:
            continue
        name = (anchor.get("title") or anchor.get_text(" ", strip=True) or "").strip()
        club_id = found.group(2)
        # Lo stesso club compare piu' volte (stemma, nome, colonna valore): la
        # prima occorrenza utile e' quella con il nome per esteso.
        if name and club_id not in clubs:
            clubs[club_id] = ClubRef(name=name, slug=found.group(1), club_id=club_id)

    return list(clubs.values())


def parse_head_coach(html: str) -> Optional[tuple[str, str]]:
    """
    (nome, slug-profilo) dell'allenatore in carica, dalla pagina Organigramma.

    La pagina elenca tutto lo staff — vice, preparatori dei portieri, atletici:
    su una squadra di Serie A sono una ventina di persone, tutte con un link
    `/profil/trainer/`. L'unica che interessa e' quella il cui ruolo e'
    esattamente "Allenatore".
    """
    for anchor in _soup(html).select('a[href*="/profil/trainer/"]'):
        inner = anchor.find_parent("table")
        if inner is None:
            continue

        rows = [tr.get_text(" ", strip=True) for tr in inner.find_all("tr")]
        role = rows[-1].strip().lower() if rows else ""
        if role != HEAD_COACH_ROLE:
            continue

        name = anchor.get_text(" ", strip=True)
        href = anchor.get("href", "")
        if name and COACH_HREF.search(href):
            return name, href

    return None


def parse_formation(html: str) -> Optional[str]:
    """
    Il modulo dal profilo dell'allenatore, cercato per etichetta.

    Non per posizione: le righe di quella tabella cambiano da un allenatore
    all'altro — chi non ha allenato una nazionale ne ha una in meno — e un
    indice fisso leggerebbe la data di nascita di qualcun altro.
    """
    for row in _soup(html).find_all("tr"):
        header = row.find("th")
        cell = row.find("td")
        if header is None or cell is None:
            continue
        if FORMATION_LABEL not in header.get_text(" ", strip=True).lower():
            continue

        found = FORMATION.search(cell.get_text(" ", strip=True))
        if found:
            return found.group(0)

    # Nessun modulo dichiarato e' un esito legittimo: un allenatore appena
    # arrivato non ne ha ancora uno. Null, non una stringa inventata.
    return None


def aggregate_history(history: Iterable[dict[str, Any]]) -> tuple[float, float, Optional[float]]:
    """
    (xG, xGA, PPDA) di stagione da un elenco di partite.

    Sommare 38 righe non e' un calcolo complesso: e' l'unica forma in cui
    Understat pubblica i totali, che a differenza dei valori per partita non
    espone da nessuna parte.

    **Il PPDA non si media.** E' un rapporto — passaggi concessi per azione
    difensiva — e la media dei rapporti non e' il rapporto delle somme. In una
    partita chiusa con quindici azioni difensive il PPDA schizza a venti e
    trascinerebbe con se' la media di tutta la stagione. Il PPDA di stagione e'
    la somma dei passaggi concessi divisa per la somma delle azioni difensive,
    che e' anche la definizione della metrica.
    """
    xg = xga = 0.0
    att = deff = 0.0
    partite = 0

    for match in history:
        try:
            xg += float(match["xG"])
            xga += float(match["xGA"])
            ppda = match["ppda"]
            att += float(ppda["att"])
            deff += float(ppda["def"])
        except (KeyError, TypeError, ValueError) as error:
            raise CoachesError(
                f"Understat ha cambiato la forma di `history`: {error}. "
                "Meglio fermarsi che pubblicare zeri — uno zero di xG e' "
                "indistinguibile da una squadra che non tira mai."
            ) from error
        partite += 1

    if partite == 0:
        return 0.0, 0.0, None

    # Zero azioni difensive in tutta la stagione non e' un dato plausibile: se
    # capita, e' un campo mancante travestito da numero.
    ppda_stagione = round(att / deff, 2) if deff > 0 else None
    return round(xg, 2), round(xga, 2), ppda_stagione


def aggregate_squads(players: Iterable[dict[str, Any]]) -> dict[str, SquadStats]:
    """
    Turnover, cartellini e distribuzione dei gol, per squadra. Puro: nessuna rete.

    Una passata sola su tutti i giocatori della lega, indicizzando per forma
    normalizzata del club — la stessa che usa il resto del modulo, quindi le
    chiavi combaciano senza un secondo giro di matching.

    --- I trasferiti, e perche' ogni campo ha la sua regola ---
    Understat pubblica **una riga per giocatore per stagione**: chi cambia
    squadra a gennaio ha `team_title` a piu' valori ("Napoli,Torino") e le
    statistiche gia' sommate fra le due. La ripartizione non esiste da nessuna
    parte, quindi va deciso cosa farne — e la risposta giusta non e' la stessa
    per tutti e tre i campi:

      turnover     lo conta in **entrambe** le squadre. Non e' un compromesso:
                   entrambe lo hanno davvero schierato, ed e' esattamente cio'
                   che l'indice misura.

      cartellini   lo conta in **nessuna**. I suoi cartellini sono un totale
                   indiviso: darli a tutte e due significherebbe gonfiare due
                   numeri con dati inventati.

      gol          idem, e in piu' cosi' numeratore e denominatore restano sulla
                   stessa popolazione.

    Il costo, dichiarato: cartellini e gol sono leggermente **incompleti** per le
    squadre coinvolte in scambi invernali. E' un buco noto e in una direzione
    sola, contro una sovrastima che nessuno saprebbe quantificare leggendo il file.
    """
    turnover: dict[str, int] = {}
    gialli: dict[str, int] = {}
    rossi: dict[str, int] = {}
    mono: dict[str, int] = {}
    gol: dict[str, dict[str, int]] = {}

    for player in players:
        try:
            squadre = normalize_teams(str(player.get("team_title") or ""))
            presenze = int(float(player.get("games") or 0))
            reti = int(float(player.get("goals") or 0))
            gialli_g = int(float(player.get("yellow_cards") or 0))
            rossi_g = int(float(player.get("red_cards") or 0))
        except (TypeError, ValueError) as error:
            raise CoachesError(
                f"Understat ha cambiato la forma di `players`: {error}. "
                "Meglio fermarsi che pubblicare zeri — zero cartellini e' "
                "indistinguibile da una squadra irreprensibile."
            ) from error

        if not squadre:
            continue

        # Chi non e' mai sceso in campo non e' stato "impiegato": e' in rosa.
        if presenze > 0:
            for chiave in squadre:
                turnover[chiave] = turnover.get(chiave, 0) + 1

        if len(squadre) != 1:
            continue

        chiave = next(iter(squadre))
        mono[chiave] = mono.get(chiave, 0) + 1
        gialli[chiave] = gialli.get(chiave, 0) + gialli_g
        rossi[chiave] = rossi.get(chiave, 0) + rossi_g

        reparto = role_of(str(player.get("position") or ""))
        if reti and reparto in ("D", "C", "A"):
            gol.setdefault(chiave, {})[reparto] = gol.setdefault(chiave, {}).get(reparto, 0) + reti

    return {
        chiave: SquadStats(
            giocatori_impiegati=turnover.get(chiave),
            # Senza nemmeno un giocatore mono-squadra il totale sarebbe zero, che
            # e' un numero plausibile e sbagliato. Irraggiungibile in pratica.
            gialli=gialli.get(chiave) if mono.get(chiave) else None,
            rossi=rossi.get(chiave) if mono.get(chiave) else None,
            distribuzione=_split(gol.get(chiave, {})),
        )
        for chiave in set(turnover) | set(mono)
    }


def _split(per_reparto: dict[str, int]) -> Optional[GoalSplit]:
    """Le percentuali dei tre reparti, o None se non c'e' niente da distribuire."""
    difensori = per_reparto.get("D", 0)
    centrocampisti = per_reparto.get("C", 0)
    attaccanti = per_reparto.get("A", 0)
    totale = difensori + centrocampisti + attaccanti

    # `0/0` non e' `0%`: senza gol non esiste una distribuzione da descrivere.
    if totale == 0:
        return None

    def quota(valore: int) -> float:
        return round(valore * 100 / totale, 1)

    # Arrotondate a un decimale, quindi la somma puo' dare 99.9 o 100.1.
    # Forzare l'ultima a chiudere il conto scriverebbe un numero leggermente
    # falso per far tornare un totale che nessuno somma.
    return GoalSplit(
        difensori=difensori,
        centrocampisti=centrocampisti,
        attaccanti=attaccanti,
        totale=totale,
        difensori_perc=quota(difensori),
        centrocampisti_perc=quota(centrocampisti),
        attaccanti_perc=quota(attaccanti),
    )


# --- Raccolta ----------------------------------------------------------------


def _fetch(http: HttpClient, url: str, **kwargs: Any) -> str:
    return http.fetch(url, user_agent=config.BROWSER_USER_AGENT, **kwargs)


def fetch_understat(
    http: HttpClient,
) -> tuple[dict[str, tuple[float, float, Optional[float]]], dict[str, SquadStats]]:
    """
    Metriche di squadra e statistiche di rosa, indicizzate sul nome normalizzato.

    Le due cose escono dalla **stessa risposta**: `getLeagueData` restituisce
    `{teams, players, dates}`, e la pagina inline porta sia `teamsData` sia
    `playersData`. Aggiungere turnover, cartellini e distribuzione dei gol non
    e' quindi costato una sola richiesta in piu' — leggevamo gia' tutto, ne
    usavamo meta'.

    Due strade per lo stesso dato, e servono entrambe: storicamente la pagina
    stampava i blocchi in uno <script>, oggi li carica via XHR. Provare la
    seconda solo dopo un buco della prima rende il modulo indifferente a quale
    delle due Understat stia servendo — ed e' la stessa coppia gia' collaudata
    dal provider dei giocatori.
    """
    season = config.UNDERSTAT_SEASON
    page_url = f"{config.UNDERSTAT_BASE}/league/{config.UNDERSTAT_LEAGUE}/{season}"

    html = _fetch(http, page_url)
    teams = extract_json_block(html, "teamsData")
    players = extract_json_block(html, "playersData")

    if not isinstance(teams, dict) or not teams:
        raw = _fetch(
            http,
            f"{config.UNDERSTAT_BASE}/getLeagueData/{config.UNDERSTAT_LEAGUE}/{season}",
            headers={
                "X-Requested-With": "XMLHttpRequest",
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Referer": page_url,
            },
        )
        try:
            payload = json.loads(raw) or {}
        except ValueError as error:
            raise CoachesError(f"Understat: risposta non interpretabile ({error})") from error
        teams = payload.get("teams") or {}
        players = payload.get("players") or []

    if not isinstance(teams, dict) or not teams:
        raise CoachesError("Understat non ha restituito nessuna squadra.")

    metrics: dict[str, tuple[float, float, Optional[float]]] = {}
    for team in teams.values():
        title = str(team.get("title") or "").strip()
        if not title:
            continue
        metrics[normalize_team(title)] = aggregate_history(team.get("history") or [])

    squads = aggregate_squads(players if isinstance(players, list) else [])
    return metrics, squads


def fetch_clubs(http: HttpClient) -> list[ClubRef]:
    clubs = parse_clubs(_fetch(http, SERIE_A_URL, params={"saison_id": config.TM_SEASON}))
    if not clubs:
        raise CoachesError(
            f"Nessuna squadra trovata su {SERIE_A_URL}: la pagina ha cambiato struttura."
        )
    return clubs


def fetch_coach(http: HttpClient, club: ClubRef) -> tuple[Optional[str], Optional[str]]:
    """(nome, modulo) dell'allenatore di quel club. Due richieste."""
    staff_url = f"{config.TRANSFERMARKT_BASE}/{club.slug}/mitarbeiter/verein/{club.club_id}"
    try:
        head = parse_head_coach(_fetch(http, staff_url))
    except HttpError:
        return None, None

    if head is None:
        return None, None

    name, href = head
    try:
        formation = parse_formation(_fetch(http, f"{config.TRANSFERMARKT_BASE}{href}"))
    except HttpError:
        formation = None

    return name, formation


def collect(
    http: HttpClient,
    roster_teams: dict[str, str],
    limit: Optional[int] = None,
) -> list[CoachRecord]:
    """
    Un record per squadra del listone, sempre.

    Anche quando una fonte non copre: i campi restano a `null` e non spariscono,
    cosi' chi legge il file non deve distinguere "chiave mancante" da "dato
    mancante". E' la stessa garanzia di cardinalita' che `builder.build_records`
    da' al dataset dei giocatori.

    `roster_teams` mappa la forma normalizzata al nome come lo scrive il
    listone: e' quel nome a finire nel file, perche' e' il vocabolario dell'app
    e permettera' all'agente di unire questo file ai giocatori senza un secondo
    passaggio di normalizzazione.
    """
    metrics, squads = fetch_understat(http)
    clubs = {club.key: club for club in fetch_clubs(http)}

    chiavi = sorted(roster_teams)
    if limit:
        chiavi = chiavi[:limit]

    records: list[CoachRecord] = []
    for key in chiavi:
        club = clubs.get(key)
        name = formation = None
        if club is not None:
            name, formation = fetch_coach(http, club)

        xg, xga, ppda = metrics.get(key, (None, None, None))
        # Una squadra che Understat non conosce — una neopromossa — non ha
        # statistiche di rosa: quattro `null`, non quattro zeri. Zero direbbe
        # "non ha schierato nessuno", che e' falso: non lo sappiamo.
        squad = squads.get(key, SquadStats.vuote())

        records.append(
            CoachRecord(
                allenatore=name,
                squadra=roster_teams[key],
                modulo_base=formation,
                xg_totali=xg,
                xga_totali=xga,
                ppda_stagione=ppda,
                giocatori_impiegati_storico=squad.giocatori_impiegati,
                gialli_totali=squad.gialli,
                rossi_totali=squad.rossi,
                distribuzione_gol=squad.distribuzione,
            )
        )

    return records


def write(records: list[CoachRecord], path: Path = OUTPUT) -> Path:
    """Scrittura atomica: se il processo muore a meta', il file buono resta."""
    path.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps([asdict(r) for r in records], ensure_ascii=False, indent=2) + "\n"

    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(body, encoding="utf-8")
    tmp.replace(path)
    return path
