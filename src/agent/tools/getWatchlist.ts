import { selectGroupedWatchlist } from '@/state/selectors';
import { useCategoriesStore } from '@/state/useCategoriesStore';
import { usePlayersStore } from '@/state/usePlayersStore';
import { useWatchlistStore } from '@/state/useWatchlistStore';
import type { AgentTool } from '../types';

/**
 * Espone all'agente la strategia gia' costruita dall'utente.
 * E' il tool che rende i consigli contestuali invece che generici:
 * senza, l'agente non sa quali giocatori sono gia' stati messi da parte.
 */
export const getWatchlistTool: AgentTool<Record<string, never>> = {
  name: 'get_watchlist',
  description:
    'Restituisce la watchlist del fantallenatore raggruppata per categoria, ' +
    'con il conteggio dei giocatori in ciascuna.',
  input_schema: { type: 'object', properties: {} },
  handler: () => {
    const { byId } = usePlayersStore.getState();
    const { assignments, addedAt } = useWatchlistStore.getState();
    const { categories } = useCategoriesStore.getState();

    return selectGroupedWatchlist(byId, assignments, addedAt, categories).map((group) => ({
      categoria: group.category.name,
      totale: group.count,
      giocatori: group.players.map((p) => ({
        id: p.id,
        nome: p.nome,
        squadra: p.squadra,
        ruolo: p.r,
        quotazione: p.qt_a,
      })),
    }));
  },
};
