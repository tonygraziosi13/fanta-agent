import type { DatasetMeta } from '@/core/repositories/datasetMetaRepository';
import { mapDataset, type MappedDataset } from './datasetMapper';
import { DatasetSourceError, type DatasetSource } from './sources/datasetSource';
import { decideSync } from './versionPolicy';

/**
 * Motore di sincronizzazione (US20).
 *
 * --- La sequenza ---
 *   leggi versione locale -> scarica manifest -> DECIDI -> [scarica payload ->
 *   valida -> mappa -> applica in transazione]
 * Il ramo fra parentesi si percorre solo se serve davvero: nel caso normale —
 * dati gia' aggiornati — il sync finisce dopo poche centinaia di byte. E'
 * l'"early exit" di US20-T2, e non e' un'ottimizzazione: e' cio' che rende
 * accettabile un controllo di rete a ogni avvio.
 *
 * --- Perche' tutto e' iniettato ---
 * Il motore non importa `fetch`, non importa SQLite, non conosce i repository.
 * Riceve tre funzioni. Ne discende che l'intera logica di decisione e di
 * gestione degli errori — la parte in cui si sbaglia — e' testabile in Jest con
 * dei falsi, senza ambiente nativo e senza rete. Le implementazioni reali
 * vengono cablate in `defaultPorts()`, che e' l'unico punto "sporco".
 *
 * --- Politica sugli errori ---
 * Un sync fallito non e' un errore dell'app: e' una condizione normale (US20-2,
 * "gestire in modo aggraziato"). Non solleva mai; restituisce un esito. I dati
 * correnti restano al loro posto e l'utente continua a lavorare.
 */

export type SyncPhase = 'checking' | 'downloading' | 'applying' | 'done';

export type SyncOutcome =
  | { status: 'uptodate'; version: string }
  | { status: 'updated'; version: string; players: number; stats: number; source: string }
  | { status: 'failed'; error: string; transient: boolean };

export interface SyncPorts {
  source: DatasetSource;
  readMeta: () => Promise<DatasetMeta | null>;
  apply: (dataset: MappedDataset, meta: DatasetMeta) => Promise<{ players: number; stats: number }>;
  onPhase?: (phase: SyncPhase) => void;
  now?: () => number;
}

export async function runSync(ports: SyncPorts): Promise<SyncOutcome> {
  const { source, readMeta, apply, onPhase, now = Date.now } = ports;

  try {
    onPhase?.('checking');
    const [local, manifest] = await Promise.all([readMeta(), source.fetchManifest()]);

    const decision = decideSync(local, manifest);
    if (!decision.sync) {
      onPhase?.('done');
      return { status: 'uptodate', version: manifest.version };
    }

    onPhase?.('downloading');
    const payload = await source.fetchPayload(manifest);

    const dataset = mapDataset(payload, now());
    if (dataset.players.length === 0) {
      // Il payload era formalmente valido ma non ne e' sopravvissuta una riga:
      // applicarlo spegnerebbe l'intero listone dell'utente.
      return {
        status: 'failed',
        error: 'Nessun giocatore valido nel dataset scaricato.',
        transient: false,
      };
    }
    if (dataset.skipped.length > 0 && __DEV__) {
      console.warn(`[sync] ${dataset.skipped.length} record scartati:`, dataset.skipped.slice(0, 5));
    }

    onPhase?.('applying');
    const written = await apply(dataset, {
      version: manifest.version,
      hash: manifest.hash,
      appliedAt: now(),
      playersCount: dataset.players.length,
    });

    onPhase?.('done');
    return {
      status: 'updated',
      version: manifest.version,
      players: written.players,
      stats: written.stats,
      source: source.name,
    };
  } catch (error) {
    onPhase?.('done');
    if (error instanceof DatasetSourceError) {
      return { status: 'failed', error: error.message, transient: error.transient };
    }
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      // Un errore inatteso e' quasi sempre un bug o un DB in stato anomalo:
      // classificarlo come transitorio farebbe ritentare all'infinito.
      transient: false,
    };
  }
}
