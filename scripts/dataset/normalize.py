"""
Normalizzazione di nomi e squadre: le primitive su cui si regge US19-2.

Solo stdlib (`unicodedata`, `re`): e' la parte piu' testata della pipeline e
deve poter girare ovunque, anche senza le dipendenze di scraping installate.

Il problema concreto che risolve: il listone scrive "Milinkovic-Savic V.",
Understat scrive "Vanja Milinkovic-Savic", Transfermarkt "Vanja Milinković-Savić".
Tre stringhe diverse, una sola persona.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

# Particelle che fanno parte del cognome e non vanno scartate come nomi propri:
# "Di Lorenzo", "De Roon", "van Dijk" sono cognomi interi.
SURNAME_PARTICLES = {
    "de", "del", "della", "di", "da", "dal", "dos", "das", "van", "von",
    "der", "den", "el", "al", "la", "le", "lo", "mac", "mc", "st",
}


# Lettere che NFKD non sa scomporre: non sono "vocale + segno diacritico" ma
# glifi a se'. Senza questa tabella "Højlund" diventa "hjlund" e non somiglia
# piu' a "Hojlund" — una lettera persa, e il giocatore con lei.
SPECIAL_LETTERS = {
    "ø": "o", "Ø": "O",
    "đ": "d", "Đ": "D",
    "ð": "d", "Ð": "D",
    "ł": "l", "Ł": "L",
    "æ": "ae", "Æ": "AE",
    "œ": "oe", "Œ": "OE",
    "ß": "ss",
    "þ": "th", "Þ": "TH",
    "ı": "i",
}


def strip_accents(text: str) -> str:
    """"Milinković" -> "Milinkovic", "Højlund" -> "Hojlund"."""
    text = "".join(SPECIAL_LETTERS.get(c, c) for c in text)
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def normalize_text(text: str) -> str:
    """
    Forma canonica per il confronto: minuscolo, senza accenti, senza
    punteggiatura, spazi collassati.

    I trattini diventano spazi e non spariscono: "Milinkovic-Savic" e
    "Milinkovic Savic" devono collassare sulla stessa stringa, mentre
    "MilinkovicSavic" sarebbe una parola diversa da entrambe le fonti.
    """
    text = strip_accents(text).lower()
    # Tutte le varianti di apostrofo, dritto e tipografico, vanno tolte *prima*
    # del passaggio successivo e allo stesso modo. Il listone scrive "N'Dri" con
    # l'apostrofo ASCII e Understat "N’Dri" con quello tipografico: trattarne uno
    # come separatore e l'altro come niente produce "n dri" contro "ndri", che
    # sono due stringhe diverse per due grafie della stessa persona.
    text = re.sub(r"['‘’ʼ`´]", "", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


@dataclass(frozen=True)
class ListoneName:
    """
    Un nome del listone, scomposto.

    Il tracciato ufficiale usa "Cognome" oppure "Cognome I." dove l'iniziale
    disambigua gli omonimi: "Martinez Jo." (Josep) e "Martinez L." (Lautaro)
    sono due persone in due ruoli diversi nella stessa squadra. Perdere quella
    sigla significa fonderle.
    """

    raw: str
    surname: str
    """Cognome normalizzato, es. "milinkovic savic"."""
    initials: str
    """Iniziali del nome proprio, normalizzate e senza punti. "" se assenti."""


# Un token finale come "Jo.", "V.", ma anche "F.P." e "D.S.": il listone usa
# piu' iniziali puntate per chi ha due nomi propri (Esposito F.P. = Francesco
# Pio). Un pattern a punto singolo li lascerebbe attaccati al cognome, che a
# quel punto non somiglia piu' a nulla.
_INITIAL_TOKEN = re.compile(r"^(?:[A-Za-z]{1,3}\.)+$")


def parse_listone_name(raw: str) -> ListoneName:
    tokens = raw.strip().split()
    initials = ""

    # L'iniziale sta sempre in coda, e ce n'e' al massimo una.
    if len(tokens) > 1 and _INITIAL_TOKEN.match(tokens[-1]):
        initials = normalize_text(tokens[-1])
        tokens = tokens[:-1]

    return ListoneName(raw=raw, surname=normalize_text(" ".join(tokens)), initials=initials)


@dataclass(frozen=True)
class SourceName:
    """Un nome completo come lo scrivono le fonti esterne: "Lautaro Martínez"."""

    raw: str
    full: str
    """Nome intero normalizzato."""
    surname: str
    """Ultimo token piu' le eventuali particelle che lo precedono."""
    given: str
    """Quel che resta davanti al cognome."""

    @property
    def given_initials(self) -> str:
        """"Lautaro" -> "l". Confrontabile con le iniziali del listone."""
        return "".join(part[0] for part in self.given.split() if part)


