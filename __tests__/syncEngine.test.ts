import type { DatasetMeta } from '@/core/repositories/datasetMetaRepository';
import type { MappedDataset } from '@/core/sync/datasetMapper';
import { DatasetSourceError, type DatasetSource } from '@/core/sync/sources/datasetSource';
import { runSync, type SyncPorts } from '@/core/sync/syncEngine';
import type { DatasetManifest, DatasetPayload, RemotePlayer } from '@/core/sync/types';

/**
 * Test del motore di sincronizzazione (US20).
 *
 * Nessuna rete e nessun SQLite: il motore riceve sorgente, lettura della
 * versione locale e scrittura come funzioni, quindi qui si iniettano dei falsi.
 * E' il vantaggio concreto dell'inversione delle dipendenze — la logica che
 * decide *se* scaricare e *cosa* fare quando qualcosa va storto e' proprio la
 * parte che non si potrebbe provare a mano in modo affidabile.
 */

function remotePlayer(overrides: Partial<RemotePlayer> = {}): RemotePlayer {
  return {
    id: 1,
    r: 'A',
    rm: null,
    nome: 'Rossi',
    squadra: 'Inter',
    is_active: true,
    quotazioni: { qt_a: 20, qt_i: 18, diff: 2, qt_a_m: 21, qt_i_m: 19, diff_m: 2, fvm: 100, fvm_m: 110 },
    performance: {
      presenze: 30,
      minuti: 2500,
      media_voto: 6.5,
      fantamedia: 8.1,
      gol: 12,
      assist: 4,
      ammonizioni: 3,
      espulsioni: 0,
    },
    advanced: {
      xg: 10.2,
      npxg: 8.4,
      xa: 3.9,
      xg_chain: 15.1,
      xg_buildup: 6.2,
      tiri: 70,
      key_passes: 30,
    },
    injuries: { days: 12, matches: 2, risk: 0.04, history: [] },
    heatmap: null,
    coverage: { understat: true, fantacalcio: true },
    ...overrides,
  };
}

const MANIFEST: DatasetManifest = {
  version: 'v2',
  hash: 'hash-nuovo',
  season: '2025-26',
  generated_at: '2026-08-17T10:00:00Z',
  players_count: 1,
  size_bytes: 1024,
  payload: 'players.json',
};

const PAYLOAD: DatasetPayload = {
  schema: 1,
  season: '2025-26',
  generated_at: '2026-08-17T10:00:00Z',
  sources: {},
  players: [remotePlayer()],
};

class FakeSource implements DatasetSource {
  readonly name = 'finta';
  manifestCalls = 0;
  payloadCalls = 0;

  constructor(
    private readonly manifest: DatasetManifest | Error = MANIFEST,
    private readonly payload: DatasetPayload | Error = PAYLOAD
  ) {}

  async fetchManifest(): Promise<DatasetManifest> {
    this.manifestCalls += 1;
    if (this.manifest instanceof Error) throw this.manifest;
    return this.manifest;
  }

  async fetchPayload(): Promise<DatasetPayload> {
    this.payloadCalls += 1;
    if (this.payload instanceof Error) throw this.payload;
    return this.payload;
  }
}

function makePorts(source: DatasetSource, local: DatasetMeta | null) {
  const applied: Array<{ dataset: MappedDataset; meta: DatasetMeta }> = [];
  const ports: SyncPorts = {
    source,
    readMeta: async () => local,
    apply: async (dataset, meta) => {
      applied.push({ dataset, meta });
      return { players: dataset.players.length, stats: dataset.stats.length };
    },
    now: () => 1_000,
  };
  return { ports, applied };
}

const LOCAL_AGGIORNATO: DatasetMeta = {
  version: 'v2',
  hash: 'hash-nuovo',
  appliedAt: 500,
  playersCount: 1,
};

describe('syncEngine', () => {
  it('esce prima di scaricare il payload se l’hash locale coincide (US20-T2)', async () => {
    const source = new FakeSource();
    const { ports, applied } = makePorts(source, LOCAL_AGGIORNATO);

    const outcome = await runSync(ports);

    expect(outcome.status).toBe('uptodate');
    // Il punto della early exit: i megabyte non partono nemmeno.
    expect(source.payloadCalls).toBe(0);
    expect(applied).toHaveLength(0);
  });

  it('scarica e applica quando l’hash è diverso', async () => {
    const source = new FakeSource();
    const { ports, applied } = makePorts(source, {
      ...LOCAL_AGGIORNATO,
      hash: 'hash-vecchio',
    });

    const outcome = await runSync(ports);

    expect(outcome).toMatchObject({ status: 'updated', players: 1, stats: 1 });
    expect(applied).toHaveLength(1);
    expect(applied[0]?.meta.hash).toBe('hash-nuovo');
    // La versione registrata è quella del manifest appena applicato: è ciò che
    // permetterà al prossimo avvio di uscire subito.
    expect(applied[0]?.meta.appliedAt).toBe(1_000);
  });

  it('scarica al primo avvio, quando non c’è versione locale', async () => {
    const source = new FakeSource();
    const { ports } = makePorts(source, null);

    const outcome = await runSync(ports);

    expect(outcome.status).toBe('updated');
    expect(source.payloadCalls).toBe(1);
  });

  it('non scrive nulla se la rete cade (US20-2)', async () => {
    const source = new FakeSource(new DatasetSourceError('offline', true));
    const { ports, applied } = makePorts(source, LOCAL_AGGIORNATO);

    const outcome = await runSync(ports);

    expect(outcome).toMatchObject({ status: 'failed', transient: true });
    // Il criterio di accettazione: i dati correnti restano intatti.
    expect(applied).toHaveLength(0);
  });

  it('non scrive nulla se il payload è irrecuperabile', async () => {
    const source = new FakeSource(MANIFEST, new DatasetSourceError('404', false));
    const { ports, applied } = makePorts(source, null);

    const outcome = await runSync(ports);

    expect(outcome).toMatchObject({ status: 'failed', transient: false });
    expect(applied).toHaveLength(0);
  });

  it('rifiuta un payload i cui record sono tutti invalidi', async () => {
    // Formalmente un payload, ma nessun giocatore ne sopravvive: applicarlo
    // spegnerebbe l'intero listone dell'utente.
    const rotto: DatasetPayload = {
      ...PAYLOAD,
      players: [remotePlayer({ r: 'X' }), remotePlayer({ id: 0 })],
    };
    const { ports, applied } = makePorts(new FakeSource(MANIFEST, rotto), null);

    const outcome = await runSync(ports);

    expect(outcome.status).toBe('failed');
    expect(applied).toHaveLength(0);
  });

  it('applica i record validi scartando quelli rotti', async () => {
    const misto: DatasetPayload = {
      ...PAYLOAD,
      players: [remotePlayer({ id: 1 }), remotePlayer({ id: 2, r: 'Z' }), remotePlayer({ id: 3 })],
    };
    const { ports, applied } = makePorts(new FakeSource(MANIFEST, misto), null);

    const outcome = await runSync(ports);

    expect(outcome).toMatchObject({ status: 'updated', players: 2 });
    expect(applied[0]?.dataset.skipped).toHaveLength(1);
  });

  it('riporta le fasi nell’ordine, per la UI', async () => {
    const phases: string[] = [];
    const { ports } = makePorts(new FakeSource(), null);

    await runSync({ ...ports, onPhase: (p) => phases.push(p) });

    expect(phases).toEqual(['checking', 'downloading', 'applying', 'done']);
  });
});
