import { useFiltersStore } from '@/state/useFiltersStore';
import type { RoleFilter } from '@/domain/roles';
import { createPipeline, type Stage } from '../pipeline';

/**
 * Aggiornamento dei filtri del listone (US2-T4).
 *
 * Nota la firma degli stadi: nessun `effect`. E' il punto della US — il
 * filtraggio in tempo reale non deve mai toccare il database fisico, agisce
 * solo sullo stato in memoria. La pipeline lo rende esplicito nel codice
 * invece di lasciarlo a una convenzione.
 */

export type FilterAction =
  | { type: 'search'; query: string }
  | { type: 'role'; role: RoleFilter }
  | { type: 'clear-search' }
  | { type: 'reset' };

/** Limite di lunghezza: nessun nome di calciatore si avvicina a 60 caratteri. */
const MAX_QUERY_LENGTH = 60;

const filterStage: Stage<FilterAction> = {
  name: 'listone-filters',

  validate: (action) => {
    if (action.type === 'search' && action.query.length > MAX_QUERY_LENGTH) {
      return 'Query troppo lunga.';
    }
    return true;
  },

  reduce: (action) => {
    const store = useFiltersStore.getState();
    switch (action.type) {
      case 'search':
        store.setSearchQuery(action.query);
        break;
      case 'role':
        store.toggleRoleFilter(action.role);
        break;
      case 'clear-search':
        store.clearSearch();
        break;
      case 'reset':
        store.reset();
        break;
    }
  },
};

export const filterPipeline = createPipeline<FilterAction>([filterStage]);

export const setSearchQuery = (query: string) =>
  filterPipeline.dispatch({ type: 'search', query });

export const toggleRoleFilter = (role: RoleFilter) =>
  filterPipeline.dispatch({ type: 'role', role });

export const clearSearch = () => filterPipeline.dispatch({ type: 'clear-search' });

export const resetFilters = () => filterPipeline.dispatch({ type: 'reset' });
