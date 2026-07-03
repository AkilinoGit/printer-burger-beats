// Subida de precios (base + feriante) al backend TPV.
//
// Dirección TPV → backend de la sincronización de precios: cuando el operario
// edita precios en Ajustes se envían aquí (POST /api/v1/tpv/products/prices).
// La dirección inversa (backend → TPV) viaja en el catálogo (catalogApi.ts).
//
// Si un envío falla (sin red / sin API) el payload se guarda en AsyncStorage
// ("pending push") y se reintenta desde el botón de Sincronización unificada
// (syncAll.ts) ANTES de bajar el catálogo, para que el edit local no aplicado
// gane sobre lo que devuelve el backend.
//
// Convención de services/: nunca lanza; devuelve { ok, ... } / { ok:false, error }.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiPost, ApiError } from './apiConfig';

const PRICES_PATH = '/api/v1/tpv/products/prices';
const PENDING_PUSH_KEY = 'tpv:pendingPricePush';

/** Un cambio de precio para un producto. `feriantePrice: null` = quitar la oferta. */
export interface PricePush {
  id: string;
  basePrice?: number;
  feriantePrice?: number | null;
}

interface UpdatePricesResponse {
  updated: number;
}

export type PushPricesResult =
  | { ok: true; updated: number }
  | { ok: false; error: string };

/** Envía los cambios de precio al backend. No persiste nada por sí sola. */
export async function pushPrices(items: PricePush[]): Promise<PushPricesResult> {
  if (items.length === 0) return { ok: true, updated: 0 };
  try {
    const data = await apiPost<UpdatePricesResponse>(PRICES_PATH, { prices: items });
    return { ok: true, updated: data.updated ?? 0 };
  } catch (e) {
    const error =
      e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Error desconocido';
    return { ok: false, error };
  }
}

// ── cola local de reintento ("pending push") ────────────────────────────────
// Se guarda como mapa id → { basePrice?, feriantePrice? } para fusionar cambios
// sucesivos sobre el mismo producto sin duplicar.

type PendingMap = Record<string, { basePrice?: number; feriantePrice?: number | null }>;

async function readPending(): Promise<PendingMap> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_PUSH_KEY);
    return raw ? (JSON.parse(raw) as PendingMap) : {};
  } catch {
    return {};
  }
}

/** Fusiona cambios pendientes de envío (los últimos valores ganan por producto). */
export async function mergePendingPush(items: PricePush[]): Promise<void> {
  if (items.length === 0) return;
  try {
    const pending = await readPending();
    for (const it of items) {
      const prev = pending[it.id] ?? {};
      if (it.basePrice !== undefined) prev.basePrice = it.basePrice;
      if (it.feriantePrice !== undefined) prev.feriantePrice = it.feriantePrice;
      pending[it.id] = prev;
    }
    await AsyncStorage.setItem(PENDING_PUSH_KEY, JSON.stringify(pending));
  } catch {
    // silently ignore
  }
}

/** Devuelve los cambios pendientes como lista de PricePush (o [] si no hay). */
export async function takePendingPush(): Promise<PricePush[]> {
  const pending = await readPending();
  return Object.entries(pending).map(([id, v]) => ({ id, ...v }));
}

/** Vacía la cola de reintento tras un envío correcto. */
export async function clearPendingPush(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_PUSH_KEY);
  } catch {
    // silently ignore
  }
}

/**
 * Intenta subir los precios inmediatamente; si falla, los deja en la cola de
 * reintento. Pensado para usarse desde Ajustes al guardar precios (best-effort,
 * no bloquea la UI). Devuelve el resultado del intento inmediato.
 */
export async function savePricesAndQueue(items: PricePush[]): Promise<PushPricesResult> {
  const res = await pushPrices(items);
  if (!res.ok) {
    await mergePendingPush(items);
  }
  return res;
}
