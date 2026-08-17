/**
 * Pipeline di "configurazioni sequenziali fisse".
 *
 * Le User Stories tornano cinque volte sulla stessa formula: agganci logici che
 * intervengono in nodi precisi, adatti a "validazioni statiche, aggiornamenti di
 * stato o interruzioni precoci". Tradotto in architettura: ogni azione utente
 * attraversa una sequenza fissa di stadi, sempre nello stesso ordine.
 *
 *   validate  ->  reduce  ->  effect
 *   (sync)        (sync)      (async, NON atteso)
 *
 * L'invariante che rende l'app fluida:
 *   `reduce` tocca solo lo stato in memoria ed e' SINCRONO  -> la UI risponde
 *   nello stesso frame del tocco;
 *   `effect` scrive su SQLite ed e' fire-and-forget         -> il framerate non
 *   dipende mai dalla latenza del disco.
 * E' esattamente il disaccoppiamento chiesto da US8-T4, US3-T3 e US6-T2.
 *
 * Perche' un modulo di prima classe e non tre useEffect sparsi: e' anche il
 * punto di innesto dell'agente. In Sprint 2 un tool call dell'LLM sara' una
 * `Action` che percorre questa stessa sequenza, ereditando gratis validazione,
 * reattivita' e persistenza — senza duplicare logica nella UI.
 */

export interface Stage<A> {
  /** Identifica lo stadio nei log e negli errori. */
  name: string;
  /** Interruzione precoce: `true` prosegue, una stringa e' il motivo dello stop. */
  validate?: (action: A) => true | string;
  /** Aggiornamento dello stato in memoria. Deve restare sincrono e senza I/O. */
  reduce?: (action: A) => void;
  /** Persistenza. Puo' fallire senza bloccare la UI. */
  effect?: (action: A) => Promise<void>;
}

export interface DispatchResult {
  ok: boolean;
  /** Valorizzato quando uno stadio ha interrotto la sequenza. */
  reason?: string;
  /** Stadio che ha bloccato l'azione. */
  blockedBy?: string;
  /**
   * Si risolve a persistenza completata. La UI la ignora;
   * i test la attendono per asserire sul DB senza sleep arbitrari.
   */
  persisted: Promise<void>;
}

export interface PipelineOptions {
  /** Invocato quando un effect fallisce: la UI ha gia' mostrato il risultato. */
  onEffectError?: (error: unknown, stage: string) => void;
}

export interface Pipeline<A> {
  dispatch: (action: A) => DispatchResult;
}

export function createPipeline<A>(
  stages: ReadonlyArray<Stage<A>>,
  options: PipelineOptions = {}
): Pipeline<A> {
  const { onEffectError } = options;

  function dispatch(action: A): DispatchResult {
    // --- Nodo 1: validazione. Tutti i validate prima di qualunque mutazione,
    // altrimenti un fallimento tardivo lascerebbe lo stato mezzo aggiornato.
    for (const stage of stages) {
      const verdict = stage.validate?.(action);
      if (verdict !== undefined && verdict !== true) {
        return {
          ok: false,
          reason: verdict,
          blockedBy: stage.name,
          persisted: Promise.resolve(),
        };
      }
    }

    // --- Nodo 2: stato in memoria. Sincrono: al ritorno di dispatch() la UI
    // ha gia' i dati nuovi ed e' pronta a ridisegnare.
    for (const stage of stages) {
      stage.reduce?.(action);
    }

    // --- Nodo 3: persistenza. Avviata ora, deliberatamente NON attesa.
    const persisted = (async () => {
      for (const stage of stages) {
        if (!stage.effect) continue;
        try {
          await stage.effect(action);
        } catch (error) {
          // Un errore di scrittura non deve propagarsi alla UI ne' fermare gli
          // stadi successivi: lo stato in memoria e' gia' quello corretto e
          // verra' riconciliato col DB al prossimo avvio.
          onEffectError?.(error, stage.name);
          if (__DEV__) {
            console.warn(`[pipeline] effect "${stage.name}" fallito:`, error);
          }
        }
      }
    })();

    return { ok: true, persisted };
  }

  return { dispatch };
}
