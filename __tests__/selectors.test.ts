import type { Category } from '@/domain/category';
import type { Player } from '@/domain/player';
import {
  selectFilteredPlayers,
  selectGroupedWatchlist,
  selectWatchlistTotal,
} from '@/state/selectors';

function player(id: number, nome: string, r: Player['r'], squadra: string): Player {
  return {
    id,
    r,
    rm: null,
    nome,
    squadra,
    qt_a: 10,
    qt_i: 10,
    diff: 0,
    qt_a_m: 10,
    qt_i_m: 10,
    diff_m: 0,
    fvm: 50,
    fvm_m: 50,
    is_active: true,
  };
}

const PLAYERS: Player[] = [
  player(1, 'Kvaratskhelia', 'A', 'Napoli'),
  player(2, 'Marco Rossi', 'C', 'Inter'),
  player(3, 'Marco Bianchi', 'D', 'Napoli'),
  player(4, 'Svilar', 'P', 'Roma'),
];

describe('selectFilteredPlayers (US2)', () => {
  it('trova per stringa parziale', () => {
    const result = selectFilteredPlayers(PLAYERS, 'Kva', 'ALL');
    expect(result.map((p) => p.nome)).toEqual(['Kvaratskhelia']);
  });

  it('ignora maiuscole e minuscole', () => {
    expect(selectFilteredPlayers(PLAYERS, 'kVaRa', 'ALL')).toHaveLength(1);
  });

  it('filtra per ruolo', () => {
    const result = selectFilteredPlayers(PLAYERS, '', 'C');
    expect(result.map((p) => p.id)).toEqual([2]);
  });

  it('combina ricerca testuale e filtro ruolo', () => {
    // Criterio di accettazione US2: cercare "Marco" vedendo solo i centrocampisti.
    const result = selectFilteredPlayers(PLAYERS, 'Marco', 'C');
    expect(result.map((p) => p.nome)).toEqual(['Marco Rossi']);
  });

  it('cerca anche per squadra', () => {
    const result = selectFilteredPlayers(PLAYERS, 'napoli', 'ALL');
    expect(result.map((p) => p.id).sort()).toEqual([1, 3]);
  });

  it('restituisce l array originale quando non c e alcun filtro', () => {
    // Identita' referenziale preservata: evita un re-render inutile della lista.
    expect(selectFilteredPlayers(PLAYERS, '   ', 'ALL')).toBe(PLAYERS);
  });

  it('restituisce lista vuota se nulla corrisponde', () => {
    expect(selectFilteredPlayers(PLAYERS, 'zzzz', 'ALL')).toEqual([]);
  });
});

describe('selectGroupedWatchlist (US5)', () => {
  const categories: Category[] = [
    { id: 10, name: 'Must-Have', color: '#22C55E', sort_order: 0, is_default: true },
    { id: 20, name: 'Scommesse', color: '#A855F7', sort_order: 1, is_default: true },
    { id: 30, name: 'Vuota', color: '#EF4444', sort_order: 2, is_default: false },
  ];

  const byId: Record<number, Player> = Object.fromEntries(PLAYERS.map((p) => [p.id, p]));

  it('raggruppa per categoria con i conteggi esatti', () => {
    const groups = selectGroupedWatchlist(
      byId,
      { 1: 10, 2: 10, 4: 20 },
      { 1: 100, 2: 200, 4: 300 },
      categories
    );

    expect(groups.map((g) => [g.category.name, g.count])).toEqual([
      ['Must-Have', 2],
      ['Scommesse', 1],
      ['Vuota', 0],
    ]);
  });

  it('mantiene visibili le categorie vuote con conteggio zero', () => {
    const groups = selectGroupedWatchlist(byId, {}, {}, categories);
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.count === 0)).toBe(true);
  });

  it('ordina i giocatori per data di inserimento', () => {
    const groups = selectGroupedWatchlist(
      byId,
      { 1: 10, 2: 10 },
      { 1: 999, 2: 100 }, // il 2 e' stato aggiunto prima
      categories
    );
    expect(groups[0]?.players.map((p) => p.id)).toEqual([2, 1]);
  });

  it('ignora le assegnazioni orfane invece di crashare', () => {
    const groups = selectGroupedWatchlist(
      byId,
      { 999: 10 }, // giocatore inesistente
      { 999: 1 },
      categories
    );
    expect(groups[0]?.count).toBe(0);
  });

  it('ignora le assegnazioni a categorie eliminate', () => {
    const groups = selectGroupedWatchlist(byId, { 1: 777 }, { 1: 1 }, categories);
    expect(groups.reduce((sum, g) => sum + g.count, 0)).toBe(0);
  });
});

describe('selectWatchlistTotal', () => {
  it('conta le assegnazioni', () => {
    expect(selectWatchlistTotal({ 1: 10, 2: 20 })).toBe(2);
    expect(selectWatchlistTotal({})).toBe(0);
  });
});
