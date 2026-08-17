import { loadListoneCsv } from '@/core/parsing/listoneAsset';
import { mapRecordsToPlayers } from '@/core/parsing/listoneMapper';
import type { DatasetManifest, DatasetPayload, RemotePlayer } from '../types';
import { DatasetSourceError, type DatasetSource } from './datasetSource';

/**
 * Il CSV imbarcato nell'app, esposto come se fosse una sorgente remota.
 *
 * E' il fallback del primo avvio senza rete (US20-2): l'utente che installa
 * l'app in treno deve comunque vedere il listone. Riusa `loadListoneCsv` e
 * `mapRecordsToPlayers` — lo stesso percorso collaudato di US7 — e si limita a
 * vestirli da `DatasetSource`.
 *
 * E' un Adapter, ed e' il motivo per cui il motore di sincronizzazione non ha
 * un ramo `if (offline)`: il fallback non e' un caso particolare del motore, e'
 * un'altra sorgente. Il codice che applica i dati e' lo stesso.
 *
 * Metriche: nessuna. Il CSV contiene solo anagrafica e quotazioni, e la
 * `coverage` vuota lo dichiara — la schermata di dettaglio mostrera' "dato non
 * disponibile" finche' non arriva il dataset vero.
 */

export const BUNDLED_VERSION = 'bundled-csv';

export class BundledSource implements DatasetSource {
  readonly name = 'listone incluso nell’app';

  async fetchManifest(): Promise<DatasetManifest> {
    return {
      version: BUNDLED_VERSION,
      // Hash costante: il contenuto cambia solo con una nuova build dell'app.
      // Cosi' il secondo avvio offline riconosce di avere gia' questi dati e
      // non ripete l'import.
      hash: BUNDLED_VERSION,
      season: '',
      generated_at: '',
      players_count: 0,
      size_bytes: 0,
      payload: 'listone.csv',
    };
  }

  async fetchPayload(): Promise<DatasetPayload> {
    const records = await loadListoneCsv();
    const { players } = mapRecordsToPlayers(records);

    if (players.length === 0) {
      throw new DatasetSourceError(
        'Il listone incluso è vuoto o illeggibile: rigeneralo con `npm run listone`.',
        false
      );
    }

    return {
      schema: 1,
      season: '',
      generated_at: '',
      sources: {},
      players: players.map(
        (p): RemotePlayer => ({
          id: p.id,
          r: p.r,
          rm: p.rm,
          nome: p.nome,
          squadra: p.squadra,
          is_active: p.is_active,
          quotazioni: {
            qt_a: p.qt_a,
            qt_i: p.qt_i,
            diff: p.diff,
            qt_a_m: p.qt_a_m,
            qt_i_m: p.qt_i_m,
            diff_m: p.diff_m,
            fvm: p.fvm,
            fvm_m: p.fvm_m,
          },
          performance: {
            presenze: null,
            minuti: null,
            media_voto: null,
            fantamedia: null,
            gol: null,
            assist: null,
            ammonizioni: null,
            espulsioni: null,
          },
          advanced: {
            xg: null,
            npxg: null,
            xa: null,
            xg_chain: null,
            xg_buildup: null,
            tiri: null,
            key_passes: null,
          },
          injuries: { days: null, matches: null, risk: null, history: [] },
          heatmap: null,
          coverage: {},
        })
      ),
    };
  }
}
