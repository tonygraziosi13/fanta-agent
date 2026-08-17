/**
 * Schema del database locale (US7-T1 + US8-T1).
 *
 * Due deviazioni consapevoli dal testo di US8-T1, conseguenza della scelta
 * di rendere le categorie editabili dall'utente:
 *
 *  1. `watchlist.category_id` FK invece di `category_name` testuale.
 *     Rinominare una categoria non deve orfanare le assegnazioni gia' fatte.
 *
 *  2. `watchlist.player_id` UNIQUE *per configurazione*: un giocatore appartiene
 *     a una sola categoria all'interno della stessa asta. Rende
 *     `updatePlayerCategory` (US8-T2) un UPDATE atomico invece di delete+insert,
 *     ed elimina alla radice lo stato incoerente "stesso giocatore in due
 *     categorie".
 *
 * v2 introduce `configurations` (parametri d'asta) e rende la watchlist
 * per-configurazione: la stessa persona gioca piu' leghe con budget e strategie
 * diverse, e le due liste non devono mescolarsi.
 *
 * v3 (US20-T1) aggiunge le metriche avanzate e il versionamento del dataset
 * remoto. Le statistiche vivono in `player_stats`, tabella separata 1:1 con
 * `players` e non colonne aggiunte a quest'ultima: il listone sta interamente in
 * RAM per lo scroll (US1-T3), e appenderci xG, storico infortuni e heatmap
 * gonfierebbe 497 righe per una schermata che ne mostra una alla volta.
 * Il dettaglio (US21) si legge invece una riga per volta, su richiesta.
 */

export const SCHEMA_VERSION = 3;

const CORE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS players (
  id        INTEGER PRIMARY KEY,
  r         TEXT    NOT NULL,
  rm        TEXT,
  nome      TEXT    NOT NULL,
  squadra   TEXT    NOT NULL,
  qt_a      INTEGER NOT NULL DEFAULT 0,
  qt_i      INTEGER NOT NULL DEFAULT 0,
  diff      INTEGER NOT NULL DEFAULT 0,
  qt_a_m    INTEGER NOT NULL DEFAULT 0,
  qt_i_m    INTEGER NOT NULL DEFAULT 0,
  diff_m    INTEGER NOT NULL DEFAULT 0,
  fvm       INTEGER NOT NULL DEFAULT 0,
  fvm_m     INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);

