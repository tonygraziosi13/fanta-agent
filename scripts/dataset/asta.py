"""
Partecipanti della lega e stato d'asta iniziale.

--- A cosa serve ---
L'app conosce i giocatori e le squadre di Serie A, ma non sa **chi c'e' al
tavolo**. Senza quello il motore agentico non puo' dire "quel portiere te lo
porta via Marco, che ha ancora 380 crediti e nessun portiere": puo' solo
valutare il giocatore in astratto, che in asta serve a poco.

Questo modulo estrae i nomi delle squadre iscritte da Leghe Fantacalcio e li
inizializza a crediti pieni e rose vuote.

--- Perche' un browser e non `requests` ---
L'area leghe e' privata e costruita in javascript: non c'e' una pagina
server-rendered da cui leggere l'elenco.

--- L'area leghe ha un login suo, e non e' quello del sito principale ---
Sembrerebbe naturale riusare `download_listone.login`, che autentica su
`www.fantacalcio.it`. Non funziona, ed e' stato verificato: i cookie di
sessione (`fantacalcio.it` e `client.fantacalcio.it`) sono **host-only** su
`www.fantacalcio.it` — senza punto iniziale nel dominio — quindi il browser non
li invia a `leghe.fantacalcio.it`. Replicarli a mano sul sottodominio non basta:
il backend delle leghe non li riconosce, e la pagina continua a mostrare
"ACCEDI".

Qui si passa quindi dal form di `/login`, che e' HTML normale. I campi non hanno
`name` ne' `id`: si selezionano per placeholder, che e' l'unico ancoraggio che
il sito offre.

--- La scelta che governa il codice qui sotto ---
Nessuna delle etichette di navigazione e' stata verificata: l'area e' dietro
autenticazione e non e' ispezionabile senza credenziali. Un selettore scritto a
indovinare fallisce con un timeout di trenta secondi che non dice **niente** su
cosa ci fosse davvero nella pagina.

Da qui due decisioni che spiegano quasi tutto il file:

  1. Ogni passo accetta **piu' etichette alternative**, confrontate senza
     distinzione di maiuscole e con gli spazi collassati. "Menu", "MENU" e
     "Menù" sono la stessa voce.
  2. Al primo elemento non trovato si salvano HTML e screenshot e si solleva un
     errore che **elenca cosa era cliccabile davvero**. Un fallimento produce
     l'informazione per correggerlo, invece di un muro.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional, Sequence

from . import config
from .download_listone import (
    DownloadError,
    apri_contesto,
    avvia_playwright,
    credentials,
    salva_sessione,
)

LEGHE_URL = "https://leghe.fantacalcio.it"
LOGIN_URL = f"{LEGHE_URL}/login"
LEGA_PREDEFINITA = "Io eTe"

# La pagina con tutte le squadre della lega. Il sito la chiama "Dai uno sguardo
# alle altre squadre"; nel menu non esiste alcuna voce "Partecipanti", e i
# percorsi che verrebbero da indovinare (`/view/rose`, `/view/partecipanti`)
# redirigono in silenzio alla radice della lega.
PERCORSO_ROSE = "/view/rosters"

# Nel markup Angular della pagina rose ogni squadra e' una card: il titolo e' il
# nome, la descrizione e' il nickname del proprietario. E' il selettore
# verificato sulla pagina vera, e sta per primo nella cascata.
SELETTORE_CARD = ".ant-card-meta-detail"
SELETTORE_NOME = ".ant-card-meta-title"
SELETTORE_PROPRIETARIO = ".ant-card-meta-description"

OUTPUT = Path(__file__).resolve().parent / "stato_asta.json"
# Gli artefatti diagnostici stanno sotto `.cache/`, ignorata da git per intero:
# uno screenshot dell'area leghe contiene i nomi dei partecipanti.
DUMP_DIR = config.ROOT / ".cache" / "asta"

DEFAULT_CREDITI = 500
DEFAULT_SLOT = {"P": 3, "D": 8, "C": 8, "A": 6}

# Il consenso ai cookie non e' un passo obbligatorio: se e' gia' stato dato, il
# banner non compare. Timeout corto e si prosegue comunque.
COOKIE_LABELS = ("Accetta", "Accetto", "Accetta tutti", "Ho capito", "OK", "Consenti")
COOKIE_TIMEOUT_MS = 2_000

# Il sito serve interstiziali pubblicitari a schermo intero che **intercettano i
# click**: Playwright non fallisce con "elemento non trovato" ma con "elemento
# coperto", che senza questa gestione sembra la stessa cosa. Vanno chiusi prima
# di ogni passo, e possono ricomparire fra un passo e l'altro.
OVERLAY_LABELS = ("Chiudi", "Close", "Salta", "Skip", "No grazie", "×")
OVERLAY_SELECTORS = (
    "[aria-label*='Chiudi' i]",
    "[aria-label*='close' i]",
    "[id*='dismiss' i]",
    "[class*='close-button' i]",
)
OVERLAY_TIMEOUT_MS = 1_500

PASSO_TIMEOUT_MS = 15_000

# Intestazioni e voci di servizio che compaiono nelle tabelle e non sono squadre.
NON_SQUADRE = {
    "squadra", "squadre", "nome", "nome squadra", "partecipante", "partecipanti",
    "allenatore", "utente", "crediti", "rosa", "azioni", "email", "ruolo",
    # Voci di menu e di navigazione. Sono qui perche' ci sono finite davvero:
    # con un selettore generico (`ul li`) l'estrazione aveva restituito il menu
    # della lega al posto delle squadre, e il file era uscito con "Mercato" e
    # "Lista calciatori" come partecipanti.
    "dashboard", "rose", "calendario", "classifica", "menu", "menu'",
    "schiera formazione", "ultimi risultati", "mercato", "lista calciatori",
    "svincolati", "profilo", "opzioni di lega", "competizioni",
    "gestione divisioni", "sala trofei", "registro attivita admin", "documenti",
    "comunicazioni", "consigli sulle formazioni", "probabili formazioni",
    "voti fantacalcio serie a", "rigoristi serie a", "euroleghe fantacalcio",
    "fantaasta live", "fantaasta buzz", "leghe fantacalcio", "fantacalcio",
    "guida per l'asta perfetta", "guida per lasta perfetta",
}


class AstaError(RuntimeError):
    """Il flusso non e' arrivato in fondo. Il messaggio dice a che punto e con cosa davanti."""


