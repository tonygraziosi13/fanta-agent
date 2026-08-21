import { annullaAcquisto, registraAcquisto } from '@/core/middleware/hooks/auctionHook';
import { offertaMassima } from '@/domain/opponent';
import type { Opponent } from '@/domain/opponent';
import type { Player } from '@/domain/player';
import {
  budgetMedioPerSlot,
  partizionaAggiudicati,
  presiDaQualcuno,
  proprietarioDi,
  selectSvincolati,
} from '@/state/auctionSelectors';
import type { CategoryGroup } from '@/state/selectors';
import { useOpponentsStore } from '@/state/useOpponentsStore';
import { usePlayersStore } from '@/state/usePlayersStore';

/**
 * Motore di Transazione e selettori dell'asta.
 *
 * La validazione è l'unica cosa che sta fra un'asta corretta e una rosa
 * impossibile, e i suoi errori non si vedono subito: un giocatore in due rose o
 * un reparto sforato si scoprono a fine asta, quando non si può più rimediare.
 *
 * `effect` non viene esercitato: scrive su SQLite, che in questa suite non
 * esiste. Si verifica `validate` (il rifiuto) e `reduce` (crediti e slot che
 * scalano nello stesso frame), che è dove sta la logica.
 */

function giocatore(overrides: Partial<Player> = {}): Player {
  return {
    id: 1,
    r: 'D',
    rm: 'Dc',
    nome: 'Bastoni',
    squadra: 'Inter',
    qt_a: 17,
    qt_i: 16,
    diff: 1,
    qt_a_m: 18,
    qt_i_m: 17,
    diff_m: 1,
    fvm: 40,
    fvm_m: 45,
    is_active: true,
    ...overrides,
  };
}

function avversario(overrides: Partial<Opponent> = {}): Opponent {
  return {
    id: 10,
    configId: 1,
    nome: 'Atletico Bar',
    proprietario: 'Marco',
    isMe: false,
    creditiResidui: 500,
    slotLiberi: { P: 3, D: 8, C: 8, A: 6 },
    rosa: [],
    ...overrides,
  };
}

function prepara(players: Player[], opponents: Opponent[]) {
  usePlayersStore.setState({
    players,
    byId: Object.fromEntries(players.map((p) => [p.id, p])),
    status: 'ready',
    error: null,
  });
  useOpponentsStore.setState({ items: opponents, configId: 1, loading: false, error: null });
}

describe('validazione della transazione', () => {
  it('accetta un acquisto legittimo', () => {
    prepara([giocatore()], [avversario()]);

    expect(registraAcquisto(1, 30, 10, 'D').ok).toBe(true);
  });

  it('rifiuta un giocatore inesistente', () => {
    prepara([], [avversario()]);

    const esito = registraAcquisto(99, 10, 10, 'D');
    expect(esito.ok).toBe(false);
    expect(esito.reason).toContain('inesistente');
  });

  it('rifiuta un ruolo che non è quello del giocatore', () => {
    /**
     * Sbagliare il ruolo scalerebbe lo slot del reparto sbagliato e lascerebbe
     * l'altro pieno: un errore che si scopre solo a rosa completa.
     */
    prepara([giocatore({ r: 'A' })], [avversario()]);

    const esito = registraAcquisto(1, 30, 10, 'D');
    expect(esito.ok).toBe(false);
    expect(esito.reason).toContain('non un D');
  });

  it('rifiuta un giocatore già aggiudicato', () => {
    /** In asta capita di registrare due volte lo stesso nome: senza il controllo
     * finirebbe in due rose. */
    prepara(
      [giocatore()],
      [avversario(), avversario({ id: 11, nome: 'Altro', rosa: [{ playerId: 1, prezzo: 20 }] })]
    );

    const esito = registraAcquisto(1, 30, 10, 'D');
    expect(esito.ok).toBe(false);
    expect(esito.reason).toContain('aggiudicato');
  });

  it('rifiuta quando il reparto è pieno', () => {
    prepara([giocatore()], [avversario({ slotLiberi: { P: 3, D: 0, C: 8, A: 6 } })]);

    const esito = registraAcquisto(1, 10, 10, 'D');
    expect(esito.ok).toBe(false);
    expect(esito.reason).toContain('reparto D');
  });

  it('rifiuta solo oltre i crediti disponibili', () => {
    /**
     * Con 100 crediti si può arrivare a 100, anche restando con nove caselle
     * vuote: completare la rosa è una regola di lega, non un'invariante che il
     * motore debba imporre. Quel che il motore deve garantire è che la
     * schermata e la validazione dicano la stessa cosa — entrambe passano da
     * `offertaMassima`.
     */
    const opp = avversario({ creditiResidui: 100, slotLiberi: { P: 1, D: 3, C: 3, A: 3 } });
    prepara([giocatore()], [opp]);

    expect(offertaMassima(opp)).toBe(100);
    expect(registraAcquisto(1, 101, 10, 'D').ok).toBe(false);
    expect(registraAcquisto(1, 100, 10, 'D').ok).toBe(true);
  });

  it('rifiuta un costo negativo o non numerico', () => {
    prepara([giocatore()], [avversario()]);

    expect(registraAcquisto(1, -5, 10, 'D').ok).toBe(false);
    expect(registraAcquisto(1, Number.NaN, 10, 'D').ok).toBe(false);
  });

  it('rifiuta un partecipante inesistente', () => {
    prepara([giocatore()], [avversario()]);

    expect(registraAcquisto(1, 10, 999, 'D').ok).toBe(false);
  });

  it('un rifiuto non tocca lo stato', () => {
    /** Se `validate` lasciasse passare l'aggiornamento, i crediti scenderebbero
     * per un acquisto mai avvenuto. */
    prepara([giocatore()], [avversario({ creditiResidui: 50 })]);

    registraAcquisto(1, 500, 10, 'D');

    const dopo = useOpponentsStore.getState().items[0]!;
    expect(dopo.creditiResidui).toBe(50);
    expect(dopo.rosa).toHaveLength(0);
  });
});

