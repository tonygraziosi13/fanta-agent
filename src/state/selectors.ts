import type { Category } from '@/domain/category';
import type { Player } from '@/domain/player';
import { ROLE_FILTER_ALL, type RoleFilter } from '@/domain/roles';

/**
 * Selettori puri: nessuna dipendenza da React, da Zustand o da SQLite.
 * Sono la logica testabile dell'app (vedi __tests__/selectors.test.ts).
 */

/**
 * Filtro combinato ruolo + testo (US2-T1).
 *
 * Ordine deliberato: prima il ruolo (confronto su un carattere, scarta fino
 * all'88% del listone), poi la ricerca testuale sul residuo. Invertirlo
 * significherebbe fare `toLowerCase()` su 497 stringhe invece che su ~90.
 *
 * `nome` e `squadra` sono entrambi cercabili: digitando "Napoli" ci si aspetta
 * la rosa del Napoli, non zero risultati.
 */
export function selectFilteredPlayers(
  players: Player[],
  searchQuery: string,
  roleFilter: RoleFilter
): Player[] {
  const query = searchQuery.trim().toLowerCase();
  const filterByRole = roleFilter !== ROLE_FILTER_ALL;

  if (!filterByRole && query === '') return players;

  return players.filter((p) => {
    if (filterByRole && p.r !== roleFilter) return false;
    if (query === '') return true;
    return (
      p.nome.toLowerCase().includes(query) || p.squadra.toLowerCase().includes(query)
    );
  });
}

export interface CategoryGroup {
  category: Category;
  players: Player[];
  count: number;
}

/**
 * Raggruppa la watchlist per categoria (US5-T2).
 *
 * Incrocia la mappa delle assegnazioni con l'indice dei giocatori: nessuna
 * query al DB, tutto in memoria. Restituisce anche le categorie vuote, cosi'
 * la schermata mostra "0" invece di far sparire la sezione — l'utente deve
 * vedere che la categoria esiste ancora.
 */
export function selectGroupedWatchlist(
  playersById: Record<number, Player>,
  assignments: Record<number, number>,
  addedAt: Record<number, number>,
  categories: Category[]
): CategoryGroup[] {
  const buckets = new Map<number, Player[]>();
  for (const c of categories) buckets.set(c.id, []);

  for (const [playerIdRaw, categoryId] of Object.entries(assignments)) {
    const player = playersById[Number(playerIdRaw)];
    // Assegnazione orfana (giocatore sparito dal listone, o categoria eliminata
    // mentre la mappa non era ancora riconciliata): si ignora silenziosamente.
    if (!player) continue;
    buckets.get(categoryId)?.push(player);
  }

  return categories.map((category) => {
    const players = buckets.get(category.id) ?? [];
    // Ordine cronologico di inserimento, come chiesto da US8-T1 (added_at).
    players.sort((a, b) => (addedAt[a.id] ?? 0) - (addedAt[b.id] ?? 0));
    return { category, players, count: players.length };
  });
}

/** Totale dei giocatori in watchlist, per il badge del tab. */
export function selectWatchlistTotal(assignments: Record<number, number>): number {
  return Object.keys(assignments).length;
}
