import type { Opponent } from '@/domain/opponent';
import type { Player } from '@/domain/player';
import type { ClassicRole } from '@/domain/roles';
import type { CategoryGroup } from './selectors';

/**
 * Selettori dell'asta: puri, senza React e senza SQLite.
 *
 * --- "Svincolato" e' un dato derivato, non una colonna ---
 * Nel modello non esiste un flag: `is_active = false` significa "uscito dalla
 * Serie A", che e' un'altra cosa. Un giocatore e' libero quando **non compare
 * nella rosa di nessun partecipante**, e quel fatto vive gia' in `opponents`.
 *
 * Aggiungere una colonna `svincolato` significherebbe tenerla allineata a ogni
 * transazione: due fonti per la stessa verita', e la seconda che si scopre
 * sbagliata a meta' asta.
 */

/**
 * Gli id gia' assegnati a qualcuno.
 *
 * Un `Set` costruito una volta, e non un `some()` dentro il filtro: senza
 * indice sarebbe O(giocatori x avversari) — cinquecento per nove a ogni
 * ridisegno, cioe' su ogni tasto premuto durante un'asta.
 */
export function presiDaQualcuno(opponents: ReadonlyArray<Opponent>): Set<number> {
  const presi = new Set<number>();
  for (const opponent of opponents) {
    for (const pick of opponent.rosa) {
      presi.add(pick.playerId);
    }
  }
  return presi;
}

/** Chi e' ancora acquistabile: in Serie A e non ancora di nessuno. */
export function selectSvincolati(
  players: ReadonlyArray<Player>,
  opponents: ReadonlyArray<Opponent>
): Player[] {
  const presi = presiDaQualcuno(opponents);
  // `is_active` esclude chi ha lasciato il campionato: non e' "libero", non e'
  // proprio acquistabile, ed e' una distinzione che il nome "svincolato" da solo
  // non fa.
  return players.filter((p) => p.is_active && !presi.has(p.id));
}

export function selectSvincolatiPerRuolo(
  players: ReadonlyArray<Player>,
  opponents: ReadonlyArray<Opponent>,
  ruolo: ClassicRole
): Player[] {
  return selectSvincolati(players, opponents).filter((p) => p.r === ruolo);
}

/** Chi ha comprato quel giocatore, se qualcuno l'ha fatto. */
export function proprietarioDi(
  playerId: number,
  opponents: ReadonlyArray<Opponent>
): Opponent | undefined {
  return opponents.find((o) => o.rosa.some((pick) => pick.playerId === playerId));
}

/**
 * Il budget medio per slot ancora da riempire.
 *
 * E' la cifra che dice se un'offerta e' sostenibile: 300 crediti con 20 slot
 * vuoti sono 15 a testa, e puntarne 80 su un solo giocatore significa
 * accettarne altri diciannove da otto. Serve alla Quick Action C, e vive qui
 * perche' e' aritmetica di dominio e non presentazione.
 */
export function budgetMedioPerSlot(opponent: Opponent): number | null {
  const slot =
    opponent.slotLiberi.P + opponent.slotLiberi.D + opponent.slotLiberi.C + opponent.slotLiberi.A;
  if (slot <= 0) return null;
  return opponent.creditiResidui / slot;
}

/**
 * Toglie dalla watchlist chi e' gia' stato aggiudicato.
 *
 * --- Perche' serve ---
 * Durante un'asta la watchlist si scorre per decidere il prossimo obiettivo. Un
 * nome gia' venduto a qualcun altro e' rumore nel percorso piu' caldo: costa
 * un'occhiata e mezza decisione, e in asta si pagano entrambe.
 *
 * --- Nasconde, non cancella ---
 * L'assegnazione resta in SQLite. Cancellarla butterebbe via la categoria che
 * l'utente ha scelto — e siccome un'aggiudicazione si puo' annullare, quel
 * giocatore potrebbe tornare disponibile un minuto dopo, senza piu' sapere dove
 * l'avevi messo.
 *
 * Restituisce anche gli esclusi: la schermata deve poter dire *quanti* sono
 * spariti, o la watchlist sembrerebbe assottigliarsi da sola.
 */
export function partizionaAggiudicati(
  groups: ReadonlyArray<CategoryGroup>,
  presi: ReadonlySet<number>
): { visibili: CategoryGroup[]; aggiudicati: Player[] } {
  // Nessuno preso: si restituiscono i gruppi originali senza ricostruirli, cosi'
  // i riferimenti restano stabili e `memo` sulle righe non si sveglia per niente.
  if (presi.size === 0) {
    return { visibili: [...groups], aggiudicati: [] };
  }

  const aggiudicati: Player[] = [];
  const visibili = groups.map((group) => {
    const liberi: Player[] = [];
    for (const player of group.players) {
      if (presi.has(player.id)) aggiudicati.push(player);
      else liberi.push(player);
    }
    // `count` segue i visibili: la pastiglia accanto al nome della categoria
    // deve contare quel che si vede, o il numero e le righe si smentiscono.
    return { category: group.category, players: liberi, count: liberi.length };
  });

  return { visibili, aggiudicati };
}
