import {
  MODIFIER_WEIGHTS,
  bonusAttesi,
  calcolaIndiceModificatore,
  malusPer90,
  ordinaPerIndice,
  percentili,
  type ModifierCandidate,
} from '@/domain/modifierIndex';
import type { Team } from '@/domain/team';

/**
 * L'Indice Modificatore.
 *
 * E' un giudizio che l'utente non puo' verificare a occhio: un difensore in
 * cima alla lista sembra autorevole comunque, anche se ci e' finito per un buco
 * nei dati. I test qui sotto fissano le due regole che rendono la classifica
 * onesta — i percentili e la ridistribuzione dei pesi — e alcune trappole
 * aritmetiche che non solleverebbero nulla.
 */

const SQUADRA_SOLIDA: Team = {
  nome: 'Inter',
  allenatore: 'Chivu',
  moduloBase: '3-5-2',
  xgTotali: 87,
  xgaTotali: 35,
  ppdaStagione: 12,
  giocatoriImpiegati: 29,
  gialliTotali: 63,
  rossiTotali: 0,
  distribuzioneGol: null,
};

const SQUADRA_COLABRODO: Team = { ...SQUADRA_SOLIDA, nome: 'Lecce', xgaTotali: 65, ppdaStagione: 12 };
const SQUADRA_AGGRESSIVA: Team = { ...SQUADRA_SOLIDA, nome: 'Como', xgaTotali: 35, ppdaStagione: 6 };

function candidato(overrides: Partial<ModifierCandidate> = {}): ModifierCandidate {
  return {
    playerId: 1,
    nome: 'Bastoni',
    squadra: 'Inter',
    costo: 17,
    performance: {
      presenze: 30,
      minuti: 2700,
      mediaVoto: 6.1,
      fantamedia: 6.4,
      gol: 2,
      assist: 3,
      ammonizioni: 5,
      espulsioni: 0,
    },
    advanced: {
      xg: 1.5,
      npxg: 1.5,
      xa: 2.0,
      xgChain: 8.0,
      xgBuildup: 6.0,
      tiri: 20,
      keyPasses: 25,
    },
    team: SQUADRA_SOLIDA,
    ...overrides,
  };
}

describe('percentili', () => {
  it('ordina fra 0 e 1', () => {
    expect(percentili([10, 20, 30])).toEqual([0, 0.5, 1]);
  });

  it('i null restano null e non finiscono in fondo', () => {
    /**
     * È la differenza fra "peggiore di tutti" e "non lo sappiamo". Mandarlo a
     * zero lo farebbe scendere in classifica per un buco di copertura.
     */
    expect(percentili([10, null, 30])).toEqual([0, null, 1]);
  });

  it('i pari merito ricevono lo stesso punteggio', () => {
    /** Altrimenti l'ordine dipenderebbe da come sono arrivati nell'array. */
    const [a, b, c] = percentili([10, 10, 30]);
    expect(a).toBe(b);
    expect(c).toBe(1);
  });

  it('un solo candidato vale 0.5, non 1', () => {
    /**
     * Un candidato solo non è "il migliore", è l'unico: dargli il massimo lo
     * farebbe sembrare eccezionale a chi legge il punteggio senza sapere
     * quanti erano.
     */
    expect(percentili([42])).toEqual([0.5]);
  });

  it('tutti uguali valgono 0.5: non si inventa un ordinamento', () => {
    expect(percentili([7, 7, 7])).toEqual([0.5, 0.5, 0.5]);
  });

  it('un insieme vuoto non esplode', () => {
    expect(percentili([])).toEqual([]);
    expect(percentili([null, null])).toEqual([null, null]);
  });
});

describe('componenti', () => {
  it('pesa il rosso più di un giallo', () => {
    /** Un'espulsione costa anche la squalifica: contarla come un giallo qualunque
     * sottostimerebbe il difensore falloso. */
    const conRosso = malusPer90({
      presenze: 10, minuti: 900, mediaVoto: null, fantamedia: null,
      gol: null, assist: null, ammonizioni: 0, espulsioni: 1,
    });
    const conGiallo = malusPer90({
      presenze: 10, minuti: 900, mediaVoto: null, fantamedia: null,
      gol: null, assist: null, ammonizioni: 1, espulsioni: 0,
    });

    expect(conRosso).toBeGreaterThan(conGiallo!);
  });

  it('senza minuti non calcola un per-90', () => {
    /** Dividere per zero minuti darebbe Infinity, che in una classifica è un
     * primo posto immeritato. */
    expect(
      malusPer90({
        presenze: 0, minuti: 0, mediaVoto: null, fantamedia: null,
        gol: null, assist: null, ammonizioni: 3, espulsioni: 0,
      })
    ).toBeNull();
  });

  it('somma xG e xA, tollerando che uno manchi', () => {
    expect(bonusAttesi({ xg: 1.5, npxg: null, xa: 2, xgChain: null, xgBuildup: null, tiri: null, keyPasses: null })).toBe(3.5);
    expect(bonusAttesi({ xg: null, npxg: null, xa: 2, xgChain: null, xgBuildup: null, tiri: null, keyPasses: null })).toBe(2);
    expect(bonusAttesi({ xg: null, npxg: null, xa: null, xgChain: null, xgBuildup: null, tiri: null, keyPasses: null })).toBeNull();
  });
});

