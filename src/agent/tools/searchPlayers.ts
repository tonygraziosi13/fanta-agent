import { selectFilteredPlayers } from '@/state/selectors';
import { usePlayersStore } from '@/state/usePlayersStore';
import { ROLE_FILTER_ALL, type RoleFilter } from '@/domain/roles';
import type { AgentTool } from '../types';

interface SearchPlayersInput {
  query?: string;
  role?: RoleFilter;
  limit?: number;
}

/**
 * Consultazione del listone da parte dell'agente.
 *
 * Riusa `selectFilteredPlayers`, lo stesso selettore della UI (US2): agente e
 * schermata non possono divergere sui risultati, perche' condividono il codice.
 */
export const searchPlayersTool: AgentTool<SearchPlayersInput> = {
  name: 'search_players',
  description:
    'Cerca calciatori nel listone di Serie A per nome, squadra e/o ruolo. ' +
    'Restituisce nome, squadra, ruolo, quotazione attuale e FantaValore di Mercato.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Testo su nome o squadra. Parziale ammesso.' },
      role: {
        type: 'string',
        enum: ['P', 'D', 'C', 'A', 'ALL'],
        description: 'Ruolo Classic. ALL per non filtrare.',
      },
      limit: { type: 'number', description: 'Massimo risultati (default 20).' },
    },
  },
  handler: ({ query = '', role = ROLE_FILTER_ALL, limit = 20 }) => {
    const { players } = usePlayersStore.getState();
    return selectFilteredPlayers(players, query, role)
      .slice(0, limit)
      .map((p) => ({
        id: p.id,
        nome: p.nome,
        squadra: p.squadra,
        ruolo: p.r,
        ruolo_mantra: p.rm,
        quotazione: p.qt_a,
        fvm: p.fvm,
      }));
  },
};
