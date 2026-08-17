import { create } from 'zustand';
import { getAllConfigurations } from '@/core/repositories/configurationsRepository';
import type { Configuration } from '@/domain/configuration';

/**
 * Configurazioni d'asta in memoria.
 *
 * `activeId` e' derivato dal flag `is_active` delle righe, non memorizzato a
 * parte: una sola fonte di verita' evita che lista e selezione divergano dopo
 * un'eliminazione o un cambio di configurazione attiva.
 */

interface ConfigurationsState {
  configurations: Configuration[];
  byId: Record<number, Configuration>;
  activeId: number | null;
  status: 'idle' | 'loading' | 'ready';
  load: () => Promise<void>;
  setLocal: (configurations: Configuration[]) => void;
}

function indexById(configurations: Configuration[]): Record<number, Configuration> {
  const byId: Record<number, Configuration> = {};
  for (const c of configurations) byId[c.id] = c;
  return byId;
}

function activeIdOf(configurations: Configuration[]): number | null {
  return configurations.find((c) => c.isActive)?.id ?? null;
}

export const useConfigurationsStore = create<ConfigurationsState>((set, get) => ({
  configurations: [],
  byId: {},
  activeId: null,
  status: 'idle',

  load: async () => {
    if (get().status === 'loading') return;
    set({ status: 'loading' });
    const configurations = await getAllConfigurations();
    set({
      configurations,
      byId: indexById(configurations),
      activeId: activeIdOf(configurations),
      status: 'ready',
    });
  },

  setLocal: (configurations) =>
    set({
      configurations,
      byId: indexById(configurations),
      activeId: activeIdOf(configurations),
    }),
}));

/** La configurazione su cui l'utente sta lavorando, o `undefined` se non esiste. */
export function useActiveConfiguration(): Configuration | undefined {
  return useConfigurationsStore((state) =>
    state.activeId === null ? undefined : state.byId[state.activeId]
  );
}

/**
 * Sottoscrizione a un solo booleano: il gate di primo avvio in `_layout` si
 * ri-renderizza quando si passa da "nessuna configurazione" a "almeno una",
 * non a ogni modifica dei crediti.
 */
export function useHasConfigurations(): boolean {
  return useConfigurationsStore((state) => state.configurations.length > 0);
}