@dataclass
class Squadra:
    """Una riga del file di stato."""

    nome_squadra: str
    proprietario: Optional[str]
    """
    True per la squadra dell'utente che ha fatto il login.

    Serve all'agente per distinguere "i miei crediti" da "i crediti di chi mi
    contende il giocatore", che in asta e' la domanda vera: sapere che restano
    380 crediti in giro non dice niente se non si sa quanti ne ho io.
    """
    sono_io: bool
    crediti_residui: int
    slot_liberi: dict[str, int]
    rosa: list[Any]


# --- Logica pura: testabile senza browser ------------------------------------


def chiave(nome: str) -> str:
    """
    Forma normalizzata per l'abbinamento: minuscolo, senza accenti, spazi collassati.

    Il sito puo' cambiare la spaziatura o la capitalizzazione di un nome senza
    che quella sia una squadra diversa. Nel file resta scritta la grafia che il
    sito mostra adesso; questa serve solo a riconoscerla.
    """
    piatto = unicodedata.normalize("NFKD", nome)
    piatto = "".join(c for c in piatto if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", piatto).strip().lower()


def pulisci_nomi(grezzi: Iterable[str]) -> list[str]:
    """
    Ripulisce l'elenco estratto dalla pagina, preservando l'ordine.

    Scarta righe vuote, intestazioni di tabella e duplicati: la stessa squadra
    compare spesso due volte nella stessa riga (stemma piu' nome), esattamente
    come i club nella pagina di Transfermarkt.
    """
    visti: set[str] = set()
    nomi: list[str] = []

    for grezzo in grezzi:
        nome = re.sub(r"\s+", " ", str(grezzo or "")).strip()
        if not nome or chiave(nome) in NON_SQUADRE:
            continue
        # Un nome di squadra non e' un paragrafo: se e' lunghissimo, quel che
        # abbiamo preso e' un blocco di pagina, non una riga di elenco.
        if len(nome) > 60:
            continue
        if chiave(nome) in visti:
            continue
        visti.add(chiave(nome))
        nomi.append(nome)

    return nomi


def squadra_iniziale(nome: str, proprietario: Optional[str] = None, sono_io: bool = False) -> Squadra:
    return Squadra(
        nome_squadra=nome,
        proprietario=proprietario,
        sono_io=sono_io,
        crediti_residui=DEFAULT_CREDITI,
        # `dict(...)` e non il riferimento: due squadre non devono condividere
        # lo stesso dizionario di slot, o scalarne uno le scalerebbe entrambe.
        slot_liberi=dict(DEFAULT_SLOT),
        rosa=[],
    )


def leggi_stato(path: Path = OUTPUT) -> list[dict[str, Any]]:
    """Lo stato precedente, se c'e'. Un file illeggibile vale come assente."""
    if not path.exists():
        return []
    try:
        dati = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return []
    return dati if isinstance(dati, list) else []


@dataclass
class Merge:
    squadre: list[Squadra]
    nuove: list[str]
    preservate: list[str]
    """Erano nel file ma il sito non le elenca piu'."""
    sparite: list[str]


def unisci(
    partecipanti: Sequence[Any],
    precedente: Sequence[dict[str, Any]],
    utente: str = "",
    mia_squadra: Optional[str] = None,
) -> Merge:
    """
    I nomi dal sito, sopra lo stato gia' salvato.

    **Le squadre gia' presenti mantengono tutto** — crediti, slot, rosa. Solo le
    nuove partono dai default. E' cio' che rende sicuro rilanciare lo script a
    meta' asta, quando entra un partecipante in ritardo, invece di azzerare due
    ore di lavoro.

    Una squadra sparita dall'elenco **non viene cancellata**: resta in coda e il
    report la segnala. Distinguere "ha lasciato la lega" da "ha rinominato la
    squadra" e' impossibile dall'esterno, e cancellare una rosa costruita in asta
    e' irreversibile. E' lo stesso istinto di `quotazioni.merge_with_previous`,
    che non toglie mai un giocatore dal listone.
    """
    per_chiave = {
        chiave(str(voce.get("nome_squadra", ""))): voce
        for voce in precedente
        if isinstance(voce, dict) and voce.get("nome_squadra")
    }

    squadre: list[Squadra] = []
    nuove: list[str] = []
    preservate: list[str] = []
    viste: set[str] = set()

    for voce in partecipanti:
        # Si accetta sia "nome" sia ("nome", "proprietario"): il secondo e' cio'
        # che arriva dal sito, il primo tiene i test leggibili.
        grezzo, proprietario = voce if isinstance(voce, (tuple, list)) else (voce, None)

        # Gli spazi si collassano anche qui e non solo in `pulisci_nomi`: questa
        # funzione non deve dipendere dal fatto che chi la chiama abbia gia'
        # ripulito, o il file finirebbe con due grafie della stessa squadra.
        nome = re.sub(r"\s+", " ", str(grezzo)).strip()
        k = chiave(nome)
        viste.add(k)
        vecchia = per_chiave.get(k)

        # L'indicazione esplicita vince sull'euristica del nickname: quella
        # propone, `--mia-squadra` dispone.
        mio = chiave(nome) == chiave(mia_squadra) if mia_squadra else sono_lo_stesso(
            proprietario, utente
        )

        if vecchia is None:
            squadre.append(squadra_iniziale(nome, proprietario, mio))
            nuove.append(nome)
            continue

        slot = vecchia.get("slot_liberi")
        squadre.append(
            Squadra(
                # La grafia nuova: e' quella che il sito mostra adesso.
                nome_squadra=nome,
                # Idem per il proprietario: se il sito non lo espone piu' si
                # conserva quello gia' salvato invece di perderlo.
                proprietario=proprietario or vecchia.get("proprietario"),
                sono_io=mio or bool(vecchia.get("sono_io")),
                crediti_residui=int(vecchia.get("crediti_residui", DEFAULT_CREDITI)),
                slot_liberi=dict(slot) if isinstance(slot, dict) else dict(DEFAULT_SLOT),
                rosa=list(vecchia.get("rosa") or []),
            )
        )
        preservate.append(nome)

    sparite: list[str] = []
    for k, vecchia in per_chiave.items():
        if k in viste:
            continue
        nome = str(vecchia["nome_squadra"])
        slot = vecchia.get("slot_liberi")
        squadre.append(
            Squadra(
                nome_squadra=nome,
                proprietario=vecchia.get("proprietario"),
                sono_io=bool(vecchia.get("sono_io")),
                crediti_residui=int(vecchia.get("crediti_residui", DEFAULT_CREDITI)),
                slot_liberi=dict(slot) if isinstance(slot, dict) else dict(DEFAULT_SLOT),
                rosa=list(vecchia.get("rosa") or []),
            )
        )
        sparite.append(nome)

    return Merge(squadre=squadre, nuove=nuove, preservate=preservate, sparite=sparite)


def scrivi(squadre: Sequence[Squadra], path: Path = OUTPUT) -> Path:
    """Scrittura atomica: se il processo muore a meta', lo stato buono resta."""
    from dataclasses import asdict

    path.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps([asdict(s) for s in squadre], ensure_ascii=False, indent=2) + "\n"

    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(body, encoding="utf-8")
    tmp.replace(path)
    return path


# --- Navigazione -------------------------------------------------------------


def _regex(etichetta: str) -> "re.Pattern[str]":
    """Match tollerante: maiuscole indifferenti, spazi collassati, accenti a parte."""
    parti = [re.escape(p) for p in etichetta.split()]
    return re.compile(r"\s*".join(parti), re.IGNORECASE)


def _cliccabili(page) -> list[str]:
    """
    Le etichette effettivamente cliccabili, per il messaggio d'errore.

    E' quel che trasforma "timeout dopo 15 secondi" in "c'erano questi bottoni":
    la differenza fra una correzione immediata e mezz'ora a indovinare.
    """
    etichette: list[str] = []
    for selettore in ("a", "button", "[role=button]", "[role=link]"):
        for nodo in page.locator(selettore).all()[:80]:
            try:
                if not nodo.is_visible():
                    continue
                testo = re.sub(r"\s+", " ", nodo.inner_text()).strip()
            except Exception:
                continue
            if testo and len(testo) < 50 and testo not in etichette:
                etichette.append(testo)
    return etichette[:40]


def dump(page, nome: str) -> Path:
    """HTML e screenshot della pagina, per capire cosa c'era davvero."""
    DUMP_DIR.mkdir(parents=True, exist_ok=True)
    base = DUMP_DIR / nome
    try:
        base.with_suffix(".html").write_text(page.content(), encoding="utf-8")
        page.screenshot(path=str(base.with_suffix(".png")), full_page=True)
    except Exception:
        pass  # il dump e' un aiuto, non deve diventare esso stesso un errore
    return base


def chiudi_overlay(page) -> bool:
    """
    Chiude gli interstiziali pubblicitari, se ce ne sono.

    Non e' cortesia: un banner a schermo intero **intercetta i click** e fa
    fallire il passo successivo con un errore che parla di elemento non
    cliccabile, non di pubblicita'. E' il motivo per cui il primo tentativo di
    aprire la lega non andava a buon fine pur essendo il selettore corretto.

    Best-effort e silenziosa: la maggior parte delle volte non c'e' niente da
    chiudere, e non trovarlo non e' un errore.
    """
    chiuso = False

    for etichetta in OVERLAY_LABELS:
        try:
            elemento = page.get_by_text(_regex(etichetta)).first
            if elemento.is_visible(timeout=OVERLAY_TIMEOUT_MS):
                elemento.click(timeout=OVERLAY_TIMEOUT_MS)
                chiuso = True
        except Exception:
            continue

    for selettore in OVERLAY_SELECTORS:
        try:
            elemento = page.locator(selettore).first
            if elemento.is_visible(timeout=OVERLAY_TIMEOUT_MS):
                elemento.click(timeout=OVERLAY_TIMEOUT_MS)
                chiuso = True
        except Exception:
            continue

    if chiuso:
        page.wait_for_timeout(800)
    return chiuso


def clicca(page, *etichette: str, passo: str = "", timeout: int = PASSO_TIMEOUT_MS) -> None:
    """
    Clicca il primo elemento che corrisponde a una delle etichette.

    Si prova per ruolo prima e per testo poi: una voce di navigazione puo' essere
    un link, un bottone o un semplice `div` con un handler, e su un'area che non
    ho potuto ispezionare non ha senso scommettere su quale.
    """
    # Due giri: al secondo si e' appena chiuso un interstiziale. Il primo
    # tentativo fallisce spesso non perche' il selettore sia sbagliato, ma
    # perche' un banner a schermo intero sta coprendo l'elemento.
    for giro in (1, 2):
        for etichetta in etichette:
            pattern = _regex(etichetta)
            for locator in (
                page.get_by_role("link", name=pattern),
                page.get_by_role("button", name=pattern),
                page.get_by_text(pattern),
            ):
                try:
                    elemento = locator.first
                    elemento.wait_for(
                        state="visible", timeout=timeout // (len(etichette) * 3) or 1000
                    )
                    elemento.click(timeout=timeout)
                    page.wait_for_load_state("domcontentloaded", timeout=timeout)
                    return
                except Exception:
                    continue

        if giro == 1 and not chiudi_overlay(page):
            break  # nessun overlay da chiudere: il secondo giro darebbe lo stesso esito

    percorso = dump(page, f"errore-{passo or 'clic'}")
    raise AstaError(
        f"Passo '{passo or etichette[0]}': nessun elemento corrisponde a "
        f"{list(etichette)}.\n"
        f"  Cliccabili in pagina: {_cliccabili(page)}\n"
        f"  HTML e screenshot in {percorso.parent}"
    )


def clicca_se_c_e(page, *etichette: str) -> bool:
    """
    Come `clicca`, ma non solleva se non trova niente.

    Serve per i passi che possono semplicemente non esistere. "LE TUE LEGHE" e'
    uno di questi: dopo il login l'elenco delle leghe e' gia' sulla landing, e
    quel pulsante compare solo in certi stati dell'interfaccia. Trattarlo come
    obbligatorio faceva fallire il flusso su un passo di cui non c'era bisogno.
    """
    try:
        clicca(page, *etichette, passo="facoltativo", timeout=4_000)
        return True
    except AstaError:
        return False


def accetta_cookie(page) -> bool:
    """Il banner, se c'e'. Non trovarlo non e' un errore: spesso e' gia' stato accettato."""
    for etichetta in COOKIE_LABELS:
        for locator in (
            page.get_by_role("button", name=_regex(etichetta)),
            page.get_by_text(_regex(etichetta)),
        ):
            try:
                elemento = locator.first
                elemento.wait_for(state="visible", timeout=COOKIE_TIMEOUT_MS)
                elemento.click(timeout=COOKIE_TIMEOUT_MS)
                return True
            except Exception:
                continue
    return False


def apri_lega(page, nome: str) -> str:
    """
    Entra nella lega **navigando al suo href**, non cliccandola.

    Il click sul nome della lega non funziona, e la ragione non e' il selettore:
    il sito serve interstiziali pubblicitari a schermo intero che intercettano
    l'evento. Playwright riporta un click riuscito, la pagina non cambia, e il
    passo dopo fallisce parlando di tutt'altro.

    L'ancora porta un `href` normale (`/io-ete`, che redirige a
    `/io-ete/view/dashboard`): leggerlo e andarci direttamente salta il problema
    invece di combatterlo, ed e' anche piu' veloce.
    """
    atteso = chiave(nome)
    href: Optional[str] = None

    for ancora_lega in page.locator("a").all()[:200]:
        try:
            if chiave(ancora_lega.inner_text() or "") != atteso:
                continue
            href = ancora_lega.get_attribute("href")
        except Exception:
            continue
        if href:
            break

    if not href:
        disponibili = _cliccabili(page)
        percorso = dump(page, "errore-lega")
        raise AstaError(
            f"Lega {nome!r} non trovata fra i link della pagina.\n"
            f"  Disponibili: {disponibili}\n"
            f"  Usa --lega per indicarne un'altra. HTML e screenshot in {percorso.parent}"
        )

    page.goto(
        href if href.startswith("http") else f"{LEGHE_URL}{href}",
        wait_until="domcontentloaded",
        timeout=60_000,
    )
    page.wait_for_timeout(3_000)
    chiudi_overlay(page)

    # `/io-ete` redirige a `/io-ete/view/dashboard`: si torna alla radice della
    # lega, che e' il prefisso su cui costruire gli altri percorsi.
    return re.sub(r"/view/.*$", "", page.url)


def sono_lo_stesso(proprietario: Optional[str], utente: str) -> bool:
    """
    True se quel proprietario e' l'utente che ha fatto il login.

    Il sito mostra un nickname abbreviato che non coincide con lo username:
    "tonygra13" contro "tonygraziosi1302". Non c'e' un identificatore comune, e
    l'unica cosa su cui appoggiarsi e' il prefisso condiviso.

    Sette caratteri e' la soglia: sotto, due nickname qualunque possono
    somigliarsi per caso; sopra, la coincidenza diventa improbabile. Resta
    un'euristica, ed e' il motivo per cui `--mia-squadra` permette di dirlo a
    mano — con l'euristica che si limita a proporre.
    """
    if not proprietario or not utente:
        return False

    atteso = chiave(utente).replace(" ", "")
    if not atteso:
        return False

    # Una squadra puo' avere piu' proprietari, e il sito li scrive nella stessa
    # cella separati da un punto medio: "giacomo · tonygra13". Confrontare la
    # stringa intera non trova mai niente — vanno provati uno per uno.
    for pezzo in re.split(r"[\u00b7,/|]", proprietario):
        candidato = chiave(pezzo).replace(" ", "")
        if not candidato:
            continue
        if candidato == atteso:
            return True

        comune = 0
        for x, y in zip(candidato, atteso):
            if x != y:
                break
            comune += 1
        if comune >= 7:
            return True

    return False


def estrai_partecipanti(page) -> list[tuple[str, Optional[str]]]:
    """
    Le squadre della lega, ognuna col nome del proprietario.

    Il selettore delle card e' verificato sulla pagina vera: ogni squadra e' una
    card Angular con il nome nel titolo e il nickname del proprietario nella
    descrizione. Si leggono **dalla stessa card** e non da due elenchi paralleli,
    che si disallineerebbero al primo elemento in piu' da una parte sola — e ce
    n'e' uno: la squadra in cima alla pagina compare due volte, come intestazione
    e come voce dell'elenco.
    """
    squadre: list[tuple[str, Optional[str]]] = []
    visti: set[str] = set()

    try:
        card = page.locator(SELETTORE_CARD).all()[:60]
    except Exception:
        card = []

    for scheda in card:
        try:
            nome = re.sub(r"\s+", " ", scheda.locator(SELETTORE_NOME).first.inner_text()).strip()
        except Exception:
            continue
        if not nome or chiave(nome) in NON_SQUADRE or len(nome) > 60:
            continue

        proprietario: Optional[str] = None
        try:
            grezzo = scheda.locator(SELETTORE_PROPRIETARIO).first.inner_text()
            proprietario = re.sub(r"\s+", " ", grezzo).strip() or None
        except Exception:
            proprietario = None

        k = chiave(nome)
        if k in visti:
            # Gia' vista: se stavolta ha un proprietario e prima no, si completa.
            if proprietario:
                for indice, (esistente, vecchio) in enumerate(squadre):
                    if chiave(esistente) == k and not vecchio:
                        squadre[indice] = (esistente, proprietario)
            continue

        visti.add(k)
        squadre.append((nome, proprietario))

    # Una lega ha almeno due partecipanti: sotto, quel che abbiamo preso e'
    # quasi certamente un pezzo di interfaccia e non l'elenco. Un elenco vuoto
    # scritto sopra uno buono sarebbe peggio di un errore.
    if len(squadre) >= 2:
        return squadre

    percorso = dump(page, "errore-partecipanti")
    raise AstaError(
        f"Nessun partecipante estratto: il selettore {SELETTORE_CARD!r} non ha "
        "prodotto un elenco plausibile.\n"
        f"  HTML e screenshot in {percorso.parent}"
    )


def serve_login(page) -> bool:
    """
    True se la pagina mostra ancora l'invito ad accedere.

    Si guarda il bottone "ACCEDI" e non un cookie: la sessione dell'area leghe
    puo' essere scaduta lato server mentre il cookie e' ancora sul disco, e
    l'unico giudice affidabile e' cosa il sito sta mostrando adesso.
    """
    try:
        return page.get_by_text(_regex("ACCEDI")).first.is_visible(timeout=5_000)
    except Exception:
        return False


def login_leghe(page, user: str, password: str) -> None:
    """
    Accede dal form di `/login`.

    I due campi non hanno `name` ne' `id`: il placeholder e' l'unico ancoraggio
    che il sito offre, quindi e' quello che si usa. Se cambiassero anche quelli,
    il fallimento arriva col solito dump diagnostico invece che con un timeout.
    """
    page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=60_000)
    accetta_cookie(page)

    try:
        page.get_by_placeholder(_regex("Username")).first.fill(user, timeout=PASSO_TIMEOUT_MS)
        page.get_by_placeholder(_regex("Password")).first.fill(password, timeout=PASSO_TIMEOUT_MS)
    except Exception as errore:
        percorso = dump(page, "errore-login")
        raise AstaError(
            f"Campi di login non trovati su {LOGIN_URL}: {errore}\n"
            f"  HTML e screenshot in {percorso.parent}"
        ) from errore

    clicca(page, "LOGIN", "Accedi", "Entra", passo="login")
    page.wait_for_timeout(3_000)

    if serve_login(page):
        percorso = dump(page, "errore-login-rifiutato")
        raise AstaError(
            "Login rifiutato: la pagina mostra ancora 'ACCEDI'. Credenziali "
            "sbagliate, oppure il sito chiede una verifica in piu'.\n"
            f"  HTML e screenshot in {percorso.parent}"
        )


