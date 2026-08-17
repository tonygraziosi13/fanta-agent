import { creditsPerSlot, rosaSize } from '@/domain/configuration';
import { CLASSIC_ROLES } from '@/domain/roles';
import { useConfigurationsStore } from '@/state/useConfigurationsStore';
import type { AgentTool } from '../types';

/**
 * Espone all'agente i parametri dell'asta in corso.
 *
 * E' il presupposto di qualunque ragionamento economico: senza sapere quanti
 * crediti ci sono e quanti slot restano da riempire, ogni consiglio sul prezzo
 * di un giocatore sarebbe campato per aria. I valori derivati (totale rosa,
 * crediti per slot) vengono calcolati qui invece che lasciati al modello:
 * l'aritmetica e' esattamente cio' che un LLM sbaglia piu' volentieri.
 */
export const getConfigurationTool: AgentTool<Record<string, never>> = {
  name: 'get_configuration',
  description:
    "Restituisce i parametri della configurazione d'asta attiva: numero di " +
    'partecipanti, crediti disponibili e composizione della rosa per ruolo.',
  input_schema: { type: 'object', properties: {} },
  handler: () => {
    const { activeId, byId } = useConfigurationsStore.getState();
    const config = activeId === null ? undefined : byId[activeId];
    if (!config) {
      return { attiva: false, messaggio: "Nessuna configurazione d'asta attiva." };
    }

    return {
      attiva: true,
      nome: config.name,
      partecipanti: config.participants,
      crediti: config.credits,
      rosa: {
        totale: rosaSize(config.slots),
        per_ruolo: Object.fromEntries(
          CLASSIC_ROLES.map((role) => [role, config.slots[role]])
        ),
      },
      crediti_per_slot: Number(creditsPerSlot(config).toFixed(2)),
    };
  },
};
