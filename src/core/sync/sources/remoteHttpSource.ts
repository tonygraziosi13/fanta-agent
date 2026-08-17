import { validateManifest, validatePayload } from '../datasetSchema';
import type { DatasetManifest, DatasetPayload } from '../types';
import { DatasetSourceError, type DatasetSource } from './datasetSource';

/**
 * Sorgente HTTP: il dataset pubblicato su URL (US19-4, US20-2).
 *
 * Due accorgimenti che decidono se l'app parte o resta appesa:
 *
 *  1. `AbortController` con timeout esplicito. `fetch` su rete mobile puo'
 *     restare in attesa per minuti quando la connessione c'e' ma non porta da
 *     nessuna parte (captive portal, campo assente): senza timeout, il boot a
 *     freddo aspetterebbe con lui.
 *  2. Timeout diversi per manifest e payload. Il manifest sono poche centinaia
 *     di byte e o arriva subito o non arriva; il payload sono megabyte e
 *     merita pazienza.
 */

const MANIFEST_TIMEOUT_MS = 6_000;
const PAYLOAD_TIMEOUT_MS = 30_000;

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      // 404 e 403 non migliorano riprovando fra un minuto: l'URL e' sbagliato o
      // il file non e' stato pubblicato. Vale la pena distinguerli dai 5xx.
      const transient = response.status >= 500 || response.status === 429;
      throw new DatasetSourceError(`HTTP ${response.status} su ${url}`, transient);
    }

    return (await response.json()) as unknown;
  } catch (error) {
    if (error instanceof DatasetSourceError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new DatasetSourceError(`Rete non disponibile (${message})`, true);
  } finally {
    clearTimeout(timer);
  }
}

/** Il manifest dichiara il payload per nome: si risolve accanto a lui. */
function resolvePayloadUrl(manifestUrl: string, payloadName: string): string {
  const base = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
  return base + payloadName;
}

export class RemoteHttpSource implements DatasetSource {
  readonly name = 'remoto';

  constructor(private readonly manifestUrl: string) {}

  async fetchManifest(): Promise<DatasetManifest> {
    const raw = await fetchJson(this.manifestUrl, MANIFEST_TIMEOUT_MS);
    const result = validateManifest(raw);
    if (!result.ok) {
      // Un JSON valido ma di forma sbagliata e' quasi sempre una pagina di
      // errore servita con 200: non e' un problema di rete, non si ritenta.
      throw new DatasetSourceError(result.error, false);
    }
    return result.value;
  }

  async fetchPayload(manifest: DatasetManifest): Promise<DatasetPayload> {
    const url = resolvePayloadUrl(this.manifestUrl, manifest.payload);
    const raw = await fetchJson(url, PAYLOAD_TIMEOUT_MS);
    const result = validatePayload(raw);
    if (!result.ok) throw new DatasetSourceError(result.error, false);
    return result.value;
  }
}
