import { indexByTeam, parseCoaches, teamKey } from '@/core/parsing/coachesParser';
import { difensoriNelModulo, xgaPer90, PARTITE_STAGIONE } from '@/domain/team';
import type { Team } from '@/domain/team';

/**
 * Lettura di `coaches.json` e derivate di squadra.
 *
 * Il file è generato da Python contro Transfermarkt e Understat, che cambiano
 * senza preavviso: vale la regola già applicata al dataset e al seme d'asta —
 * si scarta la squadra rotta, non il file.
 */

function squadra(overrides: Record<string, unknown> = {}) {
  return {
    allenatore: 'Cristian Chivu',
    squadra: 'Inter',
    modulo_base: '3-5-2',
    xg_totali: 87.05,
    xga_totali: 35.85,
    ppda_stagione: 9.66,
    giocatori_impiegati_storico: 29,
    gialli_totali: 63,
    rossi_totali: 0,
    distribuzione_gol: {
      difensori: 19,
      centrocampisti: 24,
      attaccanti: 42,
      totale: 85,
      difensori_perc: 22.4,
      centrocampisti_perc: 28.2,
      attaccanti_perc: 49.4,
    },
    ...overrides,
  };
}

describe('parseCoaches', () => {
  it('legge una squadra completa', () => {
    const outcome = parseCoaches([squadra()]);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const team = outcome.value.teams[0]!;
    expect(team.nome).toBe('Inter');
    expect(team.moduloBase).toBe('3-5-2');
    expect(team.xgaTotali).toBeCloseTo(35.85);
    expect(team.distribuzioneGol?.attaccantiPerc).toBeCloseTo(49.4);
  });

  it('la neopromossa esce con i campi a null, non a zero', () => {
    /**
     * `xga_totali: null` significa "in Serie A non ha giocato". Zero direbbe
     * "non subisce mai", che in un indice difensivo la porterebbe in cima.
     */
    const outcome = parseCoaches([
      squadra({ squadra: 'Monza', xg_totali: null, xga_totali: null, ppda_stagione: null }),
    ]);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.teams[0]!.xgaTotali).toBeNull();
    expect(outcome.value.teams[0]!.ppdaStagione).toBeNull();
  });

  it('scarta la squadra senza nome, non il file', () => {
    const outcome = parseCoaches([squadra(), squadra({ squadra: '  ' })]);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.teams).toHaveLength(1);
    expect(outcome.value.skipped).toHaveLength(1);
  });

  it('scarta i duplicati: il nome è la chiave di join col listone', () => {
    const outcome = parseCoaches([squadra(), squadra()]);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.teams).toHaveLength(1);
    expect(outcome.value.skipped[0]!.reason).toContain('duplicata');
  });

  it('una distribuzione a metà diventa null invece di avere buchi', () => {
    const outcome = parseCoaches([
      squadra({ distribuzione_gol: { difensori: 5, centrocampisti: 3 } }),
    ]);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.teams[0]!.distribuzioneGol).toBeNull();
  });

  it('rifiuta un file vuoto o non-array', () => {
    expect(parseCoaches([]).ok).toBe(false);
    expect(parseCoaches({ squadre: [] }).ok).toBe(false);
  });
});

describe('derivate di squadra', () => {
  const team: Team = {
    nome: 'Inter',
    allenatore: 'Chivu',
    moduloBase: '3-5-2',
    xgTotali: 87,
    xgaTotali: 38,
    ppdaStagione: 9.66,
    giocatoriImpiegati: 29,
    gialliTotali: 63,
    rossiTotali: 0,
    distribuzioneGol: null,
  };

  it('xGA per 90 divide per le giornate', () => {
    expect(xgaPer90(team)).toBeCloseTo(38 / PARTITE_STAGIONE);
  });

  it('senza xGA non inventa un per-90', () => {
    expect(xgaPer90({ ...team, xgaTotali: null })).toBeNull();
  });

  it('legge quanti difensori schiera il modulo', () => {
    /** Serve al "System Fit": un esterno listato D rende molto di più da quinto
     * in una difesa a tre che da terzino in una a quattro. */
    expect(difensoriNelModulo(team)).toBe(3);
    expect(difensoriNelModulo({ ...team, moduloBase: '4-2-3-1' })).toBe(4);
    expect(difensoriNelModulo({ ...team, moduloBase: null })).toBeNull();
  });
});

describe('indice per nome', () => {
  it('trova la squadra a prescindere da maiuscole e spazi', () => {
    const outcome = parseCoaches([squadra()]);
    if (!outcome.ok) throw new Error('parse fallito');

    const indice = indexByTeam(outcome.value.teams);
    expect(indice[teamKey('  INTER ')]).toBeDefined();
  });
});
