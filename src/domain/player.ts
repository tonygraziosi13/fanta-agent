import type { ClassicRole } from './roles';

/**
 * Un calciatore del listone ufficiale.
 * I nomi dei campi replicano 1:1 lo schema richiesto da US7-T1, cosi' che
 * riga SQLite, oggetto di dominio e record CSV restino allineati senza traduzioni.
 */
export interface Player {
  id: number;
  /** Ruolo Classic: P | D | C | A */
  r: ClassicRole;
  /** Ruolo Mantra grezzo, multi-valore separato da ';' (es. "Ds;Dc"). */
  rm: string | null;
  nome: string;
  squadra: string;

  /** Quotazioni Classic */
  qt_a: number;
  qt_i: number;
  diff: number;

  /** Quotazioni Mantra */
  qt_a_m: number;
  qt_i_m: number;
  diff_m: number;

  /** FantaValore di Mercato */
  fvm: number;
  fvm_m: number;

  /**
   * false = giocatore ceduto/svincolato. Non viene mai cancellato fisicamente:
   * eliminarlo romperebbe le watchlist gia' costruite dall'utente (US7-T1).
   */
  is_active: boolean;
}

/**
 * Riga SQLite grezza: SQLite non ha booleani, is_active viaggia come 0/1.
 * Nome deliberatamente `PlayerDbRow` e non `PlayerRow`: quest'ultimo e' il
 * componente UI della lista (US1-T2), la collisione confonderebbe gli import.
 */
export interface PlayerDbRow extends Omit<Player, 'is_active'> {
  is_active: number;
}

export function rowToPlayer(row: PlayerDbRow): Player {
  return { ...row, is_active: row.is_active === 1 };
}
