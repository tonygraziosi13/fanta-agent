import { create } from 'zustand';
import { getAllCategories } from '@/core/repositories/categoriesRepository';
import type { Category } from '@/domain/category';

/** Categorie in memoria. Lista corta (unita'), ma serve l'indice per i badge O(1). */

interface CategoriesState {
  categories: Category[];
  byId: Record<number, Category>;
  status: 'idle' | 'loading' | 'ready';
  load: () => Promise<void>;
  setLocal: (categories: Category[]) => void;
}

function indexById(categories: Category[]): Record<number, Category> {
  const byId: Record<number, Category> = {};
  for (const c of categories) byId[c.id] = c;
  return byId;
}

export const useCategoriesStore = create<CategoriesState>((set, get) => ({
  categories: [],
  byId: {},
  status: 'idle',

  load: async () => {
    if (get().status === 'loading') return;
    set({ status: 'loading' });
    const categories = await getAllCategories();
    set({ categories, byId: indexById(categories), status: 'ready' });
  },

  setLocal: (categories) => set({ categories, byId: indexById(categories) }),
}));

/** Sottoscrizione puntuale usata dal badge di PlayerRow. */
export function useCategory(categoryId: number | undefined): Category | undefined {
  return useCategoriesStore((state) =>
    categoryId === undefined ? undefined : state.byId[categoryId]
  );
}
