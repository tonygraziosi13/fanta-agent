import { create } from 'zustand';
import { ROLE_FILTER_ALL, type RoleFilter } from '@/domain/roles';

/**
 * Filtri del listone (US2-T1).
 *
 * Store separato da usePlayersStore di proposito: digitare una lettera cambia
 * `searchQuery` senza notificare nessun sottoscrittore di `players`. Con un
 * unico store, ogni tasto premuto sveglierebbe anche chi osserva il listone.
 */

interface FiltersState {
  searchQuery: string;
  activeRoleFilter: RoleFilter;
  setSearchQuery: (value: string) => void;
  /** US2: i filtri ruolo sono toggle — ripremere il ruolo attivo torna a "Tutti". */
  toggleRoleFilter: (role: RoleFilter) => void;
  clearSearch: () => void;
  reset: () => void;
}

export const useFiltersStore = create<FiltersState>((set, get) => ({
  searchQuery: '',
  activeRoleFilter: ROLE_FILTER_ALL,

  setSearchQuery: (value) => set({ searchQuery: value }),

  toggleRoleFilter: (role) =>
    set({
      activeRoleFilter: get().activeRoleFilter === role ? ROLE_FILTER_ALL : role,
    }),

  clearSearch: () => set({ searchQuery: '' }),

  reset: () => set({ searchQuery: '', activeRoleFilter: ROLE_FILTER_ALL }),
}));
