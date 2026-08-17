import { getDb } from '@/core/db/client';
import { UPSERT_PLAYER_STATS_SQL } from '@/core/db/schema';
import {
  rowToPlayerStats,
  type PlayerStats,
  type PlayerStatsDbRow,
} from '@/domain/playerStats';

/**
 * Accesso alla tabella `player_stats` (US20-T3, US21-T2).
 *
 * A differenza di `playersRepository`, qui non esiste una `getAll`: le metriche
 * non vengono mai idratate in blocco. Il listone in RAM serve allo scroll, e per
 * lo scroll queste colonne sono peso morto — la schermata di dettaglio ne mostra
 * una per volta. La lettura e' quindi per singolo giocatore, su richiesta.
 */

/**
 * Scrittura massiva delle metriche (US20-T3).
 *
 * Stessa tecnica di `bulkUpsertPlayers` e per la stessa ragione: una sola
 * transazione (fuori, SQLite fa un fsync per statement) e un solo prepared
 * statement riusato. Il `finally` garantisce la finalize anche se una riga
 * esplode a meta' import.
 *
 * Non apre una transazione propria: e' pensata per essere chiamata *dentro*
 * quella del sync, insieme all'upsert dei giocatori e alla scrittura della
 * versione. Applicare le metriche senza i giocatori a cui si riferiscono, o la
 * versione senza i dati, sono entrambi stati incoerenti.
 */
export async function bulkUpsertStats(stats: PlayerStats[]): Promise<number> {
  if (stats.length === 0) return 0;

  const db = await getDb();
  let written = 0;

  const statement = await db.prepareAsync(UPSERT_PLAYER_STATS_SQL);
  try {
    for (const s of stats) {
      const extra = JSON.stringify({
        ...(s.heatmap !== null ? { heatmap: s.heatmap } : {}),
        ...(s.injuries.history.length > 0 ? { injuryHistory: s.injuries.history } : {}),
      });

      await statement.executeAsync([
        s.playerId,
        s.season,
        s.performance.presenze,
        s.performance.minuti,
        s.performance.mediaVoto,
        s.performance.fantamedia,
        s.performance.gol,
        s.performance.assist,
        s.performance.ammonizioni,
        s.performance.espulsioni,
        s.advanced.xg,
        s.advanced.npxg,
        s.advanced.xa,
        s.advanced.xgChain,
        s.advanced.xgBuildup,
        s.advanced.tiri,
        s.advanced.keyPasses,
        s.injuries.days,
        s.injuries.matches,
        s.injuries.risk,
        extra,
        JSON.stringify(s.coverage),
        s.updatedAt,
      ]);
      written += 1;
    }
  } finally {
    await statement.finalizeAsync();
  }

  return written;
}

/**
 * Metriche di un singolo giocatore (US21-T2).
 * `null` = nessuna riga: il giocatore esiste nel listone ma nessuna fonte lo ha
 * ancora coperto. La UI lo dice, invece di mostrare una schermata di zeri.
 */
export async function getStatsByPlayerId(playerId: number): Promise<PlayerStats | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<PlayerStatsDbRow>(
    'SELECT * FROM player_stats WHERE player_id = ?',
    playerId
  );
  return row ? rowToPlayerStats(row) : null;
}

/** Quanti giocatori hanno metriche: usato dalla diagnostica del sync. */
export async function countStats(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM player_stats');
  return row?.n ?? 0;
}