def raccogli(
    lega: str = LEGA_PREDEFINITA, headless: bool = True, dump_sempre: bool = False
) -> tuple[list[tuple[str, Optional[str]]], str]:
    """Percorre il flusso e restituisce i nomi delle squadre."""
    user, password = credentials()

    with avvia_playwright() as engine:
        browser = engine.chromium.launch(headless=headless)
        context = apri_contesto(browser)
        try:
            page = context.new_page()
            page.goto(LEGHE_URL, wait_until="domcontentloaded", timeout=60_000)
            accetta_cookie(page)

            if serve_login(page):
                login_leghe(page, user, password)
                salva_sessione(context)

            if dump_sempre:
                dump(page, "1-dashboard")

            chiudi_overlay(page)
            # Facoltativo: dopo il login le leghe sono gia' link sulla landing.
            clicca_se_c_e(page, "LE TUE LEGHE", "Le tue leghe", "Le mie leghe")
            if dump_sempre:
                dump(page, "2-elenco-leghe")

            base_lega = apri_lega(page, lega)
            print(f"  lega aperta: {base_lega}")
            if dump_sempre:
                dump(page, "3-lega")

            # --- La pagina delle squadre, e perche' non si passa dal menu ---
            # Il flusso "Menu -> Partecipanti" non esiste su questo sito: il menu
            # della lega contiene Mercato, Lista calciatori, Opzioni di Lega e
            # altro, ma nessuna voce Partecipanti. L'elenco delle squadre sta
            # dietro "Dai uno sguardo alle altre squadre", cioe' `/view/rosters`.
            #
            # Ci si va per URL e non per click: gli interstiziali pubblicitari
            # intercettano i click, e un `goto` non ha quel problema.
            page.goto(
                f"{base_lega}{PERCORSO_ROSE}", wait_until="domcontentloaded", timeout=60_000
            )
            page.wait_for_timeout(4_000)
            chiudi_overlay(page)
            if dump_sempre:
                dump(page, "4-partecipanti")

            return estrai_partecipanti(page), user
        finally:
            context.close()
            browser.close()
