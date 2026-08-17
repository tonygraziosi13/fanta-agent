import { getDb } from '@/core/db/client';
import {
  rowToConfiguration,
  type Configuration,
  type ConfigurationDraft,
  type ConfigurationRow,
} from '@/domain/configuration';

/**
 * CRUD delle configurazioni d'asta.
 *
 * Come tutti i repository: funzioni libere, invocate dagli hook del middleware
 * e mai dalla UI.
 */

export async function getAllConfigurations(): Promise<Configuration[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ConfigurationRow>(
    'SELECT * FROM configurations ORDER BY created_at ASC, id ASC'
  );
  return rows.map(rowToConfiguration);
}

export async function getActiveConfiguration(): Promise<Configuration | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<ConfigurationRow>(
    'SELECT * FROM configurations WHERE is_active = 1 LIMIT 1'
  );
  return row ? rowToConfiguration(row) : null;
}

/**
 * La prima configurazione creata nasce gia' attiva: senza una configurazione
 * attiva la watchlist non ha dove scrivere, e obbligare l'utente a un secondo
 * tap per "accenderla" sarebbe solo un modo per farlo sbagliare.
 */
export async function createConfiguration(draft: ConfigurationDraft): Promise<number> {
  const db = await getDb();
  const existing = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM configurations'
  );
  const isFirst = (existing?.n ?? 0) === 0;

  const result = await db.runAsync(
    `INSERT INTO configurations
       (name, participants, credits, slot_p, slot_d, slot_c, slot_a, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    draft.name.trim(),
    draft.participants,
    draft.credits,
    draft.slots.P,
    draft.slots.D,
    draft.slots.C,
    draft.slots.A,
    isFirst ? 1 : 0,
    Date.now()
  );
  return result.lastInsertRowId;
}

/** SET dinamico: si aggiornano solo i campi realmente toccati dal form. */
export async function updateConfiguration(
  id: number,
  fields: Partial<ConfigurationDraft>
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const params: Array<string | number> = [];

  if (fields.name !== undefined) {
    sets.push('name = ?');
    params.push(fields.name.trim());
  }
  if (fields.participants !== undefined) {
    sets.push('participants = ?');
    params.push(fields.participants);
  }
  if (fields.credits !== undefined) {
    sets.push('credits = ?');
    params.push(fields.credits);
  }
  if (fields.slots !== undefined) {
    sets.push('slot_p = ?', 'slot_d = ?', 'slot_c = ?', 'slot_a = ?');
    params.push(fields.slots.P, fields.slots.D, fields.slots.C, fields.slots.A);
  }
  if (sets.length === 0) return;

  params.push(id);
  await db.runAsync(`UPDATE configurations SET ${sets.join(', ')} WHERE id = ?`, ...params);
}

/**
 * Distruttiva: ON DELETE CASCADE porta via anche la watchlist di quella
 * configurazione. La conferma e' responsabilita' del chiamante.
 */
export async function deleteConfiguration(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM configurations WHERE id = ?', id);
}

/**
 * "Una sola attiva" e' un invariante applicativo, non un vincolo SQL: si
 * garantisce spegnendo tutte e riaccendendone una nella stessa transazione,
 * cosi' non esiste un istante con due configurazioni attive.
 */
export async function setActiveConfiguration(id: number): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE configurations SET is_active = 0 WHERE is_active = 1');
    await db.runAsync('UPDATE configurations SET is_active = 1 WHERE id = ?', id);
  });
}

/** Quanti giocatori si perdono eliminando la configurazione (conferma UI). */
export async function countPlayersInConfiguration(id: number): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM watchlist WHERE config_id = ?',
    id
  );
  return row?.n ?? 0;
}
