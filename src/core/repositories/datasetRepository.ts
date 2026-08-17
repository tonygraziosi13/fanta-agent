import { getDb } from '@/core/db/client';
import type { MappedDataset } from '@/core/sync/datasetMapper';
import { setDatasetMeta, type DatasetMeta } from './datasetMetaRepository';
import { bulkUpsertStats } from './playerStatsRepository';
import { deactivateAllPlayers, writePlayers } from './playersRepository';

/**
 * Applicazione atomica di un dataset (US20-3).
 *
 * --- Perche' una transazione unica ---
 * I quattro statement sono un'unica affermazione: "questa e' la versione X del
 * listone". Separarli aprirebbe finestre in cui l'app e' incoerente con se
 * stessa — giocatori nuovi senza le loro metriche, o peggio una versione
 * registrata come applicata mentre la scrittura e' fallita a meta', che
 * impedirebbe per sempre al sync successivo di correggere il tiro.
 *
 * --- Cosa NON viene toccato ---
 * `watchlist`, `categories` e `configurations`. Non compaiono qui, e non e' una
 * dimenticanza: e' il criterio di accettazione US20-3. Le scelte dell'utente
 * non sono dati sincronizzabili. L'unica interazione possibile sarebbe un
 * DELETE su `players` che si propaghi in CASCADE — ed e' esattamente il motivo
 * per cui i giocatori spariti vengono spenti invece che cancellati.
 */
export async function applyDataset(
  dataset: MappedDataset,
  meta: DatasetMeta
): Promise<{ players: number; stats: number }> {
  const db = await getDb();
  let players = 0;
  let stats = 0;

  await db.withTransactionAsync(async () => {
    await deactivateAllPlayers();
    players = await writePlayers(dataset.players);
    stats = await bulkUpsertStats(dataset.stats);
    await setDatasetMeta(meta);
  });

  return { players, stats };
}
