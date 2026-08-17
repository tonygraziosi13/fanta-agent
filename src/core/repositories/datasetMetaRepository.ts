import { getDb } from '@/core/db/client';

/**
 * Versione del dataset applicato in locale (US20-1).
 *
 * Chiave/valore su tabella e non storage separato: la versione deve poter
 * essere scritta nella *stessa transazione* dei dati. Se vivesse altrove, un
 * crash fra la scrittura dei giocatori e quella della versione lascerebbe l'app
 * convinta di essere aggiornata (o di non esserlo) senza rimedio.
 */

export interface DatasetMeta {
  /** Identificatore di versione dichiarato dal manifest remoto. */
  version: string;
  /** Hash del payload: distingue due build con lo stesso timestamp. */
  hash: string;
  /** Quando il sync e' stato applicato in locale. */
  appliedAt: number;
  playersCount: number;
}

const KEYS = {
  version: 'dataset_version',
  hash: 'dataset_hash',
  appliedAt: 'dataset_applied_at',
  playersCount: 'dataset_players_count',
} as const;

export async function getDatasetMeta(): Promise<DatasetMeta | null> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    'SELECT key, value FROM dataset_meta'
  );

  const map = new Map(rows.map((r) => [r.key, r.value]));
  const version = map.get(KEYS.version);
  const hash = map.get(KEYS.hash);

  // Senza versione *e* hash non c'e' nulla con cui confrontare il manifest
  // remoto: equivale a non avere mai sincronizzato.
  if (version === undefined || hash === undefined) return null;

  return {
    version,
    hash,
    appliedAt: Number(map.get(KEYS.appliedAt) ?? 0),
    playersCount: Number(map.get(KEYS.playersCount) ?? 0),
  };
}

/**
 * Da invocare dentro la transazione del sync, come ultimo statement: la
 * versione e' la dichiarazione che tutto il resto e' andato a buon fine.
 */
export async function setDatasetMeta(meta: DatasetMeta): Promise<void> {
  const db = await getDb();
  const entries: Array<[string, string]> = [
    [KEYS.version, meta.version],
    [KEYS.hash, meta.hash],
    [KEYS.appliedAt, String(meta.appliedAt)],
    [KEYS.playersCount, String(meta.playersCount)],
  ];

  for (const [key, value] of entries) {
    await db.runAsync(
      'INSERT INTO dataset_meta (key, value) VALUES (?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value
    );
  }
}
