import { create } from 'zustand';
import { parseStatoAsta } from '@/core/parsing/statoAstaParser';
import {
  listOpponents,
  mergeOpponents,
  replaceOpponents,
  type MergeEsito,
} from '@/core/repositories/opponentsRepository';
import type { Opponent } from '@/domain/opponent';
import type { ClassicRole } from '@/domain/roles';

/**
 * Gli avversari dell'asta attiva, in memoria.
 *
 * --- Perche' in RAM, a differenza delle metriche ---
 * `usePlayerStatsStore` legge una riga per volta perche' i giocatori sono
 * cinquecento e se ne aprono trenta. Qui sono nove, si guardano tutti insieme e
 * si rileggono a ogni singola decisione d'asta: tenerli in memoria costa nulla
 * ed evita una query su ogni domanda posta all'agente.
 *
 * --- `configId` come in `useWatchlistStore` ---
 * In RAM vive una lega sola, quella attiva, e `configId` dice quale. `load()`
 * scarta le letture stantie: se l'utente cambia configurazione mentre una query
 * e' in volo, la risposta che torna riguarda l'asta sbagliata.
 */

interface OpponentsState {
  configId: number | null;
  items: Opponent[];
  loading: boolean;
  error: string | null;

  load: (configId: number) => Promise<void>;
  /** Registra un acquisto in memoria. Sincrono: lo chiama `reduce`. */
  applyPickLocal: (opponentId: number, playerId: number, costo: number, ruolo: ClassicRole) => void;
  /** Annulla un acquisto: restituisce crediti e slot. */
  undoPickLocal: (opponentId: number, playerId: number, ruolo: ClassicRole) => void;
  /** Importa il seme `stato_asta.json`. **Sostituisce** i partecipanti esistenti. */
  importSeed: (
    raw: string,
    configId: number
  ) => Promise<{ ok: boolean; imported: number; skipped: number; error?: string }>;
  /**
   * Aggiunge le squadre mancanti e riallinea quelle rinominate: sicuro anche ad
   * asta iniziata, perche' non cancella mai una riga con una rosa dentro.
   */
  mergeSeed: (
    raw: string,
    configId: number
  ) => Promise<{ ok: boolean; esito: MergeEsito; error?: string }>;
  clear: () => void;
}

export const useOpponentsStore = create<OpponentsState>((set, get) => ({
  configId: null,
  items: [],
  loading: false,
  error: null,

  load: async (configId) => {
    set({ loading: true, configId });
    try {
      const items = await listOpponents(configId);
      // Se nel frattempo e' cambiata la configurazione attiva, questi dati
      // riguardano un'altra asta: si scartano invece di mostrarli.
      if (get().configId !== configId) return;
      set({ items, loading: false, error: null });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  applyPickLocal: (opponentId, playerId, costo, ruolo) => {
    set((state) => ({
      items: state.items.map((o) =>
        o.id !== opponentId
          ? o
          : {
              ...o,
              creditiResidui: o.creditiResidui - costo,
              slotLiberi: { ...o.slotLiberi, [ruolo]: o.slotLiberi[ruolo] - 1 },
              rosa: [...o.rosa, { playerId, prezzo: costo }],
            }
      ),
    }));
  },

  undoPickLocal: (opponentId, playerId, ruolo) => {
    set((state) => ({
      items: state.items.map((o) => {
        if (o.id !== opponentId) return o;
        const pick = o.rosa.find((r) => r.playerId === playerId);
        if (!pick) return o;
        return {
          ...o,
          // Si restituisce il prezzo **registrato**, non quello passato da chi
          // annulla: e' l'unico numero che sappiamo essere stato scalato
          // davvero, e usarne un altro lascerebbe i crediti sfasati per sempre.
          creditiResidui: o.creditiResidui + (pick.prezzo ?? 0),
          slotLiberi: { ...o.slotLiberi, [ruolo]: o.slotLiberi[ruolo] + 1 },
          rosa: o.rosa.filter((r) => r.playerId !== playerId),
        };
      }),
    }));
  },

  importSeed: async (raw, configId) => {
    const outcome = parseStatoAsta(raw);
    if (!outcome.ok) {
      set({ error: outcome.error });
      return { ok: false, imported: 0, skipped: 0, error: outcome.error };
    }

    const { teams, skipped } = outcome.value;
    try {
      await replaceOpponents(configId, teams);
      await get().load(configId);
      return { ok: true, imported: teams.length, skipped: skipped.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: message });
      return { ok: false, imported: 0, skipped: skipped.length, error: message };
    }
  },

  mergeSeed: async (raw, configId) => {
    const vuoto: MergeEsito = { aggiunte: [], rinominate: [] };
    const outcome = parseStatoAsta(raw);
    if (!outcome.ok) {
      set({ error: outcome.error });
      return { ok: false, esito: vuoto, error: outcome.error };
    }

    try {
      const esito = await mergeOpponents(configId, outcome.value.teams);
      // Si ricarica solo se qualcosa e' cambiato: rileggere nove righe per
      // scoprire che sono le stesse farebbe ridisegnare la schermata per niente.
      if (esito.aggiunte.length > 0 || esito.rinominate.length > 0) await get().load(configId);
      return { ok: true, esito };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: message });
      return { ok: false, esito: vuoto, error: message };
    }
  },

  clear: () => set({ configId: null, items: [], error: null }),
}));

/** La squadra dell'utente, se l'import l'ha marcata. */
export function useMyTeam(): Opponent | undefined {
  return useOpponentsStore((s) => s.items.find((o) => o.isMe));
}

export function useOpponents(): Opponent[] {
  return useOpponentsStore((s) => s.items);
}
