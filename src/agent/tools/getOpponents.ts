import { offertaMassima, slotRimanenti } from '@/domain/opponent';
import { CLASSIC_ROLES } from '@/domain/roles';
import { useOpponentsStore } from '@/state/useOpponentsStore';
import type { AgentTool } from '../types';

/**
 * Espone all'agente chi c'e' al tavolo e con quanti crediti.
 *
 * E' la meta' che mancava a `get_configuration`. Quello dice quanto valgono i
 * *miei* parametri d'asta; questo dice contro chi si gioca, il che cambia ogni
 * consiglio: puntare 40 su un attaccante ha senso se nessun altro puo' arrivarci
 * e non ne ha se tre avversari hanno il doppio dei crediti e lo stesso buco in
 * rosa.
 *
 * `offerta_massima` e `slot_liberi_totali` sono calcolati qui e non lasciati al
 * modello, per la stessa ragione per cui `get_configuration` calcola i crediti
 * per slot: l'aritmetica e' esattamente cio' che un LLM sbaglia piu' volentieri,
 * e "puo' offrire al massimo 37" e' una frase che verrebbe inventata con
 * disinvoltura.
 */
export const getOpponentsTool: AgentTool<{ solo_avversari?: boolean }> = {
  name: 'get_opponents',
  description:
    "Restituisce le squadre partecipanti all'asta con crediti residui, slot " +
    'ancora liberi per ruolo e massima offerta possibile. Include la squadra ' +
    "dell'utente, marcata da `sono_io`.",
  input_schema: {
    type: 'object',
    properties: {
      solo_avversari: {
        type: 'boolean',
        description: "Se true esclude la squadra dell'utente dal risultato.",
      },
    },
  },
  handler: ({ solo_avversari } = {}) => {
    const { items, configId } = useOpponentsStore.getState();

    if (items.length === 0) {
      // Zero avversari non e' "asta senza partecipanti": e' un import mai
      // fatto. Dirlo esplicitamente evita che il modello concluda di essere
      // solo al tavolo.
      return {
        disponibili: false,
        messaggio:
          "Nessun partecipante importato per questa configurazione. Lo stato d'asta " +
          'si importa da `stato_asta.json` con il tool `import_opponents`.',
      };
    }

    const squadre = (solo_avversari ? items.filter((o) => !o.isMe) : items).map((o) => ({
      nome: o.nome,
      proprietario: o.proprietario,
      sono_io: o.isMe,
      crediti_residui: o.creditiResidui,
      slot_liberi: Object.fromEntries(CLASSIC_ROLES.map((r) => [r, o.slotLiberi[r]])),
      slot_liberi_totali: slotRimanenti(o),
      offerta_massima: offertaMassima(o),
      giocatori_presi: o.rosa.length,
    }));

    return {
      disponibili: true,
      configurazione_id: configId,
      partecipanti: squadre.length,
      squadre,
    };
  },
};