describe('effetto sullo stato in memoria', () => {
  it('scala crediti e slot e aggiunge alla rosa', () => {
    prepara([giocatore()], [avversario({ creditiResidui: 500 })]);

    registraAcquisto(1, 63, 10, 'D');

    const dopo = useOpponentsStore.getState().items[0]!;
    expect(dopo.creditiResidui).toBe(437);
    expect(dopo.slotLiberi.D).toBe(7);
    // Gli altri reparti non si toccano.
    expect(dopo.slotLiberi.P).toBe(3);
    expect(dopo.rosa).toEqual([{ playerId: 1, prezzo: 63 }]);
  });

  it('tocca solo il partecipante indicato', () => {
    prepara([giocatore()], [avversario(), avversario({ id: 11, nome: 'Altro' })]);

    registraAcquisto(1, 20, 11, 'D');

    const [primo, secondo] = useOpponentsStore.getState().items;
    expect(primo!.creditiResidui).toBe(500);
    expect(secondo!.creditiResidui).toBe(480);
  });
});

describe('annullamento', () => {
  it('restituisce crediti e slot', () => {
    /**
     * Un tocco sbagliato in asta è comune — un nome simile, una cifra digitata
     * di fretta. Senza annullamento l'unico rimedio sarebbe reimportare lo
     * stato, perdendo tutta la sessione.
     */
    prepara([giocatore()], [avversario({ creditiResidui: 500 })]);
    registraAcquisto(1, 63, 10, 'D');

    const esito = annullaAcquisto(1, 10, 'D');

    expect(esito.ok).toBe(true);
    const dopo = useOpponentsStore.getState().items[0]!;
    expect(dopo.creditiResidui).toBe(500);
    expect(dopo.slotLiberi.D).toBe(8);
    expect(dopo.rosa).toHaveLength(0);
  });

  it('restituisce il prezzo registrato, non uno passato da fuori', () => {
    /**
     * È l'unico numero che sappiamo essere stato scalato davvero: usarne un
     * altro lascerebbe i crediti sfasati per sempre, e nessuno se ne
     * accorgerebbe fino a fine asta.
     */
    prepara([giocatore()], [avversario({ creditiResidui: 300 })]);
    registraAcquisto(1, 77, 10, 'D');
    annullaAcquisto(1, 10, 'D');

    expect(useOpponentsStore.getState().items[0]!.creditiResidui).toBe(300);
  });

  it('rifiuta se quel giocatore non è in quella rosa', () => {
    prepara([giocatore()], [avversario()]);

    const esito = annullaAcquisto(1, 10, 'D');

    expect(esito.ok).toBe(false);
    expect(esito.reason).toContain('non risulta');
  });

  it('dopo l’annullamento il giocatore torna svincolato', () => {
    /** Lo stato di svincolato è derivato: se l'annullamento non togliesse dalla
     * rosa, il giocatore resterebbe invendibile per sempre. */
    prepara([giocatore()], [avversario()]);
    registraAcquisto(1, 20, 10, 'D');
    annullaAcquisto(1, 10, 'D');

    const opponents = useOpponentsStore.getState().items;
    expect(selectSvincolati([giocatore()], opponents).map((p) => p.id)).toEqual([1]);
  });

  it('non serve avere slot liberi per annullare', () => {
    /** Si sta restituendo, non spendendo: applicare le regole dell'acquisto
     * bloccherebbe l'annullamento proprio a reparto completo, cioè quando
     * l'errore fa più danno. */
    prepara([giocatore()], [avversario({ slotLiberi: { P: 3, D: 1, C: 8, A: 6 } })]);
    registraAcquisto(1, 10, 10, 'D');
    expect(useOpponentsStore.getState().items[0]!.slotLiberi.D).toBe(0);

    expect(annullaAcquisto(1, 10, 'D').ok).toBe(true);
  });
});

