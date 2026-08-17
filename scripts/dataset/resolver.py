"""
Risoluzione delle entita' (US19-T2): agganciare un giocatore di una fonte
esterna al suo `id` nel listone ufficiale.

--- Perche' non basta confrontare i nomi ---
Il listone scrive "Martinez Jo." (Josep, portiere dell'Inter) e "Martinez L."
(Lautaro, attaccante dell'Inter). Una similarita' testuale ingenua li fonde:
stesso cognome, stessa squadra. Il risultato sarebbe un portiere con 17 gol.

--- Perche' la squadra non puo' essere un filtro rigido ---
Le metriche vengono dalla stagione conclusa, il listone descrive quella che deve
iniziare. Chi ha cambiato club nel mezzo comparirebbe con due squadre diverse e
un filtro rigido lo scarterebbe proprio nel caso in cui l'informazione serve di
piu'. La squadra vale quindi come *conferma*, non come vincolo.

--- Il vincolo che invece e' rigido ---
Portiere contro giocatore di movimento. Nessun trasferimento trasforma un
portiere in un attaccante, e il caso Martinez dimostra che senza questo vincolo
si sbaglia davvero.

--- La struttura ---
Strategie in cascata (Chain of Responsibility), dalla piu' sicura alla piu'
tollerante: vince la prima che risolve, e ognuna dichiara la propria confidenza
perche' il report finisca per mano all'utente e non in un log muto.
"""

from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Callable, Optional, Sequence

from .model import RosterEntry
from .normalize import (
    ListoneName,
    SourceName,
    parse_listone_name,
    parse_source_name,
)

# Sotto questa similarita' sul cognome due nomi sono persone diverse. Calibrata
# per assorbire le traslitterazioni ("Milinkovic" / "Milinkovich") senza
# avvicinare cognomi corti e distinti, dove ogni lettera pesa molto.
FUZZY_THRESHOLD = 0.86


@dataclass(frozen=True)
class Candidate:
    """Un giocatore come lo vede una fonte esterna."""

    key: str
    """Identificatore nella fonte (id Understat, id Transfermarkt, ...)."""
    name: SourceName
    teams: frozenset[str]
    role: Optional[str] = None
    """Ruolo Classic (P/D/C/A) se la fonte lo espone, altrimenti None."""


@dataclass(frozen=True)
class Match:
    candidate: Candidate
    confidence: float
    strategy: str


def make_candidate(
    key: str, raw_name: str, teams: set[str], role: Optional[str] = None
) -> Candidate:
    return Candidate(
        key=str(key),
        name=parse_source_name(raw_name),
        teams=frozenset(teams),
        role=role,
    )


def _roles_compatible(entry_role: str, candidate_role: Optional[str]) -> bool:
    """Un portiere non e' mai un giocatore di movimento, e viceversa."""
    if candidate_role is None:
        return True
    if entry_role == "P" or candidate_role == "P":
        return entry_role == candidate_role
    # Fra D, C e A si transita davvero: il listone e le fonti estere classificano
    # a modo loro un esterno o un trequartista. Distinguerli sarebbe arbitrario.
    return True


def _initials_agree(parsed: ListoneName, candidate: Candidate) -> Optional[bool]:
    """
    None = il listone non fornisce iniziali, quindi non c'e' nulla da confrontare.
    Il confronto e' per prefisso: il listone scrive "Jo." dove il nome e' "Josep".
    """
    if not parsed.initials:
        return None
    given = candidate.name.given
    if not given:
        return None
    first_word = given.split()[0]
    return first_word.startswith(parsed.initials) or parsed.initials.startswith(
        candidate.name.given_initials
    )


def _team_agrees(entry: RosterEntry, candidate: Candidate, entry_team: str) -> bool:
    return entry_team in candidate.teams


def _tail(full: str, token_count: int) -> str:
    """Gli ultimi `token_count` token di un nome completo."""
    tokens = full.split()
    return " ".join(tokens[-token_count:]) if tokens else ""


def _comparable_forms(parsed: ListoneName, candidate: Candidate) -> list[str]:
    """
    Le forme della fonte confrontabili con un cognome del listone.

    La terza e' la meno ovvia e la piu' necessaria. Il listone scrive
    "Milinkovic-Savic V.", cioe' un cognome di due parole una volta sciolto il
    trattino; la fonte scrive "Vanja Milinkovic-Savic", il cui "ultimo token" e'
    solo "savic". Confrontare un cognome doppio con un cognome singolo perde il
    match. Si confronta allora la coda del nome completo, presa della stessa
    lunghezza del cognome cercato: like con like.
    """
    return [
        candidate.name.surname,
        candidate.name.full,
        _tail(candidate.name.full, len(parsed.surname.split())),
    ]


