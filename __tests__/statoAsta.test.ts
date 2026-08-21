import { countMine, parseStatoAsta } from '@/core/parsing/statoAstaParser';
import { offertaMassima, rowToOpponent, slotRimanenti } from '@/domain/opponent';
import type { OpponentDbRow } from '@/domain/opponent';

/**
 * Lettura del seme `stato_asta.json` e modello degli avversari.
 *
 * Il file arriva da uno scraper che gira su un'altra macchina, contro un sito
 * che cambia senza preavviso: e' la definizione di dato non fidato. Qui si fissa
 * come si degrada — quale riga si scarta, quale file si rifiuta in blocco — e
 * l'aritmetica che l'agente non deve rifare da solo.
 */

function squadra(overrides: Record<string, unknown> = {}) {
  return {
    nome_squadra: 'Atletico Bar',
    proprietario: 'Marco',
    sono_io: false,
    crediti_residui: 500,
    slot_liberi: { P: 3, D: 8, C: 8, A: 6 },
    rosa: [],
    ...overrides,
  };
}

function json(...squadre: Record<string, unknown>[]): string {
  return JSON.stringify(squadre);
}

describe('parseStatoAsta', () => {
  it('legge una squadra completa', () => {
    const outcome = parseStatoAsta(json(squadra()));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const team = outcome.value.teams[0];
    expect(team?.nome).toBe('Atletico Bar');
    expect(team?.proprietario).toBe('Marco');
    expect(team?.creditiResidui).toBe(500);
    expect(team?.slotLiberi).toEqual({ P: 3, D: 8, C: 8, A: 6 });
  });

  it('distingue un JSON invalido da una forma sbagliata', () => {
    const rotto = parseStatoAsta('{ non è json');
    const forma = parseStatoAsta('{"squadre": []}');

    expect(rotto.ok).toBe(false);
    expect(forma.ok).toBe(false);
    if (rotto.ok || forma.ok) return;
    expect(rotto.error).toContain('JSON');
    expect(forma.error).toContain('array');
  });

  it('rifiuta un file vuoto invece di svuotare l’asta', () => {
    /**
     * Un array vuoto scritto sopra un'asta in corso cancellerebbe crediti e
     * rose di tutti: e' quasi sempre uno scraper andato male, non una lega
     * senza partecipanti.
     */
    const outcome = parseStatoAsta('[]');

    expect(outcome.ok).toBe(false);
  });

  it('scarta la riga rotta, non il file', () => {
    /**
     * In asta un import a metà che lo dichiara vale più di un import fallito:
     * un partecipante coi crediti illeggibili non deve impedire di caricare
     * gli altri otto. Stessa regola di `datasetMapper` coi giocatori.
     */
    const outcome = parseStatoAsta(
      json(
        squadra({ nome_squadra: 'Buona' }),
        squadra({ nome_squadra: 'Rotta', crediti_residui: 'tanti' }),
        squadra({ nome_squadra: 'Anche buona' })
      )
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.teams).toHaveLength(2);
    expect(outcome.value.skipped).toHaveLength(1);
    expect(outcome.value.skipped[0]?.nome).toBe('Rotta');
  });

  it('scarta chi non ha tutti gli slot per ruolo', () => {
    /**
     * Uno slot mancante non vale zero: zero significa "reparto completo", ed è
     * l'opposto di "non lo sappiamo". Assumerlo farebbe credere all'agente che
     * quell'avversario non può più comprare portieri.
     */
    const outcome = parseStatoAsta(json(squadra({ slot_liberi: { P: 3, D: 8, C: 8 } })));

    expect(outcome.ok).toBe(false);
  });

  it('scarta i nomi duplicati', () => {
    /**
     * `opponents` ha UNIQUE(config_id, nome): due righe uguali farebbero
     * fallire l'intera transazione di import invece di una riga sola.
     */
    const outcome = parseStatoAsta(json(squadra(), squadra()));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.teams).toHaveLength(1);
    expect(outcome.value.skipped[0]?.reason).toContain('duplicato');
  });

  it('normalizza il nome e tratta il proprietario vuoto come assente', () => {
    const outcome = parseStatoAsta(
      json(squadra({ nome_squadra: '  Atletico   Bar ', proprietario: '  ' }))
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.teams[0]?.nome).toBe('Atletico Bar');
    expect(outcome.value.teams[0]?.proprietario).toBeNull();
  });

  it('legge la rosa e scarta gli acquisti senza id', () => {
    const outcome = parseStatoAsta(
      json(
        squadra({
          rosa: [{ id: 5841, prezzo: 63 }, { prezzo: 10 }, { id: 4964 }],
        })
      )
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const rosa = outcome.value.teams[0]?.rosa ?? [];
    expect(rosa).toHaveLength(2);
    expect(rosa[0]).toEqual({ playerId: 5841, prezzo: 63 });
    // Prezzo assente resta null: non è "pagato zero".
    expect(rosa[1]).toEqual({ playerId: 4964, prezzo: null });
  });

  it('conta le squadre marcate come proprie', () => {
    const outcome = parseStatoAsta(
      json(squadra({ sono_io: true }), squadra({ nome_squadra: 'Altra' }))
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(countMine(outcome.value.teams)).toBe(1);
  });
});

describe('modello degli avversari', () => {
  function row(overrides: Partial<OpponentDbRow> = {}): OpponentDbRow {
    return {
      id: 1,
      config_id: 7,
      nome: 'Atletico Bar',
      proprietario: 'Marco',
      is_me: 0,
      crediti: 500,
      slot_p: 3,
      slot_d: 8,
      slot_c: 8,
      slot_a: 6,
      rosa: null,
      updated_at: 0,
      ...overrides,
    };
  }

  it('traduce la riga piatta in oggetto annidato', () => {
    const opponent = rowToOpponent(row({ is_me: 1, rosa: '[{"playerId":1,"prezzo":5}]' }));

    expect(opponent.isMe).toBe(true);
    expect(opponent.slotLiberi).toEqual({ P: 3, D: 8, C: 8, A: 6 });
    expect(opponent.rosa).toEqual([{ playerId: 1, prezzo: 5 }]);
  });

  it('una rosa corrotta degrada a vuota invece di far esplodere la schermata', () => {
    expect(rowToOpponent(row({ rosa: '{ rotto' })).rosa).toEqual([]);
  });

  it('somma gli slot rimanenti', () => {
    expect(slotRimanenti(rowToOpponent(row()))).toBe(25);
  });

  it('l’offerta massima tiene un credito per ogni slot ancora da riempire', () => {
    /**
     * È il numero che dice se un avversario può davvero rilanciare. Non è il
     * totale dei crediti: con 500 crediti e 25 slot da riempire, il massimo su
     * un singolo giocatore è 476, perché gli altri 24 posti vanno coperti.
     */
    expect(offertaMassima(rowToOpponent(row()))).toBe(476);
  });

  it('con un solo slot libero può spendere tutto', () => {
    const uno = rowToOpponent(row({ slot_p: 1, slot_d: 0, slot_c: 0, slot_a: 0 }));

    expect(offertaMassima(uno)).toBe(500);
  });

  it('a rosa completa non può offrire niente', () => {
    const pieno = rowToOpponent(row({ slot_p: 0, slot_d: 0, slot_c: 0, slot_a: 0 }));

    expect(offertaMassima(pieno)).toBe(0);
  });

  it('non produce un’offerta negativa quando i crediti non bastano', () => {
    /**
     * Succede in leghe che permettono di scendere sotto: un numero negativo
     * verrebbe letto dall'agente come un rilancio possibile all'incontrario.
     */
    const spiantato = rowToOpponent(row({ crediti: 2, slot_p: 3, slot_d: 3, slot_c: 0, slot_a: 0 }));

    expect(offertaMassima(spiantato)).toBe(0);
  });
});

describe('fusione contro sostituzione', () => {
  /**
   * `mergeOpponents` tocca SQLite e resta fuori da questa suite; quel che si
   * fissa qui è la **regola di riconoscimento** su cui si appoggia: due grafie
   * dello stesso nome sono la stessa squadra.
   *
   * Se il confronto fosse letterale, "Atletico  Bar" con due spazi verrebbe
   * inserita accanto a "Atletico Bar" — un doppione con la rosa vuota di fianco
   * a quella vera, e i crediti dell'una che non c'entrano niente con l'altra.
   */
  function chiaveNome(nome: string): string {
    return nome.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  it('riconosce la stessa squadra scritta in modo diverso', () => {
    expect(chiaveNome('  Atletico   BAR ')).toBe(chiaveNome('atletico bar'));
  });

  it('tiene distinte due squadre diverse', () => {
    expect(chiaveNome('Atletico Bar')).not.toBe(chiaveNome('Atletico Barre'));
  });

  it('il seme resta leggibile anche quando le squadre sono già al tavolo', () => {
    /**
     * Il pulsante "Aggiorna la lega" ripassa dallo stesso parser dell'import:
     * se il seme smettesse di essere valido, il messaggio d'errore arriverebbe
     * prima di toccare il database.
     */
    const outcome = parseStatoAsta(json(squadra(), squadra({ nome_squadra: 'Nuova' })));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.teams.map((t) => t.nome)).toEqual(['Atletico Bar', 'Nuova']);
  });
});
