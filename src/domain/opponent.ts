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
 * Sono i crediti che le restano, e basta: chi ne ha 500 puo' spenderli tutti su
 * un nome solo.
 *
 * --- Perche' non riserva piu' un credito per slot ---
 * La versione precedente sottraeva uno per ogni casella ancora vuota (500
 * crediti e 25 slot davano 476), sul presupposto che la rosa vada comunque
 * completata. E' una **regola di lega**, non un'invariante: dove completare non
 * e' obbligatorio, quella riserva mostrava un tetto che non esiste e — peggio —
 * faceva rifiutare al motore offerte perfettamente legittime.
 *
 * Fra i due errori possibili si e' scelto il meno grave: mostrare un tetto piu'
 * alto del reale lascia decidere all'utente, mostrarne uno piu' basso gli
 * impedisce di registrare quel che e' successo davvero al tavolo.
 *
 * A rosa completa resta zero: non c'e' dove metterlo, a qualunque cifra.
 *
 * Vive qui e non in un componente perche' UI, validazione della transazione e
 * agente devono rispondere la stessa cosa, definita una volta sola.
 */
export function offertaMassima(opponent: Opponent): number {
  if (slotRimanenti(opponent) <= 0) return 0;
  return Math.max(opponent.creditiResidui, 0);
}

/** Il minimo che serve per riconoscere una squadra: come si chiama e di chi e'. */
export interface Identita {
  nome: string;
  proprietario: string | null;
}

/** Nomi e proprietari si confrontano normalizzati, mai grezzi. */
export function chiaveNome(nome: string): string {
  return nome.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Accoppia le squadre comparse con quelle scomparse: chi ha solo cambiato nome.
 *
 * --- Il problema che risolve ---
 * Aggiornare la lega aggiunge soltanto, ed e' la scelta giusta a meta' d'asta:
 * cancellare una riga significherebbe buttare una rosa costruita in due ore. Ma
 * se un partecipante ribattezza la squadra, "aggiungi soltanto" lo mette al
 * tavolo **due volte**, e la copia arriva coi crediti pieni — cioe' un
 * avversario che non esiste e che secondo l'app puo' ancora rilanciare, proprio
 * nella schermata che serve a sapere chi puo' rilanciare.
 *
 * --- L'unica prova disponibile e' il proprietario ---
 * Il nome della squadra e' cambiato apposta; chi la possiede no.
 *
 * --- E si accoppia solo quando la prova e' univoca ---
 * Un proprietario, una scomparsa, una comparsa. Con due candidate non c'e' modo
 * di sapere quale sia diventata quale, e spostare una rosa sull'ipotesi
 * sbagliata e' irreversibile: meglio due righe e la decisione all'utente. Un
 * proprietario vuoto non accoppia niente — accomunerebbe fra loro tutte le
 * squadre di cui non sappiamo nulla, che e' l'assenza di prova, non una prova.
 */
export function abbinaRinomine<A extends Identita, B extends Identita>(
  comparse: ReadonlyArray<A>,
  scomparse: ReadonlyArray<B>
): Array<{ nuova: A; vecchia: B }> {
  const perProprietario = <T extends Identita>(voci: ReadonlyArray<T>): Map<string, T[]> => {
    const indice = new Map<string, T[]>();
    for (const voce of voci) {
      if (voce.proprietario === null || voce.proprietario.trim() === '') continue;
      const k = chiaveNome(voce.proprietario);
      indice.set(k, [...(indice.get(k) ?? []), voce]);
    }
    return indice;
  };

  const vecchiePer = perProprietario(scomparse);
  const abbinate: Array<{ nuova: A; vecchia: B }> = [];

  for (const [proprietario, gruppo] of perProprietario(comparse)) {
    const vecchie = vecchiePer.get(proprietario);
    const nuova = gruppo[0];
    const vecchia = vecchie?.[0];
    if (gruppo.length !== 1 || vecchie?.length !== 1) continue;
    if (nuova === undefined || vecchia === undefined) continue;
    abbinate.push({ nuova, vecchia });
  }

  return abbinate;
}