describe('indice modificatore', () => {
  it('una squadra solida alza i suoi difensori', () => {
    const [solido, colabrodo] = calcolaIndiceModificatore([
      candidato({ playerId: 1, team: SQUADRA_SOLIDA }),
      candidato({ playerId: 2, team: SQUADRA_COLABRODO }),
    ]);

    expect(solido!.indice).toBeGreaterThan(colabrodo!.indice);
  });

  it('il pressing aggressivo sconta il merito difensivo', () => {
    /**
     * PPDA basso = si aggredisce alto = più falli tattici per i difensori. Due
     * squadre che subiscono lo stesso xGA non valgono uguale se una pressa a
     * tutto campo: il cartellino è un malus certo, il modificatore è probabile.
     */
    const [tranquilla, aggressiva] = calcolaIndiceModificatore([
      candidato({ playerId: 1, team: SQUADRA_SOLIDA }),
      candidato({ playerId: 2, team: SQUADRA_AGGRESSIVA }),
    ]);

    expect(tranquilla!.breakdown.componenti.difesaSquadra).toBeGreaterThan(
      aggressiva!.breakdown.componenti.difesaSquadra!
    );
  });

  it('un dato mancante ridistribuisce il peso invece di azzerare', () => {
    /**
     * Il test che protegge la decisione centrale. Un difensore senza xGBuildup
     * non è "pessimo in impostazione": è uno di cui non lo sappiamo. Se venisse
     * trattato come zero finirebbe in fondo per un buco di copertura, che è il
     * modo più silenzioso di dare un consiglio sbagliato.
     */
    const senzaBuildup = candidato({
      playerId: 2,
      advanced: { xg: 1.5, npxg: 1.5, xa: 2.0, xgChain: null, xgBuildup: null, tiri: null, keyPasses: null },
    });

    const [completo, parziale] = calcolaIndiceModificatore([candidato({ playerId: 1 }), senzaBuildup]);

    // La componente non c'è...
    expect(parziale!.breakdown.componenti.impostazione).toBeUndefined();
    // ...e la copertura lo dichiara.
    expect(parziale!.breakdown.copertura).toBeCloseTo(1 - MODIFIER_WEIGHTS.impostazione, 2);
    expect(completo!.breakdown.copertura).toBeCloseTo(1, 2);
    // Ma l'indice resta su una scala confrontabile, non schiacciato a zero.
    expect(parziale!.indice).toBeGreaterThan(0);
  });

  it('senza nessun dato l’indice è zero e la copertura pure', () => {
    /** Il caso va distinto: indice 0 con copertura 0 significa "non ne sappiamo
     * niente", non "è pessimo". */
    const [vuoto] = calcolaIndiceModificatore([
      candidato({ performance: null, advanced: null, team: null }),
    ]);

    expect(vuoto!.indice).toBe(0);
    expect(vuoto!.breakdown.copertura).toBe(0);
  });

  it('un solo candidato non divide per zero', () => {
    const [solo] = calcolaIndiceModificatore([candidato()]);

    expect(Number.isFinite(solo!.indice)).toBe(true);
  });

  it('un insieme vuoto restituisce un elenco vuoto', () => {
    expect(calcolaIndiceModificatore([])).toEqual([]);
  });

  it('l’indice sta fra 0 e 100', () => {
    const scores = calcolaIndiceModificatore([
      candidato({ playerId: 1, team: SQUADRA_SOLIDA }),
      candidato({ playerId: 2, team: SQUADRA_COLABRODO }),
      candidato({ playerId: 3, team: SQUADRA_AGGRESSIVA }),
    ]);

    for (const score of scores) {
      expect(score.indice).toBeGreaterThanOrEqual(0);
      expect(score.indice).toBeLessThanOrEqual(100);
    }
  });
});

describe('ordinamento', () => {
  it('a parità di punteggio l’ordine è stabile', () => {
    /**
     * Una lista che si riordina da sola mentre la guardi in asta è peggio di
     * una lista sbagliata: l'id come spareggio la rende deterministica.
     */
    const scores = calcolaIndiceModificatore([
      candidato({ playerId: 7 }),
      candidato({ playerId: 3 }),
      candidato({ playerId: 5 }),
    ]);

    const ordinati = ordinaPerIndice(scores).map((s) => s.playerId);
    expect(ordinati).toEqual(ordinaPerIndice(scores).map((s) => s.playerId));
    expect(ordinati).toEqual([3, 5, 7]);
  });

  it('mette prima l’indice più alto', () => {
    const scores = calcolaIndiceModificatore([
      candidato({ playerId: 1, team: SQUADRA_COLABRODO }),
      candidato({ playerId: 2, team: SQUADRA_SOLIDA }),
    ]);

    expect(ordinaPerIndice(scores)[0]!.playerId).toBe(2);
  });
});
