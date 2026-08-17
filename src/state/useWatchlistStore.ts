import { create } from 'zustand';
import { getAllWatchlist } from '@/core/repositories/watchlistRepository';

/**
 * Mappa in memoria delle assegnazioni (US8-T3).
 *
 * Struttura scelta: `Record<playerId, categoryId>` invece di un array.
 * Durante lo scroll ogni riga deve sapere in O(1) se e' assegnata; su un array
 * servirebbe un `.find()` per riga a ogni frame — 497 scansioni lineari che
 * fanno collassare il framerate.
 *
 * La mappa contiene le assegnazioni di UNA configurazione per volta, quella
 * attiva: `configId` dice quale. Tenere in RAM tutte le leghe non servirebbe a
 * nessuna schermata e renderebbe ambiguo il lookup O(1) per riga.
 */

interface WatchlistState {
  assignments: Record<number, number>;
  addedAt: Record<number, number>;
  /** Configurazione a cui appartengono le assegnazioni caricate. */
  configId: number | null;
  status: 'idle' | 'loading' | 'ready';
  load: (configId: number | null) => Promise<void>;

  /** Mutazioni sincrone invocate dallo stadio `reduce` della pipeline. */
  assignLocal: (playerId: number, categoryId: number, addedAt?: number) => void;
  removeLocal: (playerId: number) => void;
  /** Usata dopo l'eliminazione di una categoria (CASCADE lato DB). */
  removeCategoryLocal: (categoryId: number) => void;
}

export const useWatchlistStore = create<WatchlistState>((set, get) => ({
  assignments: {},
  addedAt: {},
  configId: null,
  status: 'idle',

  load: async (configId) => {
    if (get().status === 'loading' && get().configId === configId) return;
    set({ status: 'loading', configId });

    // Nessuna configurazione attiva (primo avvio, o l'ultima e' stata
    // eliminata): la watchlist esiste ma non ha nulla da mostrare.
    if (configId === null) {
      set({ assignments: {}, addedAt: {}, status: 'ready' });
      return;
    }

    const entries = await getAllWatchlist(configId);

    // L'utente puo' aver cambiato configurazione mentre la lettura era in volo:
    // scartare il risultato stantio evita di mostrare la watchlist sbagliata.
    if (get().configId !== configId) return;

    const assignments: Record<number, number> = {};
    const addedAt: Record<number, number> = {};
    for (const e of entries) {
      assignments[e.player_id] = e.category_id;
      addedAt[e.player_id] = e.added_at;
    }

    set({ assignments, addedAt, status: 'ready' });
  },

  // Ogni mutazione crea un nuovo oggetto: Zustand confronta per riferimento e
  // una mutazione in place non farebbe scattare alcun re-render.
  assignLocal: (playerId, categoryId, addedAt = Date.now()) =>
    set((state) => ({
      assignments: { ...state.assignments, [playerId]: categoryId },
      addedAt: { ...state.addedAt, [playerId]: addedAt },
    })),

  removeLocal: (playerId) =>
    set((state) => {
      const assignments = { ...state.assignments };
      const addedAt = { ...state.addedAt };
      delete assignments[playerId];
      delete addedAt[playerId];
      return { assignments, addedAt };
    }),

  removeCategoryLocal: (categoryId) =>
    set((state) => {
      const assignments: Record<number, number> = {};
      const addedAt: Record<number, number> = {};
      for (const [pid, cid] of Object.entries(state.assignments)) {
        if (cid === categoryId) continue;
        const key = Number(pid);
        assignments[key] = cid;
        const ts = state.addedAt[key];
        if (ts !== undefined) addedAt[key] = ts;
      }
      return { assignments, addedAt };
    }),
}));

/**
 * Selettore per singola riga (US4-T2).
 *
 * Ogni PlayerRow si sottoscrive SOLO alla propria chiave: assegnando un
 * giocatore, Zustand confronta il valore restituito riga per riga e ne
 * ri-renderizza una sola. Le altre 496 non vengono toccate.
 */
export function useAssignedCategoryId(playerId: number): number | undefined {
  return useWatchlistStore((state) => state.assignments[playerId]);
}
