import type { ClassicRole } from './roles';

/**
 * Le squadre al tavolo d'asta.
 *
 * L'app sa tutto dei giocatori e niente degli avversari, ed e' la meta' che
 * manca a qualunque consiglio d'asta: "Svilar vale 18" e' un'informazione,
 * "Svilar vale 18 e l'unico altro senza portiere ha 40 crediti" e' una
 * decisione.
 *
 * I dati arrivano da `scripts/dataset/stato_asta.json`, che li legge dalla lega
 * su Leghe Fantacalcio. Quel file e' un **seme**: si importa una volta e da li'
 * in poi lo stato vive nel dispositivo, perche' durante un'asta i crediti si
 * scalano dal telefono e non rilanciando uno scraper.
 */

export interface OpponentPick {
  /** Id del listone: lo stesso `players.id`, quindi la join e' esatta. */
  playerId: number;
  /** Prezzo pagato all'asta. `null` finche' non lo si registra. */
  prezzo: number | null;
}

export interface Opponent {
  id: number;
  configId: number;
  nome: string;
  /** Nickname del proprietario sul sito. `null` se il sito non lo espone. */
  proprietario: string | null;
  /**
   * La squadra dell'utente.
   *
   * Serve a distinguere "i miei crediti" dai crediti di chi mi contende il
   * giocatore: senza, l'agente sa quanto denaro c'e' in giro ma non quanto ne
   * ha chi gli sta chiedendo consiglio.
   */
  isMe: boolean;
  creditiResidui: number;
  slotLiberi: Record<ClassicRole, number>;
  rosa: OpponentPick[];
}

/** Riga piatta di `opponents`. SQLite non conosce oggetti annidati. */
export interface OpponentDbRow {
  id: number;
  config_id: number;
  nome: string;
  proprietario: string | null;
  is_me: number;
  crediti: number;
  slot_p: number;
  slot_d: number;
  slot_c: number;
  slot_a: number;
  /** JSON: elenco di `OpponentPick`. */
  rosa: string | null;
  updated_at: number;
}

export function rowToOpponent(row: OpponentDbRow): Opponent {
  return {
    id: row.id,
    configId: row.config_id,
    nome: row.nome,
    proprietario: row.proprietario,
    isMe: row.is_me === 1,
    creditiResidui: row.crediti,
    slotLiberi: { P: row.slot_p, D: row.slot_d, C: row.slot_c, A: row.slot_a },
    rosa: parseRosa(row.rosa),
  };
}

/**
 * Una rosa illeggibile degrada a vuota invece di far esplodere la schermata.
 * Stessa regola di `parseJson` in `playerStats.ts`: un JSON corrotto e' un dato
 * perso, non un'applicazione da chiudere.
 */
function parseRosa(raw: string | null): OpponentPick[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OpponentPick[]) : [];
  } catch {
    return [];
  }
}

/** Quanti slot restano in tutto: la somma, come `rosaSize()` per le configurazioni. */
export function slotRimanenti(opponent: Opponent): number {
  return opponent.slotLiberi.P + opponent.slotLiberi.D + opponent.slotLiberi.C + opponent.slotLiberi.A;
}

/**
 * Il massimo che quella squadra puo' offrire per un giocatore.
 *
 * Non e' il totale dei crediti: ogni slot ancora da riempire va coperto almeno
 * da un credito, altrimenti la rosa resta incompleta e in molte leghe non e'
 * ammesso. E' il numero che dice se un avversario puo' davvero rilanciare, e
 * calcolarlo qui — non nel modello — significa che UI e agente rispondono la
 * stessa cosa.
 */
export function offertaMassima(opponent: Opponent): number {
  const slot = slotRimanenti(opponent);
  if (slot <= 0) return 0;
  return Math.max(opponent.creditiResidui - (slot - 1), 0);
}