def _surname_similarity(parsed: ListoneName, candidate: Candidate) -> float:
    return max(
        SequenceMatcher(None, parsed.surname, form).ratio()
        for form in _comparable_forms(parsed, candidate)
    )


# --- Le strategie ------------------------------------------------------------
# Firma comune: (entry, parsed, entry_team, candidati_ammissibili) -> Match | None

Strategy = Callable[
    [RosterEntry, ListoneName, str, Sequence[Candidate]], Optional[Match]
]


def _exact_matches(parsed: ListoneName, pool: Sequence[Candidate]) -> list[Candidate]:
    return [c for c in pool if parsed.surname in _comparable_forms(parsed, c)]


def _exact_surname_unique(
    entry: RosterEntry, parsed: ListoneName, entry_team: str, pool: Sequence[Candidate]
) -> Optional[Match]:
    """Cognome identico e un solo candidato: nessuna ambiguita' da sciogliere."""
    exact = _exact_matches(parsed, pool)
    if len(exact) == 1:
        return Match(exact[0], confidence=1.0, strategy="cognome-esatto-unico")
    return None


def _exact_surname_with_initials(
    entry: RosterEntry, parsed: ListoneName, entry_team: str, pool: Sequence[Candidate]
) -> Optional[Match]:
    """Piu' omonimi: decide l'iniziale del nome proprio. E' il caso Martinez."""
    exact = _exact_matches(parsed, pool)
    if len(exact) < 2:
        return None

    by_initials = [c for c in exact if _initials_agree(parsed, c) is True]
    if len(by_initials) == 1:
        return Match(by_initials[0], confidence=0.95, strategy="cognome+iniziale")

    # Iniziali assenti o ancora ambigue: prova la squadra.
    narrowed = by_initials or exact
    by_team = [c for c in narrowed if _team_agrees(entry, c, entry_team)]
    if len(by_team) == 1:
        return Match(by_team[0], confidence=0.9, strategy="cognome+squadra")

    # Ambiguita' irrisolvibile: meglio nessun dato che il dato di un'altra
    # persona. Finisce nel report e si risolve con `manual_map.json`.
    return None


def _token_containment(
    entry: RosterEntry, parsed: ListoneName, entry_team: str, pool: Sequence[Candidate]
) -> Optional[Match]:
    """
    Un nome contiene l'altro, in una delle due direzioni.

    Direzione 1 — la fonte scrive piu' del listone: "Pierre Kalulu Kyatengwa"
    contro "Kalulu". L'ultimo token della fonte non e' il cognome che conosciamo,
    quindi ogni confronto per coda fallisce; ma "kalulu" e' li' in mezzo.

    Direzione 2 — la fonte scrive meno: "Romano Floriani" contro
    "Floriani Mussolini". Il doppio cognome e' stato troncato all'origine.

    Entrambe sono ammesse solo se il candidato e' *unico*: un contenimento di
    token e' un indizio debole, e su un cognome comune pescherebbe la persona
    sbagliata con la stessa disinvoltura di quella giusta.
    """
    wanted = set(parsed.surname.split())
    if not wanted:
        return None

    hits: list[Candidate] = []
    for candidate in pool:
        tokens = set(candidate.name.full.split())
        surname_tokens = set(candidate.name.surname.split())
        forward = wanted <= tokens
        backward = bool(surname_tokens) and surname_tokens <= wanted
        if forward or backward:
            hits.append(candidate)

    if len(hits) != 1:
        return None

    winner = hits[0]
    if _initials_agree(parsed, winner) is False:
        return None

    # La squadra non e' obbligatoria (i prestiti esistono) ma cambia quanto ci
    # si puo' fidare, e la confidenza finisce nel report.
    confident = _team_agrees(entry, winner, entry_team)
    return Match(
        winner,
        confidence=0.85 if confident else 0.7,
        strategy="contenimento-token" + ("" if confident else "-senza-squadra"),
    )


def _fuzzy_surname(
    entry: RosterEntry, parsed: ListoneName, entry_team: str, pool: Sequence[Candidate]
) -> Optional[Match]:
    """
    Ultima spiaggia: similarita' sul cognome, con la squadra come conferma.
    La soglia e' alta e il punteggio finale tiene conto della squadra, cosi' fra
    due quasi-omonimi vince quello che gioca dove dice il listone.
    """
    scored: list[tuple[float, Candidate]] = []
    for c in pool:
        similarity = _surname_similarity(parsed, c)
        if similarity < FUZZY_THRESHOLD:
            continue
        if _initials_agree(parsed, c) is False:
            continue
        score = similarity + (0.1 if _team_agrees(entry, c, entry_team) else 0.0)
        scored.append((score, c))

    if not scored:
        return None

    scored.sort(key=lambda pair: pair[0], reverse=True)
    best_score, best = scored[0]

    # Due candidati a pari merito: non si sceglie a caso.
    if len(scored) > 1 and abs(scored[1][0] - best_score) < 0.02:
        return None

    return Match(best, confidence=min(best_score, 0.99) * 0.85, strategy="fuzzy")


