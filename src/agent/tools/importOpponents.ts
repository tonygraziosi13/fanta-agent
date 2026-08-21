import { countMine, parseStatoAsta } from '@/core/parsing/statoAstaParser';
import { useConfigurationsStore } from '@/state/useConfigurationsStore';
import { useOpponentsStore } from '@/state/useOpponentsStore';
import type { AgentTool } from '../types';

interface ImportOpponentsInput {
  /** Contenuto testuale di `scripts/dataset/stato_asta.json`. */
  stato_asta: string;
}

/**
 * Importa lo stato d'asta nel dispositivo.
 *
 * --- Perche' un tool e non una schermata ---
 * `stato_asta.json` e' gitignorato: non puo' essere imbarcato come asset (lo
 * renderebbe pubblico) ne' distribuito dal sync (idem). Non ha quindi nessuna
 * strada automatica per raggiungere il telefono, e serve un canale esplicito.
 *
 * Un tool e' il canale piu' piccolo che funziona: e' eseguibile subito via
 * `executeTool` senza montare interfaccia, ed e' gia' il posto giusto quando ci
 * sara' il runtime LLM — "importa questo stato d'asta" e' esattamente il genere
 * di richiesta che si fa a voce. Una schermata potra' arrivare dopo e chiamare
 * lo stesso `importSeed`.
 *
 * E' **mutante**: sostituisce gli avversari della configurazione attiva. In
 * Sprint 2 richiedera' conferma esplicita come ogni tool marcato cosi'.
 */
export const importOpponentsTool: AgentTool<ImportOpponentsInput> = {
  name: 'import_opponents',
  description:
    "Importa lo stato d'asta (contenuto di stato_asta.json) nella configurazione " +
    'attiva: squadre partecipanti, crediti residui e slot liberi. Sostituisce i ' +
    'partecipanti già presenti.',
  mutating: true,
  input_schema: {
    type: 'object',
    properties: {
      stato_asta: {
        type: 'string',
        description: 'Contenuto JSON del file stato_asta.json.',
      },
    },
    required: ['stato_asta'],
  },
  handler: async ({ stato_asta }) => {
    const { activeId } = useConfigurationsStore.getState();
    if (activeId === null) {
      // Senza configurazione attiva non c'e' un'asta a cui legare i
      // partecipanti: `opponents.config_id` non avrebbe un valore sensato.
      return {
        ok: false,
        errore:
          "Nessuna configurazione d'asta attiva: gli avversari appartengono a una lega.",
      };
    }

    // La validazione avviene qui *e* dentro `importSeed`. Sembra doppia e non lo
    // e': serve il conteggio delle squadre marcate come proprie prima di
    // scrivere, per poterlo riportare al modello come avvertimento.
    const outcome = parseStatoAsta(stato_asta);
    if (!outcome.ok) {
      return { ok: false, errore: outcome.error };
    }

    const mie = countMine(outcome.value.teams);
    const esito = await useOpponentsStore.getState().importSeed(stato_asta, activeId);

    if (!esito.ok) {
      return { ok: false, errore: esito.error };
    }

    return {
      ok: true,
      importate: esito.imported,
      scartate: esito.skipped,
      scarti: outcome.value.skipped,
      // Un avvertimento e non un errore: l'import e' comunque utile, ma senza
      // sapere quale squadra e' dell'utente l'agente non puo' ragionare sui
      // *suoi* crediti — e con due, ogni ragionamento sarebbe ambiguo.
      avviso:
        mie === 1
          ? undefined
          : mie === 0
            ? "Nessuna squadra è marcata come tua (`sono_io`): rigenera il file con --mia-squadra."
            : `${mie} squadre sono marcate come tue: dovrebbe essercene una sola.`,
    };
  },
};
