import { mapDataset } from '@/core/sync/datasetMapper';
import { validateManifest, validatePayload } from '@/core/sync/datasetSchema';
import { decideSync, datasetAgeInDays } from '@/core/sync/versionPolicy';
import type { DatasetPayload, RemotePlayer } from '@/core/sync/types';

/**
 * Traduzione del dataset remoto e politica di versione.
 *
 * Il tema di tutti questi test e' uno solo: **assente non e' zero**. E' la
 * regola che attraversa pipeline, schema SQL, dominio e UI, ed e' quella che si
 * romperebbe per prima con una modifica distratta al mapper.
 */

function player(overrides: Partial<RemotePlayer> = {}): RemotePlayer {
  return {
    id: 10,
    r: 'C',
    rm: 'M;C',
    nome: 'Bianchi',
    squadra: 'Roma',
    is_active: true,
    quotazioni: { qt_a: 15, qt_i: 14, diff: 1, qt_a_m: 16, qt_i_m: 15, diff_m: 1, fvm: 80, fvm_m: 85 },
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
    coverage: {},
    ...overrides,
  };
}

function payload(players: RemotePlayer[]): DatasetPayload {
  return { schema: 1, season: '2025-26', generated_at: '', sources: {}, players };
}

describe('datasetMapper', () => {
  it('conserva i null delle metriche invece di trasformarli in zeri', () => {
    const { stats } = mapDataset(
      payload([player({ coverage: { fantacalcio: true }, performance: { ...player().performance, presenze: 5 } })])
    );

    expect(stats[0]?.performance.presenze).toBe(5);
    // Il neopromosso senza xG non e' un attaccante che non tira mai.
    expect(stats[0]?.advanced.xg).toBeNull();
  });

  it('non crea una riga di metriche per chi non è coperto da alcuna fonte', () => {
    const { players, stats } = mapDataset(payload([player({ coverage: {} })]));

    expect(players).toHaveLength(1);
    // Nessuna riga: l'assenza di riga *e'* l'informazione.
    expect(stats).toHaveLength(0);
  });

  it('scarta i record con ruolo o id non validi senza perdere gli altri', () => {
    const { players, skipped } = mapDataset(
      payload([player({ id: 1 }), player({ id: 2, r: 'X' }), player({ id: 0 }), player({ id: 3, nome: '' })])
    );

    expect(players.map((p) => p.id)).toEqual([1]);
    expect(skipped).toHaveLength(3);
  });

});

describe('datasetSchema', () => {
  it('rifiuta un manifest senza hash: senza, ogni avvio riscaricherebbe tutto', () => {
    expect(validateManifest({ version: 'v1', payload: 'players.json' }).ok).toBe(false);
  });

  it('rifiuta un payload con zero giocatori', () => {
    expect(validatePayload({ schema: 1, players: [] }).ok).toBe(false);
  });

  it('rifiuta uno schema più recente di quello supportato', () => {
    const result = validatePayload({ schema: 99, players: [player()] });
    expect(result.ok).toBe(false);
  });

  it('rifiuta una pagina HTML servita al posto del JSON', () => {
    expect(validateManifest('<!doctype html>').ok).toBe(false);
    expect(validatePayload(null).ok).toBe(false);
  });
});

describe('versionPolicy', () => {
  const manifest = {
    version: 'v2',
    hash: 'abc',
    season: '',
    generated_at: '',
    players_count: 1,
    size_bytes: 1,
    payload: 'players.json',
  };

  it('sincronizza al primo avvio', () => {
    expect(decideSync(null, manifest)).toEqual({ sync: true, reason: 'primo-avvio' });
  });

  it('non sincronizza a parità di hash, anche con versione diversa', () => {
    const local = { version: 'altra-etichetta', hash: 'abc', appliedAt: 1, playersCount: 1 };
    expect(decideSync(local, manifest).sync).toBe(false);
  });

  it('sincronizza quando l’hash cambia', () => {
    const local = { version: 'v2', hash: 'vecchio', appliedAt: 1, playersCount: 1 };
    expect(decideSync(local, manifest)).toEqual({ sync: true, reason: 'versione-diversa' });
  });

  it('calcola l’età del dataset locale', () => {
    const local = { version: 'v2', hash: 'abc', appliedAt: 0, playersCount: 1 };
    expect(datasetAgeInDays(null)).toBeNull();
    expect(datasetAgeInDays({ ...local, appliedAt: 86_400_000 }, 3 * 86_400_000)).toBe(2);
  });
});
