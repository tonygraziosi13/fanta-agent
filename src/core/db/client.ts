import * as SQLite from 'expo-sqlite';

/**
 * Singleton della connessione SQLite.
 *
 * `openDatabaseAsync` viene invocata una sola volta: la promise stessa e' la
 * cache. Se due moduli chiamano getDb() in parallelo durante il boot, entrambi
 * attendono la stessa apertura invece di aprire due connessioni concorrenti
 * (che su Android producono "database is locked" durante il bulk insert).
 */

const DATABASE_NAME = 'fantaagent.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function open(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);

  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `);

  return db;
}

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    // Se l'apertura fallisce non si memoizza il rifiuto: un retry deve poter riprovare.
    dbPromise = open().catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

/** Usato dai test e dal reset manuale. In produzione non serve. */
export async function closeDb(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise;
  dbPromise = null;
  await db.closeAsync();
}
