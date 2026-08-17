import {
  MIN_MINUTES_FOR_PER90,
  formatInt,
  formatMetric,
  isPer90Reliable,
  per90,
  performanceVerdict,
  ratio,
  riskBand,
} from '@/domain/metrics';
import {
  selectAnalytics,
  selectEconomics,
  selectInjuries,
  selectPerformance,
} from '@/state/statsSelectors';
import type { Player } from '@/domain/player';
import type { PlayerStats } from '@/domain/playerStats';

/**
 * Interpretazione delle metriche e sezioni del dettaglio (US21).
 *
 * Sono le regole che trasformano numeri grezzi in un giudizio mostrato
 * all'utente in asta: se sbagliano, sbagliano in silenzio e con l'aria di
 * essere autorevoli.
 */

const PLAYER: Player = {
  id: 1,
  r: 'A',
  rm: 'Pc',
  nome: 'Rossi',
  squadra: 'Inter',
  qt_a: 30,
  qt_i: 28,
  diff: 2,
  qt_a_m: 31,
  qt_i_m: 29,
  diff_m: 2,
  fvm: 200,
  fvm_m: 210,
  is_active: true,
};

function stats(overrides: Partial<PlayerStats> = {}): PlayerStats {
  return {
    playerId: 1,
    season: '2025-26',
    performance: {
      presenze: 30,
      minuti: 2500,
      mediaVoto: 6.4,
      fantamedia: 9.1,
      gol: 15,
      assist: 5,
      ammonizioni: 2,
      espulsioni: 0,
    },
    advanced: {
      xg: 10.0,
      npxg: 8.5,
      xa: 4.6,
      xgChain: 14.2,
      xgBuildup: 5.1,
      tiri: 80,
      keyPasses: 25,
    },
    injuries: { days: 40, matches: 6, risk: 0.13, history: [] },
    heatmap: null,
    coverage: { understat: true, fantacalcio: true },
    updatedAt: 0,
    ...overrides,
  };
}

describe('metriche', () => {
  it('propaga il dato mancante invece di inventare uno zero', () => {
    expect(per90(null, 900)).toBeNull();
    expect(per90(5, null)).toBeNull();
    expect(performanceVerdict(null, 3)).toBeNull();
    expect(riskBand(null)).toBeNull();
    expect(formatMetric(null)).toBe('—');
    expect(formatInt(null)).toBe('—');
  });

  it('non divide per zero minuti', () => {
    expect(per90(5, 0)).toBeNull();
  });

  it('calcola i valori per 90 minuti', () => {
    expect(per90(10, 900)).toBeCloseTo(1.0);
  });

  it('segnala come inaffidabile chi ha giocato pochissimo', () => {
    expect(isPer90Reliable(MIN_MINUTES_FOR_PER90 - 1)).toBe(false);
    expect(isPer90Reliable(MIN_MINUTES_FOR_PER90)).toBe(true);
  });

  it('giudica il rendimento rispetto alle attese', () => {
    // 15 gol contro 10 xG: sovraperformance, difficile da ripetere.
    expect(performanceVerdict(15, 10)).toBe('over');
    expect(performanceVerdict(5, 10)).toBe('under');
    // Uno scarto di un gol non e' un giudizio: e' rumore.
    expect(performanceVerdict(11, 10)).toBe('inLinea');
  });

  it('classifica il rischio infortuni per fasce', () => {
    expect(riskBand(0.05)).toBe('basso');
    expect(riskBand(0.3)).toBe('medio');
    expect(riskBand(0.8)).toBe('alto');
  });

  it('satura le barre invece di farle sforare', () => {
    expect(ratio(20, 10)).toBe(1);
    expect(ratio(-5, 10)).toBe(0);
  });
});

describe('sezioni del dettaglio', () => {
  it('mostra sempre i dati economici: vengono dal listone, non da fonti esterne', () => {
    const section = selectEconomics(PLAYER);
    expect(section.available).toBe(true);
    expect(section.lines[0]?.value).toBe('30');
  });

  it('nasconde le sezioni prive di dati (US21-2)', () => {
    expect(selectPerformance(undefined).available).toBe(false);
    expect(selectAnalytics(undefined).available).toBe(false);
    expect(selectInjuries(undefined).available).toBe(false);
  });

  it('mostra la sezione se anche un solo valore è presente', () => {
    const parziale = stats({
      performance: { ...stats().performance, presenze: null, minuti: null, mediaVoto: null, fantamedia: null, gol: 3, assist: null },
    });
    expect(selectPerformance(parziale).available).toBe(true);
  });

  it('porta il verdetto xG nella sezione analitica', () => {
    const section = selectAnalytics(stats());
    expect(section.goalVerdict).toBe('over');
    expect(section.per90Reliable).toBe(true);
  });

  it('avverte quando i minuti sono troppo pochi per il per-90', () => {
    const poco = stats({ performance: { ...stats().performance, minuti: 100 } });
    const section = selectAnalytics(poco);
    const per90Line = section.lines.find((l) => l.label.includes('90'));
    expect(section.per90Reliable).toBe(false);
    expect(per90Line?.hint).toContain('poco indicativo');
  });

  it('espone la fascia di rischio per il badge', () => {
    expect(selectInjuries(stats()).band).toBe('basso');
    expect(selectInjuries(stats({ injuries: { days: 200, matches: 30, risk: 0.7, history: [] } })).band).toBe('alto');
  });
});
