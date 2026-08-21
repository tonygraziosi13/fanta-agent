import {
  CAMPIONE_MINIMO_INFLAZIONE,
  alternativeEntroIlTetto,
  costoAtteso,
  inflazioneOsservata,
  proponiAlternative,
  valutaBudget,
} from '@/domain/budgetAlert';
import type { Opponent } from '@/domain/opponent';
import type { Player } from '@/domain/player';
import type { ClassicRole } from '@/domain/roles';

/**
 * Allarme economico.
 *
 * È un giudizio che l'utente non può verificare a mente durante un'asta: se
 * dice "ti mancano 120 crediti" ci crede. Sbagliarlo in difetto lo fa smettere
 * di rilanciare quando poteva ancora; in eccesso lo lascia arrivare a fine asta
 * con tre caselle vuote. Nessuno dei due si scopre finché non è tardi.
 */

function giocatore(overrides: Partial<Player> = {}): Player {
  return {
    id: 1,
    r: 'D',
    rm: 'Dc',
    nome: 'Bastoni',
    squadra: 'Inter',
    qt_a: 20,
    qt_i: 18,
    diff: 2,
    qt_a_m: 21,
    qt_i_m: 19,
    diff_m: 2,
    fvm: 60,
    fvm_m: 65,
    is_active: true,
    ...overrides,
  };
}

function avversario(overrides: Partial<Opponent> = {}): Opponent {
  return {
    id: 10,
    configId: 1,
    nome: 'Atletico Bar',
    proprietario: null,
    isMe: true,
    creditiResidui: 500,
    slotLiberi: { P: 3, D: 8, C: 8, A: 6 },
    rosa: [],
    ...overrides,
  };
}

function indice(players: Player[]): Record<number, Player> {
  return Object.fromEntries(players.map((p) => [p.id, p]));
}

describe('inflazione osservata', () => {
  it('misura quanto il tavolo paga sopra la quotazione', () => {
    /**
     * Il dato che nessun listino può conoscere: i prezzi pagati in *questa*
     * asta. Sei acquisti da 20 di quotazione pagati 30 danno 1.5.
     */
    const players = Array.from({ length: 6 }, (_, i) => giocatore({ id: i + 1, qt_a: 20 }));
    const opponents = [
      avversario({
        rosa: players.map((p) => ({ playerId: p.id, prezzo: 30 })),
      }),
    ];

    expect(inflazioneOsservata(opponents, indice(players))).toBeCloseTo(1.5);
  });

  it('non si fida di un campione troppo piccolo', () => {
    /**
     * Con due o tre nomi il rapporto è rumore: basta un portiere pagato uno per
     * far sembrare che la lega spenda meno del listino.
     */
    const players = [giocatore({ id: 1 }), giocatore({ id: 2 })];
    const opponents = [
      avversario({ rosa: [{ playerId: 1, prezzo: 50 }, { playerId: 2, prezzo: 50 }] }),
    ];

    expect(inflazioneOsservata(opponents, indice(players))).toBeNull();
  });

  it('ignora gli acquisti senza prezzo registrato', () => {
    /** Contarli come zero farebbe sembrare l'inflazione più bassa di quel che è. */
    const players = Array.from({ length: 6 }, (_, i) => giocatore({ id: i + 1, qt_a: 10 }));
    const conBuchi = players.map((p, i) => ({ playerId: p.id, prezzo: i < 5 ? 20 : null }));

    // Restano cinque acquisti validi: esattamente la soglia.
    expect(inflazioneOsservata([avversario({ rosa: conBuchi })], indice(players))).toBeCloseTo(2);
    expect(CAMPIONE_MINIMO_INFLAZIONE).toBe(5);
  });

  it('senza acquisti non inventa un moltiplicatore', () => {
    expect(inflazioneOsservata([avversario()], {})).toBeNull();
  });
});

describe('costo atteso', () => {
  it('applica l’inflazione e arrotonda per eccesso', () => {
    /** Per eccesso: una stima che arrotonda in giù farebbe scattare l'allarme
     * un credito troppo tardi, che su venticinque slot sono venticinque. */
    expect(costoAtteso(giocatore({ qt_a: 20 }), 1.4)).toBe(28);
    expect(costoAtteso(giocatore({ qt_a: 21 }), 1.4)).toBe(30);
  });

  it('senza inflazione usa la quotazione nuda', () => {
    expect(costoAtteso(giocatore({ qt_a: 20 }), null)).toBe(20);
  });

  it('non scende mai sotto un credito', () => {
    expect(costoAtteso(giocatore({ qt_a: 0 }), null)).toBe(1);
  });
});

