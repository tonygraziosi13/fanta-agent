import { create } from 'zustand';
import { getAllPlayers } from '@/core/repositories/playersRepository';
import type { Player } from '@/domain/player';

/**
 * Listone in RAM (US1-T1).
 *
 * Il DB viene letto una volta sola, all'avvio. Ricerca e filtri (US2) lavorano
 * poi esclusivamente su questo array: nessuna query SQL viene emessa mentre
 * l'utente digita, che e' il requisito di latenza zero di US2-T4.
 */

interface PlayersState {
  players: Player[];
  /** Indice id -> Player, per le join in memoria della Watchlist (US5-T2) a costo O(1). */
  byId: Record<number, Player>;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  load: () => Promise<void>;
}

export const usePlayersStore = create<PlayersState>((set, get) => ({
  players: [],
  byId: {},
  status: 'idle',
  error: null,

  load: async () => {
    // Guardia di rientro: US1-T4 aggancia load() al mount della lista, che in
    // React 18+ StrictMode monta due volte. Senza questa riga si leggerebbe
    // il DB due volte a ogni apertura della schermata.
    if (get().status === 'loading') return;

    set({ status: 'loading', error: null });
    try {
      const all = await getAllPlayers();
      const active = all.filter((p) => p.is_active);

      const byId: Record<number, Player> = {};
      for (const p of all) byId[p.id] = p;

      set({ players: sortForDisplay(active), byId, status: 'ready' });
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
}));

/**
 * Ordine di lettura del listone: P -> D -> C -> A, poi quotazione decrescente,
 * poi alfabetico. E' l'ordine con cui un fantallenatore scorre davvero le liste.
 * Applicato una volta sola al boot, non a ogni render.
 */
const ROLE_ORDER: Record<string, number> = { P: 0, D: 1, C: 2, A: 3 };

function sortForDisplay(players: Player[]): Player[] {
  return [...players].sort((a, b) => {
    const byRole = (ROLE_ORDER[a.r] ?? 9) - (ROLE_ORDER[b.r] ?? 9);
    if (byRole !== 0) return byRole;
    if (b.qt_a !== a.qt_a) return b.qt_a - a.qt_a;
    return a.nome.localeCompare(b.nome, 'it');
  });
}
