// Orquestador de sincronización unificada.
//
// Agrupa TODAS las sincronizaciones de datos en una sola operación disparada
// desde un único botón en Ajustes → Sincronización. La ÚNICA excepción es la
// cola de tickets/pedidos (sync_queue), que tiene su propio botón porque su
// naturaleza (reintento de cola local) es distinta.
//
// Para añadir una nueva sincronización basta con registrar una SyncTask en el
// array TASKS: quedará disponible automáticamente desde el botón unificado, sin
// tocar la UI. Cada task encapsula su propia lógica y efectos secundarios
// (persistencia en AsyncStorage, recarga de stores…) y NUNCA lanza.
//
// Convención de services/: nunca lanza; devuelve un resultado agregado.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { fetchProductCatalog } from './catalogApi';
import { syncLocations } from './locationsApi';
import { clearPendingPush, pushPrices, takePendingPush, mergePendingPush } from './pricesApi';
import { replaceProductCatalog } from './db';
import { useSessionStore } from '../stores/useSessionStore';

export interface SyncTaskResult {
  label: string;
  ok: boolean;
  detail: string; // resumen ("12 productos") o mensaje de error
}

export interface FullSyncResult {
  results: SyncTaskResult[];
  allOk: boolean;
}

interface SyncTask {
  label: string;
  run: () => Promise<SyncTaskResult>;
}

// ── tasks ────────────────────────────────────────────────────────────────────

/**
 * Reintenta subir los precios que quedaron pendientes de un guardado offline.
 * Se ejecuta ANTES del catálogo para que el edit local no aplicado gane sobre lo
 * que devuelve el backend. Si no hay pendientes, es un no-op correcto.
 */
async function syncPricesTask(): Promise<SyncTaskResult> {
  const label = 'Precios';
  const pending = await takePendingPush();
  if (pending.length === 0) return { label, ok: true, detail: 'sin cambios' };

  const res = await pushPrices(pending);
  if (!res.ok) {
    // Mantener la cola para el próximo intento.
    await mergePendingPush(pending);
    return { label, ok: false, detail: res.error };
  }
  await clearPendingPush();
  return { label, ok: true, detail: `${res.updated} ${res.updated === 1 ? 'actualizado' : 'actualizados'}` };
}

/** Descarga el catálogo de productos y reemplaza la tabla local. */
async function syncCatalogTask(): Promise<SyncTaskResult> {
  const label = 'Productos';
  const res = await fetchProductCatalog();
  if (!res.ok) return { label, ok: false, detail: res.error };

  await replaceProductCatalog(res.catalog.products);
  const now = new Date().toISOString();
  await AsyncStorage.multiSet([
    ['tpv:catalogVersion', res.catalog.version ?? ''],
    ['tpv:catalogUpdatedAt', now],
    // Lista de perfiles de carta (entidad backend). Vacío ⇒ la app los deriva
    // de los productos. Persistido para que el selector funcione offline.
    ['tpv:catalogProfiles', JSON.stringify(res.catalog.profiles ?? [])],
  ]);

  // Dirección backend → TPV de los precios feriante: los productos que traen
  // feriantePrice no nulo actualizan el mapa feriante del store (persistido).
  const store = useSessionStore.getState();
  const mergedFeriante = { ...store.feriantePrices };
  for (const p of res.catalog.products) {
    if (typeof p.feriantePrice === 'number') {
      mergedFeriante[p.id] = p.feriantePrice;
    }
  }
  await store.setFeriantePrices(mergedFeriante);

  // Recargar el store desde SQLite para reflejar los productos nuevos en la UI,
  // y refrescar la lista de perfiles (recién persistida) para el selector.
  await useSessionStore.getState().loadProducts();
  await useSessionStore.getState().loadCatalogProfiles();

  const n = res.catalog.products.length;
  return { label, ok: true, detail: `${n} ${n === 1 ? 'producto' : 'productos'}` };
}

/** Sincroniza las ubicaciones (sube locales locales, baja los del backend). */
async function syncLocationsTask(): Promise<SyncTaskResult> {
  const label = 'Locales';
  const res = await syncLocations();
  if (!res.ok) return { label, ok: false, detail: res.error };

  await AsyncStorage.setItem('tpv:locationsSyncedAt', new Date().toISOString());
  return {
    label,
    ok: true,
    detail: `${res.pushed} ${res.pushed === 1 ? 'enviado' : 'enviados'}, ${res.pulled} ${res.pulled === 1 ? 'recibido' : 'recibidos'}`,
  };
}

// Registro de sincronizaciones. Añade aquí cualquier sync futuro (salvo la cola
// de tickets) para que se ejecute desde el botón unificado.
const TASKS: SyncTask[] = [
  // Precios ANTES del catálogo: reintenta subir ediciones locales pendientes para
  // que ganen sobre lo que el catálogo baje a continuación.
  { label: 'Precios', run: syncPricesTask },
  { label: 'Productos', run: syncCatalogTask },
  { label: 'Locales', run: syncLocationsTask },
];

// ── público ────────────────────────────────────────────────────────────────

/**
 * Ejecuta todas las sincronizaciones registradas de forma secuencial. Un fallo
 * en una no aborta las demás. Nunca lanza: cada task captura su propio error y
 * lo reporta como { ok:false, detail }.
 */
export async function runFullSync(): Promise<FullSyncResult> {
  const results: SyncTaskResult[] = [];
  for (const task of TASKS) {
    try {
      results.push(await task.run());
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      results.push({ label: task.label, ok: false, detail });
    }
  }
  return { results, allOk: results.every((r) => r.ok) };
}
