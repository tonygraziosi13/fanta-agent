import { create } from 'zustand';
import { getStatsByPlayerId } from '@/core/repositories/playerStatsRepository';
import type { PlayerStats } from '@/domain/playerStats';

/**
 * Metriche in memoria, caricate su richiesta (US21-T2).
 *
 * --- Perche' NON si idrata al boot come il listone ---
 * `usePlayersStore` tiene 497 giocatori in RAM perche' lo scroll li attraversa
 * tutti, e una query SQL per riga distruggerebbe il framerate (US2-T4). Qui vale
 * l'opposto: la schermata di dettaglio mostra un giocatore alla volta, e in una
 * sessione d'asta se ne aprono forse trenta. Caricare in anticipo cinquecento
 * righe di metriche — storico infortuni compreso — costerebbe memoria
 * e tempo di avvio per dati che nessuno guardera'.
 *
 * L'invariante "filtri e ricerca non toccano il database" resta intatta: questa
 * lettura avviene su tap esplicito, fuori dal percorso caldo dello scroll.
 *
 * --- La cache ---
 * `byId` conserva quel che e' gia' stato letto: riaprire lo stesso giocatore
 * (tipico quando si confrontano due nomi avanti e indietro) non ripete la query.
 * `missing` ricorda anche le risposte vuote, altrimenti un giocatore senza
 * metriche verrebbe riletto a ogni apertura, per sempre.
 */

interface PlayerStatsState {
  byId: Record<number, PlayerStats>;
  /** Id per cui il DB ha risposto "nessuna riga": e' un risultato, non un errore. */
  missing: Record<number, true>;
  loading: Record<number, true>;
  error: string | null;

  load: (playerId: number) => Promise<void>;
  /** Invalidazione dopo un sync: le metriche in cache sono di una versione vecchia. */
  clear: () => void;
}

export const usePlayerStatsStore = create<PlayerStatsState>((set, get) => ({
  byId: {},
  missing: {},
  loading: {},
  error: null,

  load: async (playerId) => {
    const state = get();
    // Gia' noto (presente o accertato assente) o gia' in volo: non si ripete.
    if (state.byId[playerId] || state.missing[playerId] || state.loading[playerId]) return;

    set((s) => ({ loading: { ...s.loading, [playerId]: true }, error: null }));

    try {
      const stats = await getStatsByPlayerId(playerId);
      set((s) => {
        const loading = { ...s.loading };
        delete loading[playerId];
        return stats === null
          ? { loading, missing: { ...s.missing, [playerId]: true as const } }
          : { loading, byId: { ...s.byId, [playerId]: stats } };
      });
    } catch (error) {
      set((s) => {
        const loading = { ...s.loading };
        delete loading[playerId];
        return {
          loading,
          error: error instanceof Error ? error.message : String(error),
        };
      });
    }
  },

  clear: () => set({ byId: {}, missing: {}, loading: {}, error: null }),
}));

/** Sottoscrizione per singolo giocatore, sullo stesso principio di `useAssignedCategoryId`. */
export function usePlayerStats(playerId: number): PlayerStats | undefined {
  return usePlayerStatsStore((s) => s.byId[playerId]);
}

export function usePlayerStatsStatus(playerId: number): 'loading' | 'missing' | 'ready' {
  return usePlayerStatsStore((s) => {
    if (s.loading[playerId]) return 'loading';
    if (s.byId[playerId]) return 'ready';
    if (s.missing[playerId]) return 'missing';
    return 'loading';
  });
}
