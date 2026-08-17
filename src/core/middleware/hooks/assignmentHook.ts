import {
  addPlayerToCategory,
  removePlayer,
} from '@/core/repositories/watchlistRepository';
import { useCategoriesStore } from '@/state/useCategoriesStore';
import { useConfigurationsStore } from '@/state/useConfigurationsStore';
import { usePlayersStore } from '@/state/usePlayersStore';
import { useWatchlistStore } from '@/state/useWatchlistStore';
import { createPipeline, type Stage } from '../pipeline';

/**
 * Assegnazione, spostamento e rimozione dalla Watchlist
 * (US3-T3, US6-T2, sopra l'infrastruttura di US8-T4).
 *
 * Assegnare e spostare sono la stessa azione: il vincolo UNIQUE su
 * (player_id, config_id) rende l'upsert indistinguibile fra i due casi.
 *
 * Ogni assegnazione appartiene alla configurazione attiva. L'id viene fissato
 * nell'azione al momento del dispatch e non riletto dallo store in `effect`:
 * fra i due stadi passa del tempo, e una scrittura non deve mai finire in una
 * lega diversa da quella che l'utente aveva davanti quando ha toccato lo schermo.
 */

export type AssignmentAction =
  | {
      type: 'assign';
      playerId: number;
      categoryId: number;
      configId: number | null;
      at: number;
    }
  | { type: 'remove'; playerId: number; configId: number | null };

/**
 * Stadio unico: la sequenza validate -> reduce -> effect e' gia' la
 * "configurazione sequenziale fissa". Spezzarla in piu' stadi aggiungerebbe
 * indirezione senza separare responsabilita' reali.
 */
const assignmentStage: Stage<AssignmentAction> = {
  name: 'watchlist-assignment',

  // --- Validazione statica: si lavora sugli indici in RAM, zero I/O.
  validate: (action) => {
    const player = usePlayersStore.getState().byId[action.playerId];
    if (!player) return `Giocatore ${action.playerId} inesistente.`;

    // Senza una configurazione attiva non esiste una watchlist su cui scrivere.
    // In pratica non accade — il gate di primo avvio impedisce di raggiungere il
    // listone — ma il controllo tiene l'invariante vera per costruzione.
    if (action.configId === null) return 'Nessuna configurazione attiva.';

    if (action.type === 'assign') {
      const category = useCategoriesStore.getState().byId[action.categoryId];
      // Caso reale: l'utente tiene aperto il bottom sheet, elimina la categoria
      // da un'altra schermata e poi tocca il pulsante ormai stantio. Senza
      // questo controllo si andrebbe in violazione di foreign key.
      if (!category) return `Categoria ${action.categoryId} non piu' disponibile.`;
    }
    return true;
  },

  // --- Stato in memoria: sincrono, la riga si aggiorna nello stesso frame.
  reduce: (action) => {
    const store = useWatchlistStore.getState();
    if (action.type === 'assign') {
      store.assignLocal(action.playerId, action.categoryId, action.at);
    } else {
      store.removeLocal(action.playerId);
    }
  },

  // --- Persistenza: in background, la UI non la attende.
  effect: async (action) => {
    // `validate` ha gia' scartato il caso null; il narrowing qui e' solo per il
    // compilatore.
    if (action.configId === null) return;

    if (action.type === 'assign') {
      await addPlayerToCategory(
        action.playerId,
        action.configId,
        action.categoryId,
        action.at
      );
    } else {
      await removePlayer(action.playerId, action.configId);
    }
  },
};

export const assignmentPipeline = createPipeline<AssignmentAction>([assignmentStage]);

/** API applicativa. La UI chiama queste, mai i repository. */

export function assignPlayer(playerId: number, categoryId: number) {
  return assignmentPipeline.dispatch({
    type: 'assign',
    playerId,
    categoryId,
    configId: useConfigurationsStore.getState().activeId,
    at: Date.now(),
  });
}

export function unassignPlayer(playerId: number) {
  return assignmentPipeline.dispatch({
    type: 'remove',
    playerId,
    configId: useConfigurationsStore.getState().activeId,
  });
}