STRATEGIES: tuple[Strategy, ...] = (
    _exact_surname_unique,
    _exact_surname_with_initials,
    _token_containment,
    _fuzzy_surname,
)


class EntityResolver:
    """
    Risolve i giocatori di *una* fonte contro il listone.

    Un'istanza per fonte: gli indici interni sono costruiti sui candidati di
    quella fonte, e la mappa manuale e' scoped per fonte.
    """

    def __init__(
        self,
        source: str,
        candidates: Sequence[Candidate],
        manual_map: Optional[dict[str, dict[str, str]]] = None,
    ) -> None:
        self.source = source
        self.candidates = list(candidates)
        self._by_key = {c.key: c for c in self.candidates}
        # manual_map: { "understat": { "<id listone>": "<chiave fonte>" } }
        self._manual = (manual_map or {}).get(source, {})
        self.unresolved: list[RosterEntry] = []
        self.matched: dict[int, Match] = {}

    def resolve(self, entry: RosterEntry, entry_team: str) -> Optional[Match]:
        # --- Override manuale: la parola dell'utente batte ogni euristica.
        forced = self._manual.get(str(entry.id))
        if forced is not None:
            candidate = self._by_key.get(str(forced))
            if candidate is not None:
                return Match(candidate, confidence=1.0, strategy="mappa-manuale")

        parsed = parse_listone_name(entry.name)
        pool = [c for c in self.candidates if _roles_compatible(entry.role, c.role)]

        for strategy in STRATEGIES:
            match = strategy(entry, parsed, entry_team, pool)
            if match is not None:
                return match
        return None

    # Quante volte si ritenta dopo aver perso un candidato conteso.
    MAX_ROUNDS = 4

    def resolve_all(self, entries: Sequence[RosterEntry]) -> dict[int, Match]:
        """
        Risolve l'intero listone gestendo i candidati contesi.

        Due giocatori del listone non possono essere la stessa persona, quindi un
        candidato va assegnato a uno solo. La versione ingenua — chi arriva prima
        se lo prende — sbaglia sistematicamente: se il primo "Colombo" del
        listone e' una riserva mai scesa in campo e il secondo e' il titolare,
        l'ordine alfabetico decide al posto dei dati, e il titolare resta senza
        statistiche.

        Qui invece si assegna per confidenza: a ogni giro tutti propongono, chi
        offre la confidenza piu' alta si aggiudica il candidato, e i perdenti
        riprovano al giro dopo con quel candidato escluso — dove spesso trovano
        il proprio, che il conteso stava mascherando.
        """
        from .normalize import normalize_team

        pending = list(entries)
        taken: set[str] = set()
        all_candidates = self.candidates

        for _ in range(self.MAX_ROUNDS):
            if not pending:
                break

            self.candidates = [c for c in all_candidates if c.key not in taken]
            proposals: dict[str, list[tuple[RosterEntry, Match]]] = {}
            failed: list[RosterEntry] = []

            for entry in pending:
                match = self.resolve(entry, normalize_team(entry.team))
                if match is None:
                    failed.append(entry)
                else:
                    proposals.setdefault(match.candidate.key, []).append((entry, match))

            contested: list[RosterEntry] = []
            for key, claims in proposals.items():
                # A parita' di confidenza decide la squadra: due omonimi con lo
                # stesso punteggio sono distinguibili solo da dove giocano, e
                # lasciar decidere l'ordine del CSV significa assegnare a caso.
                claims.sort(
                    key=lambda pair: (
                        pair[1].confidence,
                        normalize_team(pair[0].team) in pair[1].candidate.teams,
                    ),
                    reverse=True,
                )
                winner_entry, winner_match = claims[0]
                self.matched[winner_entry.id] = winner_match
                taken.add(key)
                contested.extend(entry for entry, _ in claims[1:])

            # Chi non ha trovato nulla e' fuori: un altro giro con *meno*
            # candidati non puo' aiutarlo. Riprovano solo i contesi.
            self.unresolved.extend(failed)
            pending = contested

        self.unresolved.extend(pending)
        self.candidates = all_candidates
        return self.matched
