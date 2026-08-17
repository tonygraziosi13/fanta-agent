import { getDb } from '@/core/db/client';
import { DEACTIVATE_ALL_PLAYERS_SQL, UPSERT_PLAYER_SQL } from '@/core/db/schema';
import { rowToPlayer, type Player, type PlayerDbRow } from '@/domain/player';

/**
 * Accesso alla tabella players.
 * Nessun componente UI parla mai direttamente con SQLite: passa da qui.
 */

/**
 * Scrittura massiva del listone (US7-T3).
 *
 * Due accorgimenti che fanno la differenza fra ~200ms e diverse decine di secondi:
 *  1. UNA transazione per tutte le 505 righe. Fuori transazione SQLite fa un
 *     fsync per statement: 505 fsync su storage mobile sono proibitivi.
 *  2. UN prepared statement riusato. Il parsing SQL avviene una volta sola
 *     invece di 505.
 * Il finally garantisce la finalize anche se una riga esplode a meta' import,
 * evitando di lasciare lo statement appeso e la connessione in stato sporco.
 */
export async function bulkUpsertPlayers(players: Player[]): Promise<number> {
  if (players.length === 0) return 0;

  const db = await getDb();
  let written = 0;
  await db.withTransactionAsync(async () => {
    written = await writePlayers(players);
  });
  return written;
}

/**
 * Lo stesso lavoro, ma senza aprire una transazione propria.
 *
 * Serve al sync (US20-T3), che deve scrivere giocatori, metriche e versione del
 * dataset dentro *una* transazione: SQLite non annida le transazioni, e
 * chiamare qui `withTransactionAsync` da dentro un'altra fallirebbe. Duplicare
 * il ciclo di scrittura sarebbe l'alternativa peggiore — due copie della stessa
 * query destinate a divergere.
 */
export async function writePlayers(players: Player[]): Promise<number> {
  if (players.length === 0) return 0;

  const db = await getDb();
  let written = 0;

  const statement = await db.prepareAsync(UPSERT_PLAYER_SQL);
    try {
      for (const p of players) {
        await statement.executeAsync([
          p.id,
          p.r,
          p.rm,
          p.nome,
          p.squadra,
          p.qt_a,
          p.qt_i,
          p.diff,
          p.qt_a_m,
          p.qt_i_m,
          p.diff_m,
          p.fvm,
          p.fvm_m,
          p.is_active ? 1 : 0,
        ]);
        written += 1;
      }
  } finally {
    await statement.finalizeAsync();
  }

  return written;
}

/**
 * Spegne l'intero listone (US20-3).
 *
 * Primo statement della transazione di sync: l'upsert successivo riaccende chi
 * e' presente nel dataset, e chi non compare piu' resta spento. Mai un DELETE —
 * la watchlist referenzia `players(id)` e il CASCADE se la porterebbe via.
 */
export async function deactivateAllPlayers(): Promise<void> {
  const db = await getDb();
  await db.execAsync(DEACTIVATE_ALL_PLAYERS_SQL);
}

/** Conteggio usato dal boot hook per decidere se importare (US7-T4). */
export async function countPlayers(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM players');
  return row?.n ?? 0;
}

/**
 * Estrae l'intero listone, ceduti compresi (US1-T1).
 *
 * Deliberatamente senza `WHERE is_active = 1`: l'indice in memoria deve
 * contenere anche i ceduti, altrimenti un giocatore messo in watchlist e poi
 * ceduto sparirebbe dalla lista dell'utente senza spiegazione. Il filtro sugli
 * attivi per il listone si applica in RAM, su un array gia' caricato.
 */
export async function getAllPlayers(): Promise<Player[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<PlayerDbRow>('SELECT * FROM players');
  return rows.map(rowToPlayer);
}
