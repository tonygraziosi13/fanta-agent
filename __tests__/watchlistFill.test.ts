import type { Category } from '@/domain/category';
import type { Opponent } from '@/domain/opponent';
import type { Player } from '@/domain/player';
import type { ClassicRole } from '@/domain/roles';
import {
  fasciaPer,
  proponiRiempimento,
  strategiaPerCategoria,
  valorePerCredito,
} from '@/domain/watchlistFill';

/**
 * Riempimento automatico della watchlist.
 *
 * Il rischio qui non è un errore di calcolo ma un consiglio inappropriato: una
 * lista di esclusione riempita da sola, cinque attaccanti a chi cerca un
 * portiere, o un nome già scelto riproposto come se fosse nuovo. Sono tutte
 * cose che non sollevano niente e fanno smettere di fidarsi dello strumento.
 */

function giocatore(overrides: Partial<Player> = {}): Player {
  return {
    id: 1,
    r: 'D',
    rm: 'Dc',
    nome: 'Bastoni',
    squadra: 'Inter',
    qt_a: 15,
    qt_i: 14,
    diff: 1,
    qt_a_m: 16,
    qt_i_m: 15,
    diff_m: 1,
    fvm: 45,
    fvm_m: 50,
    is_active: true,
    ...overrides,
  };
}

function categoria(name: string, id = 1): Category {
  return { id, name, color: '#22C55E', sort_order: 0, is_default: true };
}

