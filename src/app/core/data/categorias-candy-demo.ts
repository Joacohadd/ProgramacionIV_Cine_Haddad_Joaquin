import { CategoriaCandy } from '../models/categoria-candy.interface';

// Los mismos identificadores se usan para las categorías iniciales de Supabase.
export const CATEGORIA_OTROS_ID = 'c1000000-0000-4000-8000-000000000004';
export const CATEGORIAS_CANDY_DEMO: CategoriaCandy[] = [
  { id: 'c1000000-0000-4000-8000-000000000001', nombre: 'Pochoclos' },
  { id: 'c1000000-0000-4000-8000-000000000002', nombre: 'Bebidas' },
  { id: 'c1000000-0000-4000-8000-000000000003', nombre: 'Golosinas' },
  { id: CATEGORIA_OTROS_ID, nombre: 'Otros' }
];
