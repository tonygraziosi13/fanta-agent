/**
 * Contratto del dataset remoto (US19-3 / US20-1).
 *
 * E' la copia TypeScript di cio' che `scripts/dataset/model.py` serializza: le
 * due estremita' della catena devono descrivere la stessa forma. Quando si
 * aggiunge una metrica si toccano entrambi i file, ed e' un bene che sia
 * evidente — un campo aggiunto solo da un lato non arriverebbe mai a schermo.
 *
 * I tipi sono volutamente permissivi (`| null` ovunque): descrivono cio' che
 * *puo'* arrivare dalla rete, non cio' che ci piacerebbe ricevere. La stretta
 * di mano avviene in `datasetSchema.ts`, che valida, e in `datasetMapper.ts`,
 * che traduce nel dominio.
 */

/** Il file leggero che l'app scarica per primo, a ogni avvio. */
export interface DatasetManifest {
  /** Identificatore breve della versione (prefisso dell'hash). */
  version: string;
  /** SHA-256 del payload: e' *il* criterio di confronto. */
  hash: string;
  season: string;
  generated_at: string;
  players_count: number;
  size_bytes: number;
  /** Nome del file dei dati, relativo all'URL del manifest. */
  payload: string;
}

export interface RemoteQuotazioni {
  qt_a: number;
  qt_i: number;
  diff: number;
  qt_a_m: number;
  qt_i_m: number;
  diff_m: number;
  fvm: number;
  fvm_m: number;
}

export interface RemotePerformance {
  presenze: number | null;
  minuti: number | null;
  media_voto: number | null;
  fantamedia: number | null;
  gol: number | null;
  assist: number | null;
  ammonizioni: number | null;
  espulsioni: number | null;
}

export interface RemoteAdvanced {
  xg: number | null;
  npxg: number | null;
  xa: number | null;
  xg_chain: number | null;
  xg_buildup: number | null;
  tiri: number | null;
  key_passes: number | null;
}

export interface RemoteInjurySpell {
  season: string;
  type: string;
  days: number | null;
  matches: number | null;
}

export interface RemoteInjuries {
  days: number | null;
  matches: number | null;
  risk: number | null;
  history: RemoteInjurySpell[];
}

export interface RemotePlayer {
  id: number;
  r: string;
  rm: string | null;
  nome: string;
  squadra: string;
  is_active: boolean;
  quotazioni: RemoteQuotazioni;
  performance: RemotePerformance;
  advanced: RemoteAdvanced;
  injuries: RemoteInjuries;
  coverage: Record<string, boolean>;
}

export interface DatasetPayload {
  /** Versione del *formato*, non dei dati: protegge da payload di app future. */
  schema: number;
  season: string;
  generated_at: string;
  sources: Record<string, unknown>;
  players: RemotePlayer[];
}

/** Formato che questa versione dell'app sa leggere. */
export const SUPPORTED_SCHEMA = 1;
