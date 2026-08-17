import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { mapDataset } from '@/core/sync/datasetMapper';
import { validateManifest, validatePayload } from '@/core/sync/datasetSchema';

/**
 * Il contratto fra la pipeline Python e l'app, verificato sui file veri.
 *
 * Gli altri test usano payload costruiti a mano e dimostrano che il mapper si
 * comporta bene *dato* un certo formato. Questo dimostra la cosa diversa e piu'
 * facile da rompere: che il formato che `scripts/build_dataset.py` scrive
 * davvero e quello che `datasetSchema.ts` accetta siano lo stesso. Sono due
 * linguaggi e due file distinti, e nulla impedirebbe a un campo rinominato da
 * un lato di passare inosservato fino al telefono.
 *
 * Se `dataset/` non e' ancora stato generato i test si saltano invece di
 * fallire: un clone fresco del repo senza esecuzione della pipeline e' una
 * situazione legittima, non un errore.
 */

const DATASET_DIR = join(__dirname, '..', 'dataset');
const MANIFEST_PATH = join(DATASET_DIR, 'manifest.json');
const PAYLOAD_PATH = join(DATASET_DIR, 'players.json');

const generato = existsSync(MANIFEST_PATH) && existsSync(PAYLOAD_PATH);
const describeSeGenerato = generato ? describe : describe.skip;

describeSeGenerato('contratto dataset ↔ app (file reali)', () => {
  const manifestRaw: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  const payloadRaw: unknown = JSON.parse(readFileSync(PAYLOAD_PATH, 'utf-8'));

  it('il manifest generato passa la validazione dell’app', () => {
    const result = validateManifest(manifestRaw);
    expect(result.ok).toBe(true);
  });

  it('il payload generato passa la validazione dell’app', () => {
    const result = validatePayload(payloadRaw);
    expect(result.ok).toBe(true);
  });

  it('ogni giocatore del listone si traduce in un record valido', () => {
    const result = validatePayload(payloadRaw);
    if (!result.ok) throw new Error(result.error);

    const { players, stats, skipped } = mapDataset(result.value);

    // Nessuno scarto: la pipeline parte dal listone, quindi ogni record deve
    // avere id, ruolo e nome validi per costruzione.
    expect(skipped).toHaveLength(0);
    expect(players.length).toBeGreaterThan(400);
    expect(stats.length).toBeGreaterThan(0);
  });

  it('le metriche assenti restano null e non diventano zero', () => {
    const result = validatePayload(payloadRaw);
    if (!result.ok) throw new Error(result.error);

    const { stats } = mapDataset(result.value);
    // Nel listone c'e' sempre qualcuno mai sceso in campo in Serie A: se
    // qualcuno lungo la catena "riempisse i buchi" con degli zeri, questo
    // sarebbe l'unico posto in cui se ne accorgerebbe.
    const conBuchi = stats.filter((s) => s.advanced.xg === null);
    expect(conBuchi.length).toBeGreaterThan(0);
  });

  it('chi ha metriche ha almeno una fonte dichiarata in coverage', () => {
    const result = validatePayload(payloadRaw);
    if (!result.ok) throw new Error(result.error);

    const { stats } = mapDataset(result.value);
    const senzaFonte = stats.filter((s) => Object.values(s.coverage).every((v) => !v));
    expect(senzaFonte).toHaveLength(0);
  });
});
