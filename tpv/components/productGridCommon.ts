import type { Product } from '../lib/types';
import { groupProductsByCategory } from '../lib/productOrder';

/**
 * Paleta de colores para las categorías, asignada por su orden de aparición.
 * Los 4 primeros coinciden con la paleta clásica burger (HAMBURGUESAS,
 * ACOMPAÑANTES, BEBIDAS, OTROS) para no cambiar el aspecto actual.
 */
export const CATEGORY_PALETTE = [
  '#E53935', '#FB8C00', '#1E88E5', '#43A047',
  '#00897B', '#8E24AA', '#C2185B', '#5D4037', '#3949AB', '#F4511E',
];

export interface ColoredCategoryGroup {
  label: string;   // el propio valor de `category` — es el encabezado
  color: string;
  products: Product[];
}

/**
 * Toma el agrupado/ordenado compartido (ver `lib/productOrder`) y le asigna un
 * color por la posición final de cada categoría. La ordenación en sí vive en el
 * módulo compartido para que la pantalla de venta y el diálogo de precios de
 * sesión muestren los productos en el mismo orden.
 *
 * Lo usan las dos vistas de la carta (clásica y compacta) para que una misma
 * categoría tenga siempre el mismo color en ambas.
 */
export function buildColoredCategories(products: Product[]): ColoredCategoryGroup[] {
  return groupProductsByCategory(products).map((g, i) => ({
    label: g.label,
    color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length],
    products: g.products,
  }));
}
