import { CLASSIC_ROLES, type ClassicRole } from './roles';

/**
 * Configurazione d'asta: partecipanti, crediti e composizione della rosa.
 *
 * Entita' fuori dallo scope delle User Stories dello Sprint 1: e' il contesto da
 * cui dipenderanno tutti i calcoli futuri (budget per reparto, prezzo massimo
 * sostenibile, suggerimenti dell'agente). Il modulo e' puro — nessun import
 * Expo/SQLite — cosi' le regole restano testabili senza ambiente nativo.
 *
 * Ogni configurazione possiede la propria watchlist: le scelte fatte per la lega
 * con gli amici non devono inquinare quella dell'ufficio.
 */

/** Slot di rosa per ruolo Classic. Le chiavi sono i ruoli di `roles.ts`. */
export type RoleSlots = Record<ClassicRole, number>;

export interface Configuration {
  id: number;
  name: string;
  participants: number;
  credits: number;
  slots: RoleSlots;
  /** Una sola configurazione e' attiva alla volta (vincolo applicativo, non DB). */
  isActive: boolean;
  createdAt: number;
}

/** Cio' che l'utente compila: l'id e lo stato attivo li decide il sistema. */
export interface ConfigurationDraft {
  name: string;
  participants: number;
  credits: number;
  slots: RoleSlots;
}

/** Riga SQLite: slot appiattiti in colonne, booleani come 0/1. */
export interface ConfigurationRow {
  id: number;
  name: string;
  participants: number;
  credits: number;
  slot_p: number;
  slot_d: number;
  slot_c: number;
  slot_a: number;
  is_active: number;
  created_at: number;
}

export function rowToConfiguration(row: ConfigurationRow): Configuration {
  return {
    id: row.id,
    name: row.name,
    participants: row.participants,
    credits: row.credits,
    slots: { P: row.slot_p, D: row.slot_d, C: row.slot_c, A: row.slot_a },
    isActive: row.is_active === 1,
    createdAt: row.created_at,
  };
}

/** Default del fantacalcio Classic: 25 calciatori, 3-8-8-6. */
export const DEFAULT_SLOTS: RoleSlots = { P: 3, D: 8, C: 8, A: 6 };
export const DEFAULT_PARTICIPANTS = 8;
export const DEFAULT_CREDITS = 500;
export const DEFAULT_CONFIGURATION_NAME = 'La mia lega';

export const MAX_CONFIGURATION_NAME_LENGTH = 40;
export const MIN_PARTICIPANTS = 2;
export const MAX_PARTICIPANTS = 20;
export const MAX_SLOTS_PER_ROLE = 30;

export function createDefaultDraft(): ConfigurationDraft {
  return {
    name: DEFAULT_CONFIGURATION_NAME,
    participants: DEFAULT_PARTICIPANTS,
    credits: DEFAULT_CREDITS,
    slots: { ...DEFAULT_SLOTS },
  };
}

/**
 * Totale dei calciatori in rosa: e' sempre derivato, mai inserito a mano.
 * Cosi' il numero mostrato e la somma degli slot non possono divergere.
 */
export function rosaSize(slots: RoleSlots): number {
  return CLASSIC_ROLES.reduce((total, role) => total + slots[role], 0);
}

/** Crediti spendibili in media per calciatore: utile come riepilogo in UI. */
export function creditsPerSlot(config: Pick<Configuration, 'credits' | 'slots'>): number {
  const size = rosaSize(config.slots);
  return size === 0 ? 0 : config.credits / size;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/**
 * Validazione condivisa fra UI e hook: unica fonte di verita' sulle regole.
 * Stessa forma di ritorno di `validateCategoryName` — `true` oppure il motivo.
 */
export function validateConfigurationDraft(
  draft: ConfigurationDraft,
  existing: ReadonlyArray<Configuration>,
  ignoreId?: number
): true | string {
  const trimmed = draft.name.trim();
  if (!trimmed) return 'Il nome non può essere vuoto.';
  if (trimmed.length > MAX_CONFIGURATION_NAME_LENGTH) {
    return `Massimo ${MAX_CONFIGURATION_NAME_LENGTH} caratteri.`;
  }
  const clash = existing.some(
    (c) => c.id !== ignoreId && c.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (clash) return 'Esiste già una configurazione con questo nome.';

  if (!isPositiveInteger(draft.participants)) {
    return 'Il numero di partecipanti deve essere un intero positivo.';
  }
  if (draft.participants < MIN_PARTICIPANTS || draft.participants > MAX_PARTICIPANTS) {
    return `I partecipanti devono essere fra ${MIN_PARTICIPANTS} e ${MAX_PARTICIPANTS}.`;
  }

  if (!isPositiveInteger(draft.credits)) {
    return 'I crediti devono essere un intero maggiore di zero.';
  }

  for (const role of CLASSIC_ROLES) {
    const slot = draft.slots[role];
    if (!Number.isInteger(slot) || slot < 0) {
      return 'Gli slot per ruolo non possono essere negativi.';
    }
    if (slot > MAX_SLOTS_PER_ROLE) {
      return `Massimo ${MAX_SLOTS_PER_ROLE} slot per ruolo.`;
    }
  }

  if (rosaSize(draft.slots) === 0) {
    return 'La rosa deve contenere almeno un calciatore.';
  }

  return true;
}