-- Indice parziale: le query dell'app leggono sempre e solo i giocatori attivi.
CREATE INDEX IF NOT EXISTS idx_players_role
  ON players(r) WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  color      TEXT    NOT NULL,
  sort_order INTEGER NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS configurations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL UNIQUE,
  participants INTEGER NOT NULL,
  credits      INTEGER NOT NULL,
  slot_p       INTEGER NOT NULL,
  slot_d       INTEGER NOT NULL,
  slot_c       INTEGER NOT NULL,
  slot_a       INTEGER NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  config_id   INTEGER NOT NULL REFERENCES configurations(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  added_at    INTEGER NOT NULL,
  UNIQUE (player_id, config_id)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_category
  ON watchlist(category_id);

CREATE INDEX IF NOT EXISTS idx_watchlist_config
  ON watchlist(config_id);
`;

/**
 * Metriche avanzate, una riga per giocatore (US20-T1).
 *
 * Ogni metrica e' NULLABLE e non ha DEFAULT 0: un giocatore appena arrivato in
 * Serie A non ha xG "pari a zero", non ha xG *del tutto*. Confondere i due casi
 * mostrerebbe all'utente uno scarso rendimento dove non c'e' alcun dato.
 *
 * `extra` raccoglie in JSON cio' che non ha una forma fissa (heatmap, storico
 * infortuni dettagliato): sono dati che la UI mostra e non interroga mai, quindi
 * non meritano colonne. `coverage` dice quali fonti hanno effettivamente coperto
 * il giocatore, ed e' cio' che distingue "dato assente" da "valore nullo".
 */
export const CREATE_PLAYER_STATS_SQL = `
CREATE TABLE IF NOT EXISTS player_stats (
  player_id       INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  season          TEXT,

  -- Rendimento storico (fonte: Fantacalcio.it)
  presenze        INTEGER,
  minuti          INTEGER,
  media_voto      REAL,
  fantamedia      REAL,
  gol             INTEGER,
  assist          INTEGER,
  ammonizioni     INTEGER,
  espulsioni      INTEGER,

  -- Metriche analitiche (fonte: Understat)
  xg              REAL,
  npxg            REAL,
  xa              REAL,
  xg_chain        REAL,
  xg_buildup      REAL,
  tiri            INTEGER,
  key_passes      INTEGER,

  -- Rischio infortuni (fonte: Transfermarkt)
  injury_days     INTEGER,
  injury_matches  INTEGER,
  injury_risk     REAL,

  -- Payload variabile: heatmap, storico infortuni dettagliato.
  extra           TEXT,
  -- Flag di copertura per fonte, in JSON.
  coverage        TEXT,
  updated_at      INTEGER NOT NULL
);
`;

/**
 * Chiave/valore per la versione del dataset applicato in locale (US20-1).
 *
 * Una tabella e non un PRAGMA o AsyncStorage: la versione dei dati deve poter
 * essere aggiornata nella *stessa transazione* che scrive i dati. Altrimenti un
 * crash a meta' sync lascerebbe l'app convinta di avere dati che non ha.
 */
export const CREATE_DATASET_META_SQL = `
CREATE TABLE IF NOT EXISTS dataset_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/**
 * DDL completo nella forma corrente. Gira solo su database vergine
 * (`user_version = 0`): chi arriva da v1/v2 passa dagli step di `migrations.ts`.
 *
 * Composto e non riscritto: le tabelle di v3 hanno una definizione sola, usata
 * sia dall'installazione pulita sia dallo step di upgrade. Duplicarla
 * significherebbe poterle far divergere.
 */
export const CREATE_TABLES_SQL =
  CORE_TABLES_SQL + CREATE_PLAYER_STATS_SQL + CREATE_DATASET_META_SQL;

/**
 * Upgrade v1 -> v2 per i database gia' installati.
 *
 * `watchlist` va ricostruita e non semplicemente estesa: SQLite non sa togliere
 * il vincolo `UNIQUE(player_id)` con un ALTER, e quel vincolo impedirebbe allo
 * stesso giocatore di comparire in due configurazioni diverse. Si usa quindi la
 * procedura canonica tabella-nuova / copia / drop / rename.
 *
 * Le righe esistenti vengono adottate da una configurazione ponte creata dal
 * codice chiamante (vedi `migrations.ts`), il cui id viene sostituito a `?`.
 */
export const MIGRATE_V2_CONFIGURATIONS_SQL = `
CREATE TABLE IF NOT EXISTS configurations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL UNIQUE,
  participants INTEGER NOT NULL,
  credits      INTEGER NOT NULL,
  slot_p       INTEGER NOT NULL,
  slot_d       INTEGER NOT NULL,
  slot_c       INTEGER NOT NULL,
  slot_a       INTEGER NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
`;

export const MIGRATE_V2_WATCHLIST_CREATE_SQL = `
CREATE TABLE watchlist_v2 (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  config_id   INTEGER NOT NULL REFERENCES configurations(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  added_at    INTEGER NOT NULL,
  UNIQUE (player_id, config_id)
);
`;

/** Il `?` e' l'id della configurazione ponte a cui adottare le righe esistenti. */
export const MIGRATE_V2_WATCHLIST_COPY_SQL = `
INSERT INTO watchlist_v2 (player_id, config_id, category_id, added_at)
SELECT player_id, ?, category_id, added_at FROM watchlist;
`;

export const MIGRATE_V2_WATCHLIST_SWAP_SQL = `
DROP TABLE watchlist;
ALTER TABLE watchlist_v2 RENAME TO watchlist;
CREATE INDEX IF NOT EXISTS idx_watchlist_category ON watchlist(category_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_config ON watchlist(config_id);
`;

/** Upsert del listone (US7-T3): aggiorna solo i campi volatili, l'id resta la chiave. */
export const UPSERT_PLAYER_SQL = `
INSERT INTO players
  (id, r, rm, nome, squadra, qt_a, qt_i, diff, qt_a_m, qt_i_m, diff_m, fvm, fvm_m, is_active)
VALUES
  (?,  ?, ?,  ?,    ?,       ?,    ?,    ?,    ?,      ?,      ?,      ?,   ?,     ?)
ON CONFLICT(id) DO UPDATE SET
  r         = excluded.r,
  rm        = excluded.rm,
  nome      = excluded.nome,
  squadra   = excluded.squadra,
  qt_a      = excluded.qt_a,
  qt_i      = excluded.qt_i,
  diff      = excluded.diff,
  qt_a_m    = excluded.qt_a_m,
  qt_i_m    = excluded.qt_i_m,
  diff_m    = excluded.diff_m,
  fvm       = excluded.fvm,
  fvm_m     = excluded.fvm_m,
  is_active = excluded.is_active;
`;

/**
 * Upsert delle metriche (US20-T3).
 *
 * Sovrascrive per intero, `excluded` su ogni colonna: il dataset e' generato in
 * blocco da `scripts/build_dataset.py` e rappresenta lo stato completo di una
 * versione. Una fusione campo per campo lascerebbe in giro metriche vecchie di
 * fonti nel frattempo rimosse, senza che nulla lo segnali.
 */
export const UPSERT_PLAYER_STATS_SQL = `
INSERT INTO player_stats
  (player_id, season, presenze, minuti, media_voto, fantamedia, gol, assist,
   ammonizioni, espulsioni, xg, npxg, xa, xg_chain, xg_buildup, tiri, key_passes,
   injury_days, injury_matches, injury_risk, extra, coverage, updated_at)
VALUES
  (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(player_id) DO UPDATE SET
  season         = excluded.season,
  presenze       = excluded.presenze,
  minuti         = excluded.minuti,
  media_voto     = excluded.media_voto,
  fantamedia     = excluded.fantamedia,
  gol            = excluded.gol,
  assist         = excluded.assist,
  ammonizioni    = excluded.ammonizioni,
  espulsioni     = excluded.espulsioni,
  xg             = excluded.xg,
  npxg           = excluded.npxg,
  xa             = excluded.xa,
  xg_chain       = excluded.xg_chain,
  xg_buildup     = excluded.xg_buildup,
  tiri           = excluded.tiri,
  key_passes     = excluded.key_passes,
  injury_days    = excluded.injury_days,
  injury_matches = excluded.injury_matches,
  injury_risk    = excluded.injury_risk,
  extra          = excluded.extra,
  coverage       = excluded.coverage,
  updated_at     = excluded.updated_at;
`;

/**
 * Disattivazione preventiva, primo statement del sync completo (US20-3).
 *
 * Si spegne tutto e l'upsert riaccende chi e' presente nel dataset: chi non
 * compare piu' resta a `is_active = 0`. Gira nella stessa transazione
 * dell'upsert, quindi non esiste un istante osservabile con il listone spento.
 *
 * `is_active = 0` e non DELETE: la watchlist referenzia `players(id)` e una
 * cancellazione la trascinerebbe via in CASCADE. E' la stessa politica gia'
 * applicata ai ceduti del listone ufficiale.
 *
 * L'alternativa "NOT IN (lista di id)" e' stata scartata: 500 segnaposto
 * sfiorano il limite di variabili di SQLite, e `json_each` richiederebbe di
 * dipendere dall'estensione JSON1.
 */
export const DEACTIVATE_ALL_PLAYERS_SQL = `UPDATE players SET is_active = 0;`;