describe('selettori', () => {
  it('svincolato è chi non compare in nessuna rosa', () => {
    const players = [giocatore({ id: 1 }), giocatore({ id: 2 }), giocatore({ id: 3 })];
    const opponents = [avversario({ rosa: [{ playerId: 2, prezzo: 10 }] })];

    expect(selectSvincolati(players, opponents).map((p) => p.id)).toEqual([1, 3]);
  });

  it('chi ha lasciato la Serie A non è "libero"', () => {
    /** `is_active = false` significa ceduto fuori dal campionato: non è
     * disponibile, è proprio non acquistabile. */
    const players = [giocatore({ id: 1 }), giocatore({ id: 2, is_active: false })];

    expect(selectSvincolati(players, []).map((p) => p.id)).toEqual([1]);
  });

  it('l’indice dei presi raccoglie tutte le rose', () => {
    const opponents = [
      avversario({ id: 10, rosa: [{ playerId: 1, prezzo: 5 }] }),
      avversario({ id: 11, rosa: [{ playerId: 2, prezzo: 5 }] }),
    ];

    expect([...presiDaQualcuno(opponents)].sort()).toEqual([1, 2]);
  });

  it('dice chi ha comprato un giocatore', () => {
    const opponents = [avversario({ nome: 'Atletico Bar', rosa: [{ playerId: 7, prezzo: 30 }] })];

    expect(proprietarioDi(7, opponents)?.nome).toBe('Atletico Bar');
    expect(proprietarioDi(8, opponents)).toBeUndefined();
  });

  it('il budget medio per slot dice se un’offerta è sostenibile', () => {
    /** 300 crediti su 20 slot sono 15 a testa: puntarne 80 su uno significa
     * accettarne diciannove da otto. */
    const opp = avversario({ creditiResidui: 300, slotLiberi: { P: 2, D: 6, C: 6, A: 6 } });

    expect(budgetMedioPerSlot(opp)).toBe(15);
  });

  it('a rosa completa non c’è un budget per slot', () => {
    const pieno = avversario({ slotLiberi: { P: 0, D: 0, C: 0, A: 0 } });

    expect(budgetMedioPerSlot(pieno)).toBeNull();
  });
});

describe('auto-pulizia della watchlist', () => {
  /**
   * Chi è già stato venduto sparisce dalla vista della watchlist. È il percorso
   * più caldo dell'app: durante un'asta la si scorre per scegliere il prossimo
   * obiettivo, e un nome non più acquistabile costa un'occhiata e mezza
   * decisione.
   */
  function gruppo(nome: string, players: Player[]): CategoryGroup {
    return {
      category: { id: 1, name: nome, color: '#22C55E', sort_order: 0, is_default: true },
      players,
      count: players.length,
    };
  }

  it('toglie dalla vista chi è già stato aggiudicato', () => {
    const gruppi = [gruppo('Must-Have', [giocatore({ id: 1 }), giocatore({ id: 2 })])];

    const { visibili, aggiudicati } = partizionaAggiudicati(gruppi, new Set([2]));

    expect(visibili[0]!.players.map((p) => p.id)).toEqual([1]);
    expect(aggiudicati.map((p) => p.id)).toEqual([2]);
  });

  it('il conteggio della categoria segue quel che si vede', () => {
    /** Altrimenti la pastiglia direbbe 2 accanto a una riga sola, e il numero
     * e l'elenco si smentirebbero a vicenda. */
    const gruppi = [gruppo('Must-Have', [giocatore({ id: 1 }), giocatore({ id: 2 })])];

    const { visibili } = partizionaAggiudicati(gruppi, new Set([2]));

    expect(visibili[0]!.count).toBe(1);
  });

  it('senza nessun aggiudicato non ricostruisce i gruppi', () => {
    /** I riferimenti restano stabili, così il `memo` sulle righe non si sveglia
     * per niente: è il percorso normale prima che l'asta cominci. */
    const gruppi = [gruppo('Must-Have', [giocatore({ id: 1 })])];

    const { visibili, aggiudicati } = partizionaAggiudicati(gruppi, new Set());

    expect(visibili[0]).toBe(gruppi[0]);
    expect(aggiudicati).toEqual([]);
  });

  it('una categoria svuotata resta, con zero', () => {
    /** Far sparire la sezione nasconderebbe all'utente che la categoria esiste
     * ancora — la stessa ragione per cui `selectGroupedWatchlist` restituisce
     * anche le categorie vuote. */
    const gruppi = [gruppo('Must-Have', [giocatore({ id: 1 })])];

    const { visibili } = partizionaAggiudicati(gruppi, new Set([1]));

    expect(visibili).toHaveLength(1);
    expect(visibili[0]!.count).toBe(0);
  });

  it('l’assegnazione non viene toccata: si nasconde, non si cancella', () => {
    /**
     * Un'aggiudicazione si può annullare, e il giocatore deve tornare nella
     * categoria che gli avevi dato. I gruppi in ingresso restano intatti.
     */
    const originali = [gruppo('Must-Have', [giocatore({ id: 1 }), giocatore({ id: 2 })])];

    partizionaAggiudicati(originali, new Set([1, 2]));

    expect(originali[0]!.players).toHaveLength(2);
    expect(originali[0]!.count).toBe(2);
  });
});
