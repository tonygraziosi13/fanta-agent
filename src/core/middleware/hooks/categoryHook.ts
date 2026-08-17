import {
  createCategory,
  deleteCategory,
  getAllCategories,
  reorderCategories,
  updateCategory,
} from '@/core/repositories/categoriesRepository';
import { validateCategoryName, type Category } from '@/domain/category';
import { useCategoriesStore } from '@/state/useCategoriesStore';
import { useWatchlistStore } from '@/state/useWatchlistStore';

/**
 * Gestione delle categorie personalizzate.
 *
 * Perche' NON usa createPipeline come gli altri hook:
 * la creazione ha bisogno dell'id generato da SQLite (AUTOINCREMENT) prima di
 * poter aggiornare lo stato in memoria. Il pattern "reduce sincrono + effect
 * differito" presuppone che lo stato locale sia calcolabile senza il DB, e qui
 * non lo e'. Forzarlo richiederebbe id temporanei da riconciliare: complessita'
 * ingiustificata per un'operazione rara e non nel percorso critico dello scroll.
 *
 * Restano invece asincrone e attese dalla UI: creare una categoria e' un'azione
 * deliberata dentro una schermata di gestione, non un tap durante lo scroll.
 * L'invariante "mai I/O nel percorso caldo" non viene violata.
 */

export interface CategoryMutationResult {
  ok: boolean;
  reason?: string;
}

async function resync(): Promise<Category[]> {
  const categories = await getAllCategories();
  useCategoriesStore.getState().setLocal(categories);
  return categories;
}

export async function addCategory(
  name: string,
  color: string
): Promise<CategoryMutationResult> {
  const existing = useCategoriesStore.getState().categories;
  const verdict = validateCategoryName(name, existing);
  if (verdict !== true) return { ok: false, reason: verdict };

  await createCategory(name, color);
  await resync();
  return { ok: true };
}

export async function renameCategory(
  id: number,
  name: string
): Promise<CategoryMutationResult> {
  const existing = useCategoriesStore.getState().categories;
  const verdict = validateCategoryName(name, existing, id);
  if (verdict !== true) return { ok: false, reason: verdict };

  await updateCategory(id, { name });
  await resync();
  return { ok: true };
}

export async function recolorCategory(
  id: number,
  color: string
): Promise<CategoryMutationResult> {
  await updateCategory(id, { color });
  await resync();
  return { ok: true };
}

/**
 * Eliminazione distruttiva.
 *
 * Il DB rimuove le assegnazioni via ON DELETE CASCADE; la mappa in memoria non
 * lo sa e va ripulita esplicitamente, altrimenti la Watchlist continuerebbe a
 * contare giocatori appartenenti a una categoria che non esiste piu'.
 * La conferma utente e' responsabilita' del chiamante (schermata categorie).
 */
export async function removeCategory(id: number): Promise<CategoryMutationResult> {
  const { categories } = useCategoriesStore.getState();
  if (categories.length <= 1) {
    return { ok: false, reason: 'Deve restare almeno una categoria.' };
  }

  await deleteCategory(id);
  useWatchlistStore.getState().removeCategoryLocal(id);
  await resync();
  return { ok: true };
}

export async function moveCategory(
  id: number,
  direction: -1 | 1
): Promise<CategoryMutationResult> {
  const categories = [...useCategoriesStore.getState().categories];
  const index = categories.findIndex((c) => c.id === id);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= categories.length) {
    return { ok: false, reason: 'Posizione non valida.' };
  }

  const a = categories[index];
  const b = categories[target];
  if (!a || !b) return { ok: false, reason: 'Posizione non valida.' };
  categories[index] = b;
  categories[target] = a;

  // Riordino ottimistico: la lista e' corta e la UI deve rispondere al tocco.
  useCategoriesStore.getState().setLocal(categories);
  await reorderCategories(categories.map((c) => c.id));
  return { ok: true };
}
