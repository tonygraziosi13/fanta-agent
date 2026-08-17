import { create } from 'zustand';
import type { SyncOutcome, SyncPhase } from '@/core/sync/syncEngine';

/**
 * Stato della sincronizzazione, per la UI (US20-2).
 *
 * Esiste per una ragione precisa: il sync in background non deve *mai* bloccare
 * l'interfaccia, ma l'utente ha comunque diritto di sapere che i suoi dati sono
 * appena cambiati sotto gli occhi — o che non si aggiornano da una settimana
 * perche' la rete non risponde. Un banner discreto, non un dialogo modale.
 *
 * Non e' uno store persistito: e' lo stato di *questa* esecuzione. La verita'
 * su quale versione dei dati sia installata sta in `dataset_meta`, su disco.
 */

export type SyncStatus = 'idle' | SyncPhase | 'uptodate' | 'updated' | 'error';

interface SyncState {
  status: SyncStatus;
  /** Ultimo esito, per comporre il messaggio. */
  lastOutcome: SyncOutcome | null;
  /** true finche' l'utente non ha chiuso il banner dell'ultimo aggiornamento. */
  noticeVisible: boolean;

  setPhase: (phase: SyncPhase) => void;
  complete: (outcome: SyncOutcome) => void;
  dismissNotice: () => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  status: 'idle',
  lastOutcome: null,
  noticeVisible: false,

  setPhase: (phase) => set({ status: phase }),

  complete: (outcome) =>
    set({
      status:
        outcome.status === 'updated'
          ? 'updated'
          : outcome.status === 'uptodate'
            ? 'uptodate'
            : 'error',
      lastOutcome: outcome,
      // Il banner compare solo quando c'e' qualcosa da dire. "Sei aggiornato"
      // e' il caso normale a ogni avvio: annunciarlo sarebbe solo rumore.
      noticeVisible: outcome.status !== 'uptodate',
    }),

  dismissNotice: () => set({ noticeVisible: false }),
}));

/** Messaggio pronto per il banner, o null se non c'e' nulla da mostrare. */
export function selectSyncNotice(state: SyncState): string | null {
  if (!state.noticeVisible || state.lastOutcome === null) return null;
  const outcome = state.lastOutcome;

  if (outcome.status === 'updated') {
    return `Listone aggiornato: ${outcome.players} calciatori, ${outcome.stats} con statistiche.`;
  }
  if (outcome.status === 'failed') {
    return outcome.transient
      ? 'Aggiornamento non riuscito: nessuna connessione. I dati attuali restano disponibili.'
      : `Aggiornamento non riuscito: ${outcome.error}`;
  }
  return null;
}
