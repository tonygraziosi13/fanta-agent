/**
 * Metriche avanzate di un calciatore (US21).
 *
 * --- La regola che governa questo file: `null` non e' zero ---
 * Ogni metrica e' `number | null`. Un neopromosso al primo anno in Serie A non
 * ha "0 xG": non ha xG affatto. Modellarlo con 0 lo mostrerebbe all'utente come
 * un attaccante che non tira mai, cioe' un'informazione falsa presentata con la
 * stessa autorevolezza di una vera. `coverage` dice quali fonti hanno davvero
 * risposto, e la UI distingue i due casi (`MetricUnavailable`).
 *
 * La forma e' annidata per sezioni, non piatta: rispecchia 1:1 le sezioni
 * chieste da US21-2 (Dati Economici / Rendimento / Analitiche / Rischio), cosi'
 * la schermata puo' mostrare o nascondere un blocco intero senza sapere quali
 * campi contenga. La riga SQLite resta invece piatta — la traduzione avviene in
 * `rowToPlayerStats`, che e' l'unico punto in cui le due forme si incontrano.
 */

/** Nome della fonte, come lo scrive la pipeline in `scripts/dataset/`. */
export const STATS_SOURCES = ['understat', 'fantacalcio', 'fbref', 'transfermarkt'] as const;
export type StatsSource = (typeof STATS_SOURCES)[number];

/** Quali fonti hanno coperto questo giocatore. Assente = false. */
export type Coverage = Partial<Record<StatsSource, boolean>>;

/** Rendimento storico ufficiale (fonte: Fantacalcio.it). */
export interface SeasonPerformance {
  presenze: number | null;
  minuti: number | null;
  mediaVoto: number | null;
  fantamedia: number | null;
  gol: number | null;
  assist: number | null;
  ammonizioni: number | null;
  espulsioni: number | null;
}

/** Metriche predittive (fonte: Understat, modelli su dati Opta). */
export interface AdvancedMetrics {
  /** Expected Goals. */
  xg: number | null;
  /** Expected Goals esclusi i rigori: misura il gioco su azione. */
  npxg: number | null;
  /** Expected Assists. */
  xa: number | null;
  /** xG di ogni azione in cui il giocatore e' stato coinvolto. */
  xgChain: number | null;
  /** Come xgChain ma senza tiro e assist finali: misura la costruzione. */
  xgBuildup: number | null;
  tiri: number | null;
  keyPasses: number | null;
}

/** Un singolo stop per infortunio, dallo storico clinico. */
export interface InjurySpell {
  /** Stagione di riferimento, es. "25/26". */
  season: string;
  /** Descrizione dell'infortunio come riportata dalla fonte. */
  type: string;
  days: number | null;
  matches: number | null;
}

/** Storico infortuni e indice di rischio derivato (fonte: Transfermarkt). */
export interface InjuryProfile {
  /** Giorni totali di stop nella finestra considerata dalla pipeline. */
  days: number | null;
  /** Partite saltate nella stessa finestra. */
  matches: number | null;
  /**
   * Indice sintetico 0..1 calcolato dalla pipeline, non dall'app: il calcolo
   * sta dove stanno i dati grezzi (US19-3, "senza demandare calcoli complessi
   * al dispositivo dell'utente").
   */
  risk: number | null;
  history: InjurySpell[];
}

export interface PlayerStats {
  playerId: number;
  /** Stagione di riferimento delle metriche, es. "2025-26". */
  season: string | null;
  performance: SeasonPerformance;
  advanced: AdvancedMetrics;
  injuries: InjuryProfile;
  coverage: Coverage;
  updatedAt: number;
}

/** Riga piatta di `player_stats`. SQLite non conosce oggetti annidati. */
export interface PlayerStatsDbRow {
  player_id: number;
  season: string | null;
  presenze: number | null;
  minuti: number | null;
  media_voto: number | null;
  fantamedia: number | null;
  gol: number | null;
  assist: number | null;
  ammonizioni: number | null;
  espulsioni: number | null;
  xg: number | null;
  npxg: number | null;
  xa: number | null;
  xg_chain: number | null;
  xg_buildup: number | null;
  tiri: number | null;
  key_passes: number | null;
  injury_days: number | null;
  injury_matches: number | null;
  injury_risk: number | null;
  /** JSON: `{ injuryHistory }`. */
  extra: string | null;
  /** JSON: mappa fonte -> boolean. */
  coverage: string | null;
  updated_at: number;
}

/** Contenuto della colonna `extra`: cio' che non ha forma tabellare. */
export interface PlayerStatsExtra {
  injuryHistory?: InjurySpell[];
}

/**
 * Un JSON corrotto in `extra` non deve far esplodere la schermata di dettaglio:
 * degrada a "dato non disponibile", che e' esattamente il caso che la UI sa
 * gia' gestire.
 */
function parseJson<T>(raw: string | null, fallback: T): T {
  if (raw === null || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function rowToPlayerStats(row: PlayerStatsDbRow): PlayerStats {
  const extra = parseJson<PlayerStatsExtra>(row.extra, {});

  return {
    playerId: row.player_id,
    season: row.season,
    performance: {
      presenze: row.presenze,
      minuti: row.minuti,
      mediaVoto: row.media_voto,
      fantamedia: row.fantamedia,
      gol: row.gol,
      assist: row.assist,
      ammonizioni: row.ammonizioni,
      espulsioni: row.espulsioni,
    },
    advanced: {
      xg: row.xg,
      npxg: row.npxg,
      xa: row.xa,
      xgChain: row.xg_chain,
      xgBuildup: row.xg_buildup,
      tiri: row.tiri,
      keyPasses: row.key_passes,
    },
    injuries: {
      days: row.injury_days,
      matches: row.injury_matches,
      risk: row.injury_risk,
      history: extra.injuryHistory ?? [],
    },
    coverage: parseJson<Coverage>(row.coverage, {}),
    updatedAt: row.updated_at,
  };
}

/** Una sezione senza un solo valore va nascosta, non mostrata vuota (US21-2). */
export function hasAnyValue(values: Array<number | null>): boolean {
  return values.some((v) => v !== null);
}