describe('valutazione del budget', () => {
  function targets(quanti: number, ruolo: ClassicRole, qt: number): Player[] {
    return Array.from({ length: quanti }, (_, i) =>
      giocatore({ id: 100 + i, r: ruolo, qt_a: qt })
    );
  }

  it('conta solo quanti ne stanno negli slot liberi', () => {
    /**
     * Nessuno compra tutta la propria watchlist: ci si mettono venti nomi per
     * sceglierne otto. Sommarli tutti darebbe un fabbisogno enorme e un allarme
     * sempre acceso, cioè una spia che nessuno guarda più.
     */
    const mia = avversario({ slotLiberi: { P: 0, D: 2, C: 0, A: 0 } });
    const verdict = valutaBudget(mia, targets(10, 'D', 30), null);

    // Due slot liberi: si contano i due più cari, non i dieci.
    expect(verdict.fabbisogno).toBe(60);
  });

  it('prende i più cari, non i più economici', () => {
    /** È il caso peggiore, ed è quello su cui vale la pena avvisare: partire
     * dai più economici direbbe sempre che i crediti bastano. */
    const mia = avversario({ slotLiberi: { P: 0, D: 1, C: 0, A: 0 } });
    const lista = [
      giocatore({ id: 1, r: 'D', qt_a: 5 }),
      giocatore({ id: 2, r: 'D', qt_a: 40 }),
    ];

    expect(valutaBudget(mia, lista, null).fabbisogno).toBe(40);
  });

  it('segnala il deficit quando i crediti non bastano', () => {
    const mia = avversario({ creditiResidui: 50, slotLiberi: { P: 0, D: 3, C: 0, A: 0 } });
    const verdict = valutaBudget(mia, targets(3, 'D', 40), null);

    expect(verdict.fabbisogno).toBe(120);
    expect(verdict.deficit).toBe(70);
  });

  it('il deficit non è mai negativo', () => {
    /** Un deficit negativo verrebbe letto come "ti avanzano crediti", che è
     * un'informazione diversa e non è quel che questo campo dice. */
    const mia = avversario({ creditiResidui: 500, slotLiberi: { P: 0, D: 1, C: 0, A: 0 } });

    expect(valutaBudget(mia, targets(1, 'D', 10), null).deficit).toBe(0);
  });

  it('dice quando la lista non copre nemmeno il reparto', () => {
    /**
     * Un problema diverso dal deficit e altrettanto reale: hai i crediti ma non
     * hai chi comprare, e all'asta te ne accorgi quando restano solo gli scarti.
     */
    const mia = avversario({ slotLiberi: { P: 3, D: 0, C: 0, A: 0 } });
    const verdict = valutaBudget(mia, targets(1, 'P', 10), null);

    const portieri = verdict.perRuolo.find((r) => r.ruolo === 'P');
    expect(portieri?.scoperto).toBe(true);
    expect(portieri?.disponibili).toBe(1);
    expect(portieri?.slotLiberi).toBe(3);
  });

  it('l’inflazione alza il fabbisogno', () => {
    const mia = avversario({ slotLiberi: { P: 0, D: 2, C: 0, A: 0 } });

    const senza = valutaBudget(mia, targets(2, 'D', 20), null).fabbisogno;
    const con = valutaBudget(mia, targets(2, 'D', 20), 1.5).fabbisogno;

    expect(senza).toBe(40);
    expect(con).toBe(60);
  });
});

describe('alternative', () => {
  it('propone il miglior rendimento entro il tetto', () => {
    const target = giocatore({ id: 1, r: 'D', qt_a: 40, fvm: 100 });
    const liberi = [
      giocatore({ id: 2, r: 'D', qt_a: 10, fvm: 70 }),
      giocatore({ id: 3, r: 'D', qt_a: 10, fvm: 55 }),
      giocatore({ id: 4, r: 'D', qt_a: 35, fvm: 95 }), // fuori tetto
    ];

    const scelti = alternativeEntroIlTetto(target, liberi, 12, null);

    expect(scelti.map((p) => p.id)).toEqual([2, 3]);
  });

  it('non propone chi vale meno della metà', () => {
    /** Un sostituto da 30 al posto di uno da 100 non è un'alternativa, è un
     * ripiego: proporlo farebbe sembrare risolto un problema che resta. */
    const target = giocatore({ id: 1, r: 'D', qt_a: 40, fvm: 100 });
    const scadente = [giocatore({ id: 2, r: 'D', qt_a: 5, fvm: 30 })];

    expect(alternativeEntroIlTetto(target, scadente, 12, null)).toEqual([]);
  });

  it('resta nel ruolo del target', () => {
    /** Un attaccante non sostituisce un difensore: sono slot diversi. */
    const target = giocatore({ id: 1, r: 'D', qt_a: 40, fvm: 100 });
    const attaccanti = [giocatore({ id: 2, r: 'A', qt_a: 10, fvm: 90 })];

    expect(alternativeEntroIlTetto(target, attaccanti, 12, null)).toEqual([]);
  });

  it('propone solo per i target davvero fuori portata', () => {
    const mia = avversario({ creditiResidui: 100, slotLiberi: { P: 0, D: 10, C: 0, A: 0 } });
    const caro = giocatore({ id: 1, r: 'D', qt_a: 40, fvm: 100 });
    const abbordabile = giocatore({ id: 2, r: 'D', qt_a: 5, fvm: 40 });
    const verdict = valutaBudget(mia, [caro, abbordabile], null);

    // Tetto = 100 crediti / 10 slot = 10 a testa.
    const proposte = proponiAlternative(verdict, mia, [caro, abbordabile], []);

    expect(proposte.map((a) => a.target.id)).toEqual([1]);
  });

  it('a rosa completa non propone niente', () => {
    const pieno = avversario({ slotLiberi: { P: 0, D: 0, C: 0, A: 0 } });
    const verdict = valutaBudget(pieno, [giocatore()], null);

    expect(proponiAlternative(verdict, pieno, [giocatore()], [])).toEqual([]);
  });
});