function mia(overrides: Partial<Opponent> = {}): Opponent {
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

describe('strategia per categoria', () => {
  it('riconosce le predefinite', () => {
    expect(strategiaPerCategoria('Must-Have')).toBe('punta');
    expect(strategiaPerCategoria('Alternative')).toBe('equilibrio');
    expect(strategiaPerCategoria('Scommesse')).toBe('scommessa');
    expect(strategiaPerCategoria('Da Evitare')).toBe('nessuna');
  });

  it('sopravvive a una rinominazione', () => {
    /** L'utente può chiamarla "Scommesse low cost" senza che il riconoscimento
     * si rompa: si cerca la parola chiave, non l'uguaglianza. */
    expect(strategiaPerCategoria('Scommesse low cost')).toBe('scommessa');
    expect(strategiaPerCategoria('I miei must')).toBe('punta');
  });

  it('un nome inventato ricade sull’equilibrio', () => {
    /** Interpretare "Titolari da 6 in pagella" è un lavoro di lingua che serve
     * un LLM: meglio un comportamento prevedibile e dichiarato che indovinare. */
    expect(strategiaPerCategoria('Titolari da 6 in pagella')).toBe('equilibrio');
  });
});

describe('fasce di prezzo', () => {
  it('una punta costa più della media per slot', () => {
    const fascia = fasciaPer('punta', 20);

    expect(fascia.min).toBeGreaterThan(20);
    expect(fascia.max).toBe(100);
  });

  it('una scommessa sta sotto la metà', () => {
    expect(fasciaPer('scommessa', 20).max).toBe(10);
    expect(fasciaPer('scommessa', 20).min).toBe(1);
  });

  it('con un budget minuscolo le fasce non degenerano', () => {
    /** Con 1 credito per slot, min e max collasserebbero a zero e nessuno
     * rientrerebbe in nessuna fascia: la lista uscirebbe vuota senza motivo. */
    const fascia = fasciaPer('scommessa', 0);

    expect(fascia.max).toBeGreaterThanOrEqual(2);
    expect(fascia.min).toBeGreaterThanOrEqual(1);
  });
});

describe('proposte', () => {
  it('non riempie mai una lista di esclusione', () => {
    /**
     * Popolare "Da Evitare" in automatico significherebbe suggerire di scartare
     * giocatori mai valutati: l'esatto contrario di quel che quella categoria
     * serve a ricordare.
     */
    const [proposta] = proponiRiempimento(
      [categoria('Da Evitare')],
      [giocatore()],
      mia(),
      new Set()
    );

    expect(proposta!.giocatori).toEqual([]);
    expect(proposta!.motivo).toContain('esclusione');
  });

  it('non ripropone chi è già in watchlist', () => {
    const liberi = [giocatore({ id: 1 }), giocatore({ id: 2 })];

    const [proposta] = proponiRiempimento(
      [categoria('Alternative')],
      liberi,
      mia(),
      new Set([1])
    );

    expect(proposta!.giocatori.map((p) => p.id)).toEqual([2]);
  });

  it('propone solo nei ruoli che hanno ancora posto', () => {
    /** Cinque attaccanti a chi ha il reparto pieno e cerca un portiere è un
     * consiglio che fa perdere tempo nel momento peggiore. */
    // Crediti proporzionati agli slot, o la fascia di prezzo escluderebbe
    // entrambi e il test non direbbe niente sul filtro dei ruoli.
    const soloPortieri = mia({ creditiResidui: 40, slotLiberi: { P: 2, D: 0, C: 0, A: 0 } });
    const liberi = [
      giocatore({ id: 1, r: 'A', qt_a: 20 }),
      giocatore({ id: 2, r: 'P', qt_a: 20 }),
    ];

    const [proposta] = proponiRiempimento(
      [categoria('Alternative')],
      liberi,
      soloPortieri,
      new Set()
    );

    expect(proposta!.giocatori.map((p) => p.r)).toEqual(['P']);
  });

  it('una punta ordina per rendimento assoluto', () => {
    /** Si paga per avere il migliore, non il più conveniente. */
    const grosso = mia({ creditiResidui: 100, slotLiberi: { P: 0, D: 5, C: 0, A: 0 } });
    const liberi = [
      giocatore({ id: 1, r: 'D', qt_a: 40, fvm: 90 }),
      giocatore({ id: 2, r: 'D', qt_a: 35, fvm: 120 }),
    ];

    const [proposta] = proponiRiempimento([categoria('Must-Have')], liberi, grosso, new Set());

    expect(proposta!.giocatori[0]!.id).toBe(2);
  });

  it('una scommessa ordina per valore per credito', () => {
    const grosso = mia({ creditiResidui: 200, slotLiberi: { P: 0, D: 10, C: 0, A: 0 } });
    const liberi = [
      giocatore({ id: 1, r: 'D', qt_a: 10, fvm: 30 }), // 3.0 per credito
      giocatore({ id: 2, r: 'D', qt_a: 2, fvm: 20 }), // 10.0 per credito
    ];

    const [proposta] = proponiRiempimento([categoria('Scommesse')], liberi, grosso, new Set());

    expect(proposta!.giocatori[0]!.id).toBe(2);
    expect(valorePerCredito(liberi[1]!, null)).toBeGreaterThan(valorePerCredito(liberi[0]!, null));
  });

  it('dice perché non ha niente da proporre', () => {
    /** Un elenco vuoto senza spiegazione sembra uno strumento rotto. */
    const [proposta] = proponiRiempimento(
      [categoria('Must-Have')],
      [giocatore({ qt_a: 1, fvm: 2 })],
      mia(),
      new Set()
    );

    expect(proposta!.giocatori).toEqual([]);
    expect(proposta!.motivo).toContain('Nessuno svincolato');
  });

  it('a rosa completa non propone niente', () => {
    const pieno = mia({ slotLiberi: { P: 0, D: 0, C: 0, A: 0 } });

    const [proposta] = proponiRiempimento(
      [categoria('Alternative')],
      [giocatore()],
      pieno,
      new Set()
    );

    expect(proposta!.motivo).toContain('completa');
  });

  it('l’ordine è stabile a parità di valore', () => {
    /** Una lista che si riordina da sola fra due aperture non si legge. */
    const liberi = [
      giocatore({ id: 7, r: 'D', qt_a: 15, fvm: 45 }),
      giocatore({ id: 3, r: 'D', qt_a: 15, fvm: 45 }),
    ];

    const proponi = () =>
      proponiRiempimento([categoria('Alternative')], liberi, mia(), new Set())[0]!.giocatori.map(
        (p) => p.id
      );

    expect(proponi()).toEqual([3, 7]);
    expect(proponi()).toEqual(proponi());
  });

  it('l’inflazione sposta chi rientra in fascia', () => {
    /** Con il tavolo che paga il doppio, un giocatore da 8 costa 16 ed esce
     * dalla fascia delle scommesse: proporlo sarebbe un consiglio già scaduto. */
    const grosso = mia({ creditiResidui: 200, slotLiberi: { P: 0, D: 10, C: 0, A: 0 } });
    const liberi = [giocatore({ id: 1, r: 'D', qt_a: 8, fvm: 30 })];

    const senza = proponiRiempimento([categoria('Scommesse')], liberi, grosso, new Set());
    const con = proponiRiempimento([categoria('Scommesse')], liberi, grosso, new Set(), {
      inflazione: 2,
    });

    expect(senza[0]!.giocatori).toHaveLength(1);
    expect(con[0]!.giocatori).toHaveLength(0);
  });
});
