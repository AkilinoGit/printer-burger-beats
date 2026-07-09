// Descarga del catálogo de productos desde el backend (GET /api/v1/tpv/products).
// Solo lectura: la app reemplaza su tabla local con lo recibido (ver
// tpv-products-sync-plan.md). Convención de services/: nunca lanza.

import { apiGet, ApiError } from './apiConfig';
import type { ApiProduct, ProductCatalogResponse } from '../lib/types';

const CATALOG_PATH = '/api/v1/tpv/products';

export type FetchCatalogResult =
  | { ok: true; catalog: ProductCatalogResponse }
  | { ok: false; error: string };

/**
 * Descarga el catálogo completo. Normaliza los DECIMAL que puedan llegar como
 * string (basePrice, priceAdd) a number. Nunca lanza: devuelve { ok, error? }.
 */
export async function fetchProductCatalog(): Promise<FetchCatalogResult> {
  try {
    const data = await apiGet<ProductCatalogResponse>(CATALOG_PATH);
    const products = (data.products ?? []).map(normalizeProduct);
    // `profiles` es opcional: respuestas antiguas no lo traen y la app deriva
    // los perfiles de los productos. Se pasa tal cual (solo strings/números).
    const profiles = Array.isArray(data.profiles) ? data.profiles : [];
    return { ok: true, catalog: { version: data.version ?? null, products, profiles } };
  } catch (e) {
    const error = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Error desconocido';
    return { ok: false, error };
  }
}

function normalizeProduct(p: ApiProduct): ApiProduct {
  return {
    ...p,
    basePrice: toNumber(p.basePrice),
    feriantePrice: p.feriantePrice !== undefined && p.feriantePrice !== null
      ? toNumber(p.feriantePrice)
      : null,
    modifiers: (p.modifiers ?? []).map((m) => ({
      ...m,
      priceAdd: m.priceAdd !== undefined && m.priceAdd !== null ? toNumber(m.priceAdd) : undefined,
    })),
  };
}

function toNumber(v: number | string): number {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
