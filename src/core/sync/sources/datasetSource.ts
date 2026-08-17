import type { DatasetManifest, DatasetPayload } from '../types';

/**
 * La porta da cui arrivano i dati (Dependency Inversion).
 *
 * Il motore di sincronizzazione dipende da questa interfaccia e mai da `fetch`.
 * Ne discendono tre cose concrete:
 *
 *  - i test girano su una sorgente finta in memoria, senza rete e senza mock
 *    globali di `fetch`;
 *  - il fallback offline sul CSV bundlato non e' un caso speciale dentro il
 *    motore, ma un'altra implementazione della stessa porta;
 *  - cambiare hosting (raw.githubusercontent, Pages, S3) non tocca il motore.
 */
export interface DatasetSource {
  /** Nome per i log e per il messaggio d'errore mostrato all'utente. */
  readonly name: string;
  /** Il file leggero con la versione: si scarica sempre, a ogni controllo. */
  fetchManifest(): Promise<DatasetManifest>;
  /** Il payload completo: si scarica solo se il manifest dice che serve. */
  fetchPayload(manifest: DatasetManifest): Promise<DatasetPayload>;
}

export class DatasetSourceError extends Error {
  constructor(
    message: string,
    /** true = riprovare piu' tardi ha senso (rete assente, server in errore). */
    readonly transient: boolean = true
  ) {
    super(message);
    this.name = 'DatasetSourceError';
  }
}
