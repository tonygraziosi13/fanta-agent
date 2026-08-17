import Constants from 'expo-constants';
import { applyDataset } from '@/core/repositories/datasetRepository';
import { getDatasetMeta } from '@/core/repositories/datasetMetaRepository';
import { BundledSource } from './sources/bundledSource';
import { RemoteHttpSource } from './sources/remoteHttpSource';
import type { DatasetSource } from './sources/datasetSource';
import { runSync, type SyncOutcome, type SyncPhase } from './syncEngine';

/**
 * Cablaggio fra il motore (puro, iniettabile) e il mondo reale.
 *
 * E' l'unico file del layer di sync che conosce `expo-constants`, i repository
 * e le sorgenti concrete. Tenerlo separato e' cio' che permette a
 * `syncEngine.ts` di restare testabile: qui non c'e' logica da verificare, solo
 * composizione.
 */

/**
 * L'URL del manifest sta in `app.json` (`expo.extra.datasetUrl`), non in una
 * costante compilata: cambiare hosting non deve richiedere di toccare il codice.
 * Assente o vuoto = nessuna sorgente remota configurata, e l'app vive sul CSV
 * incluso senza lamentarsi.
 */
export function getDatasetUrl(): string | null {
  const url = Constants.expoConfig?.extra?.datasetUrl;
  return typeof url === 'string' && url.trim() !== '' ? url.trim() : null;
}

function portsFor(source: DatasetSource, onPhase?: (phase: SyncPhase) => void) {
  return { source, readMeta: getDatasetMeta, apply: applyDataset, onPhase };
}

/** Sincronizzazione dalla sorgente remota. Nessun effetto se l'URL non c'e'. */
export async function syncFromRemote(
  onPhase?: (phase: SyncPhase) => void
): Promise<SyncOutcome> {
  const url = getDatasetUrl();
  if (url === null) {
    return {
      status: 'failed',
      error: 'Nessun URL dataset configurato (expo.extra.datasetUrl).',
      transient: false,
    };
  }
  return runSync(portsFor(new RemoteHttpSource(url), onPhase));
}

/**
 * Popolamento dal CSV incluso nell'app.
 *
 * Passa dallo stesso motore e dalla stessa transazione della sorgente remota:
 * il primo avvio offline non e' un percorso alternativo con regole proprie, e'
 * lo stesso percorso con un'altra sorgente. Un ramo speciale sarebbe la classica
 * strada che smette di funzionare perche' nessuno la esercita mai.
 */
export async function syncFromBundle(
  onPhase?: (phase: SyncPhase) => void
): Promise<SyncOutcome> {
  return runSync(portsFor(new BundledSource(), onPhase));
}
