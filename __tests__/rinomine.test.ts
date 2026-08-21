import { abbinaRinomine, chiaveNome } from '@/domain/opponent';

/**
 * Riconoscimento delle squadre rinominate.
 *
 * È l'unico punto in cui l'app cambia l'identità di un avversario già al
 * tavolo, e sbagliarlo non fa rumore: un accoppiamento sbagliato sposta una
 * rosa costruita in due ore sulla squadra di un altro, e non accoppiare affatto
 * mette la stessa persona due volte in gara con i crediti pieni. Nessuno dei
 * due si scopre finché non si guarda chi può ancora rilanciare.
 */

function squadra(nome: string, proprietario: string | null = null) {
  return { nome, proprietario };
}

describe('abbina rinomine', () => {
  it('riconosce il cambio di nome dal proprietario', () => {
    /** Il caso vero: ginso ribattezza "COCO FANS" in "FRATELLI MANNA SRL". */
    const abbinate = abbinaRinomine(
      [squadra('FRATELLI MANNA SRL', 'ginso')],
      [squadra('COCO FANS', 'ginso')]
    );

    expect(abbinate).toHaveLength(1);
    expect(abbinate[0]!.vecchia.nome).toBe('COCO FANS');
    expect(abbinate[0]!.nuova.nome).toBe('FRATELLI MANNA SRL');
  });

  it('proprietari diversi restano squadre diverse', () => {
    expect(abbinaRinomine([squadra('TMM', 'Mario')], [squadra('COCO FANS', 'ginso')])).toEqual([]);
  });

  it('senza proprietario non accoppia niente', () => {
    /**
     * Un proprietario vuoto accomunerebbe fra loro tutte le squadre di cui non
     * sappiamo nulla: è l'assenza di prova, non una prova.
     */
    expect(abbinaRinomine([squadra('Nuova', null)], [squadra('Vecchia', null)])).toEqual([]);
    expect(abbinaRinomine([squadra('Nuova', '  ')], [squadra('Vecchia', '  ')])).toEqual([]);
  });

  it('con due candidate dello stesso proprietario non indovina', () => {
    /**
     * Non c'è modo di sapere quale sia diventata quale, e spostare una rosa
     * sull'ipotesi sbagliata è irreversibile: meglio due righe e la decisione
     * all'utente.
     */
    const abbinate = abbinaRinomine(
      [squadra('Terza', 'ginso')],
      [squadra('Prima', 'ginso'), squadra('Seconda', 'ginso')]
    );

    expect(abbinate).toEqual([]);
  });

  it('nemmeno con due squadre nuove dello stesso proprietario', () => {
    /** L'ambiguità vale in entrambe le direzioni. */
    const abbinate = abbinaRinomine(
      [squadra('Alfa', 'ginso'), squadra('Beta', 'ginso')],
      [squadra('Vecchia', 'ginso')]
    );

    expect(abbinate).toEqual([]);
  });

  it('il proprietario si confronta normalizzato', () => {
    /** Il sito può cambiare spaziatura o maiuscole senza che sia un'altra persona. */
    const abbinate = abbinaRinomine(
      [squadra('Nuova', 'Gin So')],
      [squadra('Vecchia', 'gin  so')]
    );

    expect(abbinate).toHaveLength(1);
  });

  it('accoppia più proprietari nella stessa passata', () => {
    const abbinate = abbinaRinomine(
      [squadra('A2', 'ginso'), squadra('B2', 'emilio')],
      [squadra('A1', 'ginso'), squadra('B1', 'emilio')]
    );

    expect(abbinate.map((r) => [r.vecchia.nome, r.nuova.nome])).toEqual([
      ['A1', 'A2'],
      ['B1', 'B2'],
    ]);
  });

  it('senza scomparse non c’è niente da accoppiare', () => {
    /** Il caso normale: una squadra si iscrive e basta. */
    expect(abbinaRinomine([squadra('TMM', 'Mario')], [])).toEqual([]);
  });
});

describe('chiave del nome', () => {
  it('collassa spazi e maiuscole', () => {
    expect(chiaveNome('  Atletico   BAR ')).toBe('atletico bar');
  });
});
