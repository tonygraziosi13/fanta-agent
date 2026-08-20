import { readFileSync } from 'fs';
import { join } from 'path';
import type { DatasetMeta } from '@/core/repositories/datasetMetaRepository';
import type { MappedDataset } from '@/core/sync/datasetMapper';
import { RemoteHttpSource } from '@/core/sync/sources/remoteHttpSource';
import { runSync } from '@/core/sync/syncEngine';

/**
 * Verifica dal vivo del dataset pubblicato.
 *
 *     FANTA_LIVE=1 npm test -- liveDataset
 *
 * Esce dalla rete di proposito, quindi **e' saltata per default**: la suite
 * normale deve restare deterministica e girare offline. Questa serve dopo ogni
 * pubblicazione, ed e' l'unico test che esercita davvero `RemoteHttpSource`
 * contro l'URL configurato in `app.json` — cioe' l'unico anello che i test
 * offline non possono coprire: URL sbagliato, file non pubblicato, repository
 * privato, payload servito come pagina HTML.
 *
 * Non tocca SQLite: `apply` e' una funzione finta che conta e basta. Cio' che
 * si sta verificando e' la catena rete -> validazione -> mappatura.
 */

const live = process.env.FANTA_LIVE === '1';
const describeLive = live ? describe : describe.skip;

/**
 * L'URL si legge da `app.json`, non da `expo-constants`: sotto Jest quest'ultimo
 * e' un mock di `jest-expo` e restituisce una configurazione vuota. A runtime la
 * fonte e' la stessa — `expo config --type public` mostra che `extra` finisce nel
 * manifest servito all'app — ma qui il file su disco e' l'unica verita' leggibile.
 */
function configuredUrl(): string | undefined {
  const appJson: unknown = JSON.parse(
    readFileSync(join(__dirname, '..', 'app.json'), 'utf-8')
  );
  const extra = (appJson as { expo?: { extra?: { datasetUrl?: string } } }).expo?.extra;
  return extra?.datasetUrl;
}

describeLive('dataset pubblicato (richiede rete)', () => {
  const url = configuredUrl();

  it('app.json dichiara un URL del dataset', () => {
    expect(typeof url).toBe('string');
    expect(url).toMatch(/^https?:\/\//);
  });

  it('scarica, valida e mappa il dataset reale', async () => {
    const applied: Array<{ dataset: MappedDataset; meta: DatasetMeta }> = [];

    const outcome = await runSync({
      source: new RemoteHttpSource(url as string),
      // Nessuna versione locale: forza il percorso completo, download compreso.
      readMeta: async () => null,
      apply: async (dataset, meta) => {
        applied.push({ dataset, meta });
        return { players: dataset.players.length, stats: dataset.stats.length };
      },
    });

    expect(outcome.status).toBe('updated');
    if (outcome.status !== 'updated') return;

    expect(outcome.players).toBeGreaterThan(400);
    expect(outcome.stats).toBeGreaterThan(0);
    expect(applied[0]?.dataset.skipped).toHaveLength(0);
  }, 60_000);

  it('con la versione locale allineata non scarica nulla', async () => {
    const source = new RemoteHttpSource(url as string);
    const manifest = await source.fetchManifest();

    const outcome = await runSync({
      source,
      readMeta: async () => ({
        version: manifest.version,
        hash: manifest.hash,
        appliedAt: Date.now(),
        playersCount: manifest.players_count,
      }),
      apply: async () => {
        throw new Error('Non deve essere invocata: i dati sono già aggiornati.');
      },
    });

    expect(outcome.status).toBe('uptodate');
  }, 30_000);
});
