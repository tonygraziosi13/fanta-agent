import type { DatasetMeta } from '@/core/repositories/datasetMetaRepository';
import type { DatasetManifest } from './types';

/**
 * La decisione "scarico o no" (US20-1, US20-T2).
 *
 * Isolata in una funzione pura di due argomenti perche' e' la regola che
 * determina il costo di ogni avvio dell'app: sbagliarla significa o scaricare
 * megabyte inutili a ogni apertura, o non aggiornarsi mai. Qui si testa in
 * millisecondi, senza rete e senza database.
 *
 * Il confronto e' sull'hash del contenuto, non sulla data: la pipeline puo'
 * girare ogni notte, ma se le fonti non sono cambiate l'hash e' lo stesso e
 * l'utente non scarica nulla. Un timestamp, al contrario, cambierebbe sempre.
 */

export type SyncDecision =
  | { sync: false; reason: 'aggiornato' }
  | { sync: true; reason: 'primo-avvio' | 'versione-diversa' };

export function decideSync(
  local: DatasetMeta | null,
  remote: DatasetManifest
): SyncDecision {
  if (local === null) return { sync: true, reason: 'primo-avvio' };
  // Hash uguale: stesso contenuto, qualunque cosa dicano versione e data.
  if (local.hash === remote.hash) return { sync: false, reason: 'aggiornato' };
  return { sync: true, reason: 'versione-diversa' };
}

/**
 * Quanto e' vecchio il dataset locale, in giorni. Serve alla UI per dire
 * "aggiornato 3 giorni fa" invece di mostrare un timestamp grezzo.
 */
export function datasetAgeInDays(local: DatasetMeta | null, now: number = Date.now()): number | null {
  if (local === null || local.appliedAt <= 0) return null;
  return Math.floor((now - local.appliedAt) / 86_400_000);
}
