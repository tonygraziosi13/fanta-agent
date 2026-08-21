/**
 * Fase 2 del middleware: logiche di avvolgimento dinamico.
 *
 * --- Perche' questa e' l'unica astrazione davvero nuova ---
 * Le Fasi 1 e 3 — ispezione della query e validazione dell'output — sono
 * "configurazioni sequenziali fisse", e la base ne ha gia' una: `validate ->
 * reduce -> effect` in `core/middleware/pipeline.ts`. La Fase 2 no: niente,
 * nella pipeline, **incapsula** un'esecuzione. Uno stadio decide se proseguire,
 * un avvolgimento decide *come* si esegue — e puo' rieseguire.
 *
 * E' la differenza che serve per i ritentativi: rotazione della chiave dopo un
 * 429, timeout, fallback su un modello piu' piccolo. Sono tutti casi in cui la
 * decisione dipende da com'e' andata la chiamata, e una sequenza fissa non lo
 * puo' sapere prima.
 */

/**
 * Un avvolgimento riceve l'input e la continuazione.
 *
 * Con `next` in mano puo' fare quattro cose diverse — ispezionare, modificare
 * l'input, rieseguire, cortocircuitare senza chiamare — ed e' proprio la
 * quarta che una sequenza fissa non permette.
 */
export type Wrapper<I, O> = (input: I, next: (input: I) => Promise<O>) => Promise<O>;

export type Handler<I, O> = (input: I) => Promise<O>;

/**
 * Compone piu' avvolgimenti in uno solo.
 *
 * **L'ordine di dichiarazione e' l'ordine di esecuzione**: il primo della lista
 * e' il piu' esterno, quindi vede la chiamata per primo e il risultato per
 * ultimo. E' l'unica convenzione che non si sbaglia rileggendo il codice sei
 * mesi dopo — l'alternativa costringerebbe a leggere l'array al contrario ogni
 * volta.
 *
 *   compose(withTimeout, withKeyRotation)
 *   -> il timeout copre anche i ritentativi della rotazione.
 *
 * L'esempio non e' accademico: invertendoli, il timeout ripartirebbe da capo a
 * ogni chiave e cinque chiavi lente diventerebbero cinque attese intere.
 */
export function compose<I, O>(...wrappers: ReadonlyArray<Wrapper<I, O>>): Wrapper<I, O> {
  return (input, next) => {
    let handler: Handler<I, O> = next;

    // Si annida dal fondo: l'ultimo avvolgimento finisce adiacente a `next`, il
    // primo resta all'esterno.
    for (let i = wrappers.length - 1; i >= 0; i -= 1) {
      const wrapper = wrappers[i]!;
      const dentro = handler;
      handler = (arg) => wrapper(arg, dentro);
    }

    return handler(input);
  };
}

/** Applica un avvolgimento a un handler, ottenendo un handler. */
export function applyWrapper<I, O>(
  handler: Handler<I, O>,
  wrapper: Wrapper<I, O>
): Handler<I, O> {
  return (input) => wrapper(input, handler);
}

/**
 * Interrompe l'esecuzione se supera il tempo concesso.
 *
 * Durante un'asta un consiglio che arriva dopo quaranta secondi non e' un
 * consiglio: il giocatore e' gia' stato venduto. Meglio dichiarare il
 * fallimento e lasciare decidere all'utente.
 */
export function withTimeout<I, O>(ms: number): Wrapper<I, O> {
  return async (input, next) => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        next(input),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
        }),
      ]);
    } finally {
      // Senza questo, il timer resta appeso fino alla scadenza anche quando la
      // chiamata e' andata a buon fine: su React Native tiene sveglio il
      // runtime e in un test fa "aprire handle" che non si chiudono mai.
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Nessuna risposta entro ${ms}ms.`);
    this.name = 'TimeoutError';
  }
}

/**
 * Ritenta con attesa crescente.
 *
 * Distinto da `withKeyRotation` di proposito: quello risolve "questa chiave e'
 * finita", questo risolve "la rete ha singhiozzato". Metterli insieme
 * significherebbe aspettare quando basterebbe cambiare chiave.
 */
export function withRetry<I, O>(
  tentativi: number,
  ritentabile: (error: unknown) => boolean,
  attesaMs = 400
): Wrapper<I, O> {
  return async (input, next) => {
    let ultimo: unknown;

    for (let tentativo = 0; tentativo < tentativi; tentativo += 1) {
      try {
        return await next(input);
      } catch (error) {
        if (!ritentabile(error)) throw error;
        ultimo = error;
        if (tentativo + 1 < tentativi) {
          await pausa(attesaMs * 2 ** tentativo);
        }
      }
    }

    throw ultimo;
  };
}

export function pausa(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
