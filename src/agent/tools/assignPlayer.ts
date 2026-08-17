import { assignPlayer, unassignPlayer } from '@/core/middleware/hooks/assignmentHook';
import { useCategoriesStore } from '@/state/useCategoriesStore';
import type { AgentTool } from '../types';

interface AssignPlayerInput {
  player_id: number;
  /** Nome categoria; omesso o vuoto = rimozione dalla watchlist. */
  category_name?: string;
}

/**
 * Unico tool mutante dello Sprint 1.
 *
 * Punto architetturale centrale: NON parla con i repository. Passa dalla stessa
 * `assignmentPipeline` che usa il bottone della UI, quindi eredita gratuitamente
 * validazione, aggiornamento reattivo della lista e persistenza in background.
 * Un'azione dell'agente e un tap dell'utente sono letteralmente la stessa
 * operazione, e restano tali per costruzione.
 */
export const assignPlayerTool: AgentTool<AssignPlayerInput> = {
  name: 'assign_player_to_category',
  description:
    'Assegna un calciatore a una categoria della watchlist, oppure lo rimuove ' +
    'se category_name viene omesso. Sposta il giocatore se era già assegnato altrove.',
  mutating: true,
  input_schema: {
    type: 'object',
    properties: {
      player_id: { type: 'number', description: 'Id del calciatore nel listone.' },
      category_name: {
        type: 'string',
        description: 'Nome esatto della categoria. Omettere per rimuovere.',
      },
    },
    required: ['player_id'],
  },
  handler: ({ player_id, category_name }) => {
    if (!category_name) {
      const result = unassignPlayer(player_id);
      return { ok: result.ok, error: result.reason };
    }

    const category = useCategoriesStore
      .getState()
      .categories.find((c) => c.name.toLowerCase() === category_name.trim().toLowerCase());

    if (!category) {
      const available = useCategoriesStore
        .getState()
        .categories.map((c) => c.name)
        .join(', ');
      return { ok: false, error: `Categoria "${category_name}" inesistente. Disponibili: ${available}` };
    }

    const result = assignPlayer(player_id, category.id);
    return { ok: result.ok, error: result.reason };
  },
};