def parse_source_name(raw: str) -> SourceName:
    full = normalize_text(raw)
    tokens = full.split()

    if not tokens:
        return SourceName(raw=raw, full="", surname="", given="")
    if len(tokens) == 1:
        # Molti brasiliani e portoghesi hanno un nome solo ("Vitinha").
        return SourceName(raw=raw, full=full, surname=tokens[0], given="")

    # Si risale finche' si incontrano particelle: "van dijk", "di lorenzo".
    start = len(tokens) - 1
    while start > 0 and tokens[start - 1] in SURNAME_PARTICLES:
        start -= 1

    return SourceName(
        raw=raw,
        full=full,
        surname=" ".join(tokens[start:]),
        given=" ".join(tokens[:start]),
    )


# Ogni fonte scrive i club a modo suo. La chiave e' la forma normalizzata della
# fonte, il valore e' il nome come lo scrive il listone.
TEAM_ALIASES = {
    "ac milan": "milan",
    "milan ac": "milan",
    "internazionale": "inter",
    "fc internazionale": "inter",
    "inter milan": "inter",
    "parma calcio 1913": "parma",
    "parma calcio": "parma",
    "hellas verona": "verona",
    "verona fc": "verona",
    "as roma": "roma",
    "ss lazio": "lazio",
    "ssc napoli": "napoli",
    "juventus fc": "juventus",
    "atalanta bc": "atalanta",
    "bologna fc 1909": "bologna",
    "torino fc": "torino",
    "udinese calcio": "udinese",
    "cagliari calcio": "cagliari",
    "genoa cfc": "genoa",
    "us lecce": "lecce",
    "us sassuolo": "sassuolo",
    "como 1907": "como",
    "us cremonese": "cremonese",
    "pisa sc": "pisa",
    "acf fiorentina": "fiorentina",
}


# Sigle e parole di forma societaria: non identificano il club, lo decorano.
# Toglierle e' cio' che fa collassare "AC Monza" e "Monza" senza doverli
# elencare a coppie.
CLUB_FORM_TOKENS = {
    "ac", "as", "us", "ss", "ssc", "fc", "cfc", "bc", "sc", "acf", "afc", "cd",
    "sd", "ud", "rc", "calcio", "club", "football", "futbol", "fussball",
    "sportiva", "societa", "associazione",
}


def _strip_club_form(normalized: str) -> str:
    """"bologna fc 1909" -> "bologna". Anni compresi: sono date di fondazione."""
    tokens = [
        t for t in normalized.split()
        if t not in CLUB_FORM_TOKENS and not t.isdigit()
    ]
    return " ".join(tokens) or normalized


def normalize_team(raw: str) -> str:
    """
    Forma canonica del club.

    La tabella degli alias da sola non basta, ed e' un problema che si presenta
    in silenzio: mancava "ac monza", quindi il portiere del Monza restava senza
    statistiche pur avendo su Transfermarkt un candidato con cognome, ruolo e
    squadra giusti. Nessun errore, solo un match in meno — e la tabella va
    riscritta a ogni promozione.

    Per questo la sigla societaria si toglie per struttura invece che per
    elenco. Gli alias restano per cio' che la struttura non puo' dedurre:
    "internazionale" -> "inter", "hellas verona" -> "verona".
    """
    normalized = normalize_text(raw)
    if normalized in TEAM_ALIASES:
        return TEAM_ALIASES[normalized]

    core = _strip_club_form(normalized)
    return TEAM_ALIASES.get(core, core)


def normalize_teams(raw: str) -> set[str]:
    """
    Understat indica piu' club per chi si e' trasferito a mercato aperto
    ("Napoli,Torino"). Vanno considerati tutti: il giocatore e' stato in
    entrambi, e il listone ne conosce uno solo.
    """
    return {normalize_team(part) for part in raw.split(",") if part.strip()}
