import { CLASSIC_ROLES, type ClassicRole } from '@/domain/roles';
import type { OpponentPick } from '@/domain/opponent';

/**
 * Lettura del seme `stato_asta.json` (US-agente).
 *
 * Puro: nessun SQLite, nessun React, nessuna dipendenza nativa. E' il pezzo che
 * si puo' testare, ed e' anche quello che vale la pena testare — il file arriva
 * da uno scraper che gira su un'altra macchina, ed e' la definizione di dato
 * non fidato: se il sito cambia, quel file cambia forma senza preavviso.
 *
 * La regola: **si scarta la riga rotta, non il file**. Un partecipante con i
 * crediti illeggibili non deve impedire di importare gli altri otto, e in asta
 * un import a meta' che lo dichiara vale piu' di un import fallito. E' lo
 * stesso principio di `datasetMapper`, che scarta il giocatore malformato e
 * riporta `skipped`.
 */

export interface SeedTeam {
  nome: string;
  proprietario: string | null;
  isMe: boolean;
  creditiResidui: number;
  slotLiberi: Record<ClassicRole, number>;
  rosa: OpponentPick[];
}

export interface SeedResult {
  teams: SeedTeam[];
  /** Righe scartate, con il perche': e' la lista di lavoro di chi ha generato il file. */
  skipped: Array<{ nome: unknown; reason: string }>;
}

export type ParseOutcome =
  | { ok: true; value: SeedResult }
  | { ok: false; error: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Un intero non negativo, o null se il valore non lo e'. */
function toCount(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function toSlots(raw: unknown): Record<ClassicRole, number> | null {
  if (!isObject(raw)) return null;

  const slots = {} as Record<ClassicRole, number>;
  for (const role of CLASSIC_ROLES) {
    const value = toCount(raw[role]);
    // Uno slot mancante non si assume zero: zero significa "reparto completo",
    // ed e' l'opposto di "non lo sappiamo". Meglio scartare la riga.
    if (value === null) return null;
    slots[role] = value;
  }
  return slots;
}

function toRosa(raw: unknown): OpponentPick[] {
  if (!Array.isArray(raw)) return [];

  const picks: OpponentPick[] = [];
  for (const voce of raw) {
    if (!isObject(voce)) continue;
    // Il file usa `id` (lo stesso del listone); si accetta anche `player_id`
    // per non legarsi a una sola grafia dello scraper.
    const playerId = toCount(voce.id ?? voce.player_id);
    if (playerId === null || playerId <= 0) continue;

    const prezzo = toCount(voce.prezzo);
    picks.push({ playerId, prezzo });
  }
  return picks;
}

/**
 * Interpreta il contenuto di `stato_asta.json`.
 *
 * Accetta il testo grezzo e non un oggetto gia' parsato: il chiamante puo'
 * averlo incollato a mano, e distinguere "JSON invalido" da "forma sbagliata"
 * e' proprio la prima cosa che serve sapere.
 */
export function parseStatoAsta(raw: string): ParseOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      error: `Il testo non è JSON valido: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'Atteso un array di squadre.' };
  }
  if (parsed.length === 0) {
    // Un file vuoto scritto sopra uno stato d'asta in corso cancellerebbe tutto:
    // e' quasi sempre uno scraper andato male, non una lega senza partecipanti.
    return { ok: false, error: 'Nessuna squadra nel file: import rifiutato.' };
  }

  const teams: SeedTeam[] = [];
  const skipped: SeedResult['skipped'] = [];
  const visti = new Set<string>();

  for (const voce of parsed) {
    if (!isObject(voce)) {
      skipped.push({ nome: voce, reason: 'voce non è un oggetto' });
      continue;
    }

    const nome = String(voce.nome_squadra ?? '').trim().replace(/\s+/g, ' ');
    if (nome === '') {
      skipped.push({ nome: voce.nome_squadra, reason: 'nome squadra mancante' });
      continue;
    }

    // `opponents` ha UNIQUE(config_id, nome): due righe con lo stesso nome
    // farebbero fallire l'intera transazione di import invece di una riga sola.
    const chiave = nome.toLowerCase();
    if (visti.has(chiave)) {
      skipped.push({ nome, reason: 'nome duplicato' });
      continue;
    }

    const crediti = toCount(voce.crediti_residui);
    if (crediti === null) {
      skipped.push({ nome, reason: 'crediti non validi' });
      continue;
    }

    const slotLiberi = toSlots(voce.slot_liberi);
    if (slotLiberi === null) {
      skipped.push({ nome, reason: 'slot per ruolo mancanti o non validi' });
      continue;
    }

    visti.add(chiave);
    const proprietario = String(voce.proprietario ?? '').trim();
    teams.push({
      nome,
      proprietario: proprietario === '' ? null : proprietario,
      isMe: voce.sono_io === true,
      creditiResidui: crediti,
      slotLiberi,
      rosa: toRosa(voce.rosa),
    });
  }

  if (teams.length === 0) {
    return { ok: false, error: 'Nessuna squadra valida nel file.' };
  }

  return { ok: true, value: { teams, skipped } };
}

/**
 * Le squadre marcate come "mia".
 *
 * Ne puo' esistere una sola: due renderebbero ambiguo ogni ragionamento
 * dell'agente sui *propri* crediti. Chi importa decide se è un errore da
 * segnalare o da ignorare — qui si conta soltanto.
 */
export function countMine(teams: SeedTeam[]): number {
  return teams.filter((t) => t.isMe).length;
}
