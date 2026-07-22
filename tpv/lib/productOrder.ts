import type { Product } from './types';

/**
 * Fuente de verdad única para el orden en que se presentan los productos:
 * agrupados por `category` (texto libre), con las categorías ordenadas por
 * `categoryOrder` (menor primero) y, a igualdad, por su etiqueta. Dentro de
 * cada categoría los productos conservan su orden de aparición en el array.
 *
 * Lo usan la pantalla de venta (ProductGrid) y el diálogo de precios de sesión
 * para que ambas muestren los productos exactamente en el mismo orden.
 */
export interface CategoryGroup {
  label: string;      // el propio valor de `category` — es el encabezado
  order: number;      // categoryOrder (menor primero)
  products: Product[];
}

export function groupProductsByCategory(products: Product[]): CategoryGroup[] {
  const map = new Map<string, CategoryGroup>();
  let appearance = 0;
  for (const p of products) {
    if (!p.isActive) continue;
    const label = p.category;
    let group = map.get(label);
    if (!group) {
      group = { label, order: p.categoryOrder ?? appearance++, products: [] };
      map.set(label, group);
    }
    group.products.push(p);
  }
  return [...map.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

/** Lista plana de productos en el mismo orden que muestra la pantalla de venta. */
export function orderProductsForSale(products: Product[]): Product[] {
  return groupProductsByCategory(products).flatMap((g) => g.products);
}
