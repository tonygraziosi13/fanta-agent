import { DEFAULT_CATEGORIES } from '@/domain/category';
import {
  DEFAULT_CONFIGURATION_NAME,
  DEFAULT_CREDITS,
  DEFAULT_PARTICIPANTS,
  DEFAULT_SLOTS,
} from '@/domain/configuration';
import { getDb } from './client';
import {
  CREATE_DATASET_META_SQL,
  CREATE_PLAYER_STATS_SQL,
  CREATE_TABLES_SQL,
  MIGRATE_V2_CONFIGURATIONS_SQL,
  MIGRATE_V2_WATCHLIST_COPY_SQL,
  MIGRATE_V2_WATCHLIST_CREATE_SQL,
  MIGRATE_V2_WATCHLIST_SWAP_SQL,
  SCHEMA_VERSION,
} from './schema';

/**
 * Migrazioni idempotenti, guidate da `PRAGMA user_version`.
 *
 * Girano a ogni avvio ma costano una singola lettura di pragma quando lo schema
 * e' gia' aggiornato: il boot (US7-T4) non paga nulla dal secondo avvio in poi.
 *
 * Struttura a step: `CREATE_TABLES_SQL` descrive lo schema nella sua forma
 * corrente e serve solo al database vergine; chi arriva da una versione
 * precedente attraversa gli upgrade uno per uno. Tutto dentro un'unica
 * transazione — un aggiornamento interrotto a meta' lascerebbe `user_version`
 * disallineato dalle tabelle reali.
 */
export async function runMigrations(): Promise<void> {
  const db = await getDb();

  const result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = result?.user_version ?? 0;

  if (current >= SCHEMA_VERSION) return;

  await db.withTransactionAsync(async () => {
    if (current === 0) {
      // Installazione pulita: nessun dato da preservare, si crea tutto subito
      // nella forma finale.
      await db.execAsync(CREATE_TABLES_SQL);
      await seedDefaultCategories();
    }

    // Gli step sono cumulativi e non alternativi: chi arriva da v1 attraversa
    // anche v2 -> v3 nello stesso avvio.
    if (current === 1) {
      await upgradeV1ToV2();
    }

    if (current >= 1 && current <= 2) {
      await upgradeV2ToV3();
    }

    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
}

/**
 * v1 -> v2: nascono le configurazioni d'asta e la watchlist diventa una per
 * configurazione.
 *
 * La watchlist va ricostruita, non estesa: il vincolo `UNIQUE(player_id)` di v1
 * impedirebbe allo stesso giocatore di comparire in due leghe, e SQLite non sa
 * rimuovere un vincolo con un ALTER.
 *
 * Le assegnazioni gia' fatte dall'utente non vanno perse: se ce ne sono, si crea
 * una configurazione ponte coi valori di default e le si adotta tutte. Se la
 * watchlist e' vuota non si crea nulla — l'utente vedra' il wizard iniziale e
 * partira' da una configurazione decisa da lui.
 *
 * Le foreign key restano attive: nessuna tabella referenzia `watchlist`, quindi
 * il DROP non orfana nulla, e le righe copiate puntano a categorie e giocatori
 * gia' esistenti.
 */
async function upgradeV1ToV2(): Promise<void> {
  const db = await getDb();

  await db.execAsync(MIGRATE_V2_CONFIGURATIONS_SQL);

  const existing = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM watchlist');
  const hasAssignments = (existing?.n ?? 0) > 0;

  const bridgeId = hasAssignments ? await insertBridgeConfiguration() : null;

  await db.execAsync(MIGRATE_V2_WATCHLIST_CREATE_SQL);
  if (bridgeId !== null) {
    await db.runAsync(MIGRATE_V2_WATCHLIST_COPY_SQL, bridgeId);
  }
  await db.execAsync(MIGRATE_V2_WATCHLIST_SWAP_SQL);
}

/**
 * v2 -> v3: arrivano le metriche avanzate e il versionamento del dataset.
 *
 * Migrazione puramente additiva, l'opposto di v1 -> v2: due CREATE TABLE e
 * nulla piu'. Nessuna tabella esistente viene toccata, quindi `watchlist`,
 * `categories` e `configurations` sono intatte per costruzione — l'integrita'
 * relazionale chiesta da US20-3 qui non richiede nemmeno una copia.
 *
 * `player_stats` nasce vuota: il primo sync la popola. Un giocatore senza riga
 * non e' un errore, e' un giocatore di cui non conosciamo ancora le metriche.
 */
async function upgradeV2ToV3(): Promise<void> {
  const db = await getDb();
  await db.execAsync(CREATE_PLAYER_STATS_SQL);
  await db.execAsync(CREATE_DATASET_META_SQL);
}

/** Configurazione ponte per le assegnazioni ereditate da v1: gia' attiva. */
async function insertBridgeConfiguration(): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO configurations
       (name, participants, credits, slot_p, slot_d, slot_c, slot_a, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    DEFAULT_CONFIGURATION_NAME,
    DEFAULT_PARTICIPANTS,
    DEFAULT_CREDITS,
    DEFAULT_SLOTS.P,
    DEFAULT_SLOTS.D,
    DEFAULT_SLOTS.C,
    DEFAULT_SLOTS.A,
    Date.now()
  );
  return result.lastInsertRowId;
}

/**
 * Seed delle 4 categorie iniziali.
 * `INSERT OR IGNORE` sul nome UNIQUE: se l'utente ne ha gia' create di proprie
 * con lo stesso nome, o se la migrazione viene rieseguita, non si duplica nulla.
 */
async function seedDefaultCategories(): Promise<void> {
  const db = await getDb();

  const existing = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM categories');
  if ((existing?.n ?? 0) > 0) return;

  for (const [index, category] of DEFAULT_CATEGORIES.entries()) {
    await db.runAsync(
      'INSERT OR IGNORE INTO categories (name, color, sort_order, is_default) VALUES (?, ?, ?, 1)',
      category.name,
      category.color,
      index
    );
  }
}
