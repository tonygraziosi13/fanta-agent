import { getDb } from '@/core/db/client';
import { rowToCategory, type Category, type CategoryRow } from '@/domain/category';

/**
 * CRUD delle categorie della Watchlist.
 * Tabella non prevista dalle US: nasce dalla scelta di renderle editabili.
 */

export async function getAllCategories(): Promise<Category[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<CategoryRow>(
    'SELECT * FROM categories ORDER BY sort_order ASC, id ASC'
  );
  return rows.map(rowToCategory);
}

export async function createCategory(name: string, color: string): Promise<number> {
  const db = await getDb();
  // sort_order = coda della lista, cosi' le nuove categorie non scavalcano le esistenti.
  const max = await db.getFirstAsync<{ m: number | null }>(
    'SELECT MAX(sort_order) AS m FROM categories'
  );
  const result = await db.runAsync(
    'INSERT INTO categories (name, color, sort_order, is_default) VALUES (?, ?, ?, 0)',
    name.trim(),
    color,
    (max?.m ?? -1) + 1
  );
  return result.lastInsertRowId;
}

export async function updateCategory(
  id: number,
  fields: { name?: string; color?: string }
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const params: Array<string | number> = [];

  if (fields.name !== undefined) {
    sets.push('name = ?');
    params.push(fields.name.trim());
  }
  if (fields.color !== undefined) {
    sets.push('color = ?');
    params.push(fields.color);
  }
  if (sets.length === 0) return;

  params.push(id);
  await db.runAsync(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`, ...params);
}

/**
 * L'eliminazione porta via le assegnazioni via ON DELETE CASCADE.
 * E' distruttiva e intenzionale: la UI mostra prima quanti giocatori si perdono.
 */
export async function deleteCategory(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM categories WHERE id = ?', id);
}

/** Riordino: gli id arrivano gia' nell'ordine voluto dalla UI. */
export async function reorderCategories(orderedIds: number[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const [index, id] of orderedIds.entries()) {
      await db.runAsync('UPDATE categories SET sort_order = ? WHERE id = ?', index, id);
    }
  });
}

/**
 * Quanti giocatori verrebbero persi eliminando la categoria (conferma UI).
 *
 * Il conteggio e' volutamente su tutte le configurazioni: le categorie sono
 * condivise fra le leghe, quindi il CASCADE colpisce anche le watchlist che
 * l'utente non ha sotto gli occhi in quel momento.
 */
export async function countPlayersInCategory(id: number): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM watchlist WHERE category_id = ?',
    id
  );
  return row?.n ?? 0;
}
