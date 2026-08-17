import { getDb } from '@/core/db/client';

/**
 * Data Access Layer della Watchlist (US8-T2).
 * Funzioni asincrone e isolate: la pipeline le invoca in background,
 * la UI non le chiama mai direttamente.
 *
 * Ogni operazione e' relativa a una configurazione d'asta: `config_id` non ha
 * default proprio per rendere impossibile scrivere "nella watchlist" senza dire
 * di quale lega si parla.
 */

export interface WatchlistEntry {
  player_id: number;
  category_id: number;
  added_at: number;
}

/**
 * Assegna un giocatore a una categoria dentro una configurazione.
 *
 * `ON CONFLICT(player_id, config_id)` copre in un solo statement sia
 * l'inserimento (US3) sia lo spostamento di categoria (US6): il vincolo UNIQUE
 * composto rende i due casi la stessa operazione. `added_at` viene rinfrescato
 * allo spostamento perche' rappresenta "quando e' entrato in questa categoria",
 * che e' l'ordine cronologico mostrato dalla Watchlist.
 */
export async function addPlayerToCategory(
  playerId: number,
  configId: number,
  categoryId: number,
  addedAt: number = Date.now()
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO watchlist (player_id, config_id, category_id, added_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(player_id, config_id) DO UPDATE SET
       category_id = excluded.category_id,
       added_at    = excluded.added_at`,
    playerId,
    configId,
    categoryId,
    addedAt
  );
}

/** Alias esplicito richiesto da US8-T2; stessa semantica di addPlayerToCategory. */
export const updatePlayerCategory = addPlayerToCategory;

export async function removePlayer(playerId: number, configId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'DELETE FROM watchlist WHERE player_id = ? AND config_id = ?',
    playerId,
    configId
  );
}

export async function getAllWatchlist(configId: number): Promise<WatchlistEntry[]> {
  const db = await getDb();
  return db.getAllAsync<WatchlistEntry>(
    `SELECT player_id, category_id, added_at
       FROM watchlist
      WHERE config_id = ?
      ORDER BY added_at ASC`,
    configId
  );
}

/** Conteggio per configurazione: alimenta il riepilogo delle card in Home. */
export async function countWatchlistByConfiguration(): Promise<Record<number, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ config_id: number; n: number }>(
    'SELECT config_id, COUNT(*) AS n FROM watchlist GROUP BY config_id'
  );
  const counts: Record<number, number> = {};
  for (const row of rows) counts[row.config_id] = row.n;
  return counts;
}
