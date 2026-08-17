/**
 * Categorie della Watchlist.
 *
 * Le User Stories le davano hardcoded e in due varianti contraddittorie
 * (US3: "Must-Have/Alternative/Scommesse"; US8-T1: "Primo slot2/Titolari/…").
 * Scelta di prodotto: sono invece entita' persistite ed editabili dall'utente.
 * Le costanti sotto sono solo il seed del primo avvio.
 */

export interface Category {
  id: number;
  name: string;
  /** Colore esadecimale del badge (US4-T1). */
  color: string;
  sort_order: number;
  /** true per le 4 categorie create al primo avvio; restano comunque modificabili. */
  is_default: boolean;
}

export interface CategoryRow extends Omit<Category, 'is_default'> {
  is_default: number;
}

export function rowToCategory(row: CategoryRow): Category {
  return { ...row, is_default: row.is_default === 1 };
}

export const DEFAULT_CATEGORIES: ReadonlyArray<{ name: string; color: string }> = [
  { name: 'Must-Have', color: '#22C55E' },
  { name: 'Alternative', color: '#3B82F6' },
  { name: 'Scommesse', color: '#A855F7' },
  { name: 'Da Evitare', color: '#EF4444' },
];

/** Palette offerta all'utente quando crea o ricolora una categoria. */
export const CATEGORY_PALETTE: readonly string[] = [
  '#22C55E',
  '#3B82F6',
  '#A855F7',
  '#EF4444',
  '#F59E0B',
  '#14B8A6',
  '#EC4899',
  '#64748B',
];

export const MAX_CATEGORY_NAME_LENGTH = 24;

/** Validazione condivisa fra UI e pipeline: unica fonte di verita' sulle regole. */
export function validateCategoryName(
  name: string,
  existing: ReadonlyArray<Category>,
  ignoreId?: number
): true | string {
  const trimmed = name.trim();
  if (!trimmed) return 'Il nome non può essere vuoto.';
  if (trimmed.length > MAX_CATEGORY_NAME_LENGTH) {
    return `Massimo ${MAX_CATEGORY_NAME_LENGTH} caratteri.`;
  }
  const clash = existing.some(
    (c) => c.id !== ignoreId && c.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (clash) return 'Esiste già una categoria con questo nome.';
  return true;
}
