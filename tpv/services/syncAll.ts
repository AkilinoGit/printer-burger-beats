// Orquestador de sincronización unificada.
//
// Agrupa TODAS las sincronizaciones de datos en una sola operación disparada
// desde un único botón en Ajustes → Sincronización.
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
import { syncSessions } from './sessionsApi';
import { syncTickets } from './ticketsApi';
import { getAllLocalProducts, replaceProductCatalogKeeping } from './db';
import { useSessionStore } from '../stores/useSessionStore';
import type { Product } from '../lib/types';

/**
 * Callback que decide, ante productos que la sincronización de catálogo haría
 * desaparecer (existen en local pero el backend ya no los trae), cuáles borrar de
 * verdad. Recibe los candidatos y devuelve el conjunto de `id` a ELIMINAR; los que
 * no se devuelvan se conservan. Es la red de seguridad contra borrados accidentales
 * (backend vacío/reseteado): la UI la implementa mostrando un modal de revisión.
 *
 * Si no se pasa (p.ej. sync automático en segundo plano), NADA se borra: los
 * candidatos se conservan siempre. Solo una revisión explícita puede eliminar.
 */
export type ConfirmCatalogDeletions = (candidates: Product[]) => Promise<Set<string>>;

export interface FullSyncOptions {
  confirmCatalogDeletions?: ConfirmCatalogDeletions;
}

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

/**
 * Descarga el catálogo de productos y reemplaza la tabla local. Nunca borra a
 * ciegas: los productos que existen en local pero el backend ya no trae se tratan
 * como CANDIDATOS a borrado y pasan por `confirm` (si se pasó). Solo se elimina lo
 * que `confirm` devuelva; el resto se conserva. Sin `confirm`, no se borra nada.
 */
async function syncCatalogTask(confirm?: ConfirmCatalogDeletions): Promise<SyncTaskResult> {
  const label = 'Productos';
  const res = await fetchProductCatalog();
  if (!res.ok) return { label, ok: false, detail: res.error };

  // Candidatos a desaparecer: locales (activos e inactivos) cuyo id no viene en el
  // catálogo del backend. El reemplazo borra ambos por igual, así que se comparan
  // todos, no solo los activos.
  const incomingIds = new Set(res.catalog.products.map((p) => p.id));
  const local = await getAllLocalProducts();
  const candidates = local.filter((p) => !incomingIds.has(p.id));

  // Por defecto (sin revisión) se conservan TODOS los candidatos.
  let deleteIds = new Set<string>();
  if (candidates.length > 0 && confirm) {
    deleteIds = await confirm(candidates);
  }
  const survivors = candidates.filter((p) => !deleteIds.has(p.id));

  await replaceProductCatalogKeeping(res.catalog.products, survivors);
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
  const deleted = deleteIds.size;
  const kept = survivors.length;
  // Detalle: base "N productos" + resumen de la revisión de borrados si la hubo.
  let detail = `${n} ${n === 1 ? 'producto' : 'productos'}`;
  if (deleted > 0) detail += `, ${deleted} ${deleted === 1 ? 'eliminado' : 'eliminados'}`;
  if (kept > 0) {
    const suffix = confirm ? 'conservado' : 'conservado sin revisar';
    const suffixPl = confirm ? 'conservados' : 'conservados sin revisar';
    detail += `, ${kept} ${kept === 1 ? suffix : suffixPl}`;
  }
  return { label, ok: true, detail };
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

/**
 * Sincroniza las sesiones (jornadas) en ambas direcciones. Va DESPUÉS de Locales
 * (FK: una sesión referencia su ubicación) y de Productos (los priceOverrides
 * referencian productos). Ver tpv-sessions-sync-plan.md.
 */
async function syncSessionsTask(): Promise<SyncTaskResult> {
  const label = 'Sesiones';
  const res = await syncSessions();
  const detail = `${res.pushed} ${res.pushed === 1 ? 'enviada' : 'enviadas'}, ${res.pulled} ${res.pulled === 1 ? 'recibida' : 'recibidas'}`;
  if (!res.ok) {
    // Aun con error puede haberse subido/bajado algo: lo reportamos junto al motivo.
    return { label, ok: false, detail: `${detail} — ${res.error}` };
  }

  await AsyncStorage.setItem('tpv:sessionsSyncedAt', new Date().toISOString());
  return { label, ok: true, detail };
}

/**
 * Sincroniza las comandas (tickets). Va DESPUÉS de Sesiones: una comanda cuelga
 * de su sesión (FK). Ver tpv-orders-sync-plan.md.
 */
async function syncTicketsTask(): Promise<SyncTaskResult> {
  const label = 'Comandas';
  const res = await syncTickets();
  const detail = `${res.pushed} ${res.pushed === 1 ? 'enviada' : 'enviadas'}, ${res.pulled} ${res.pulled === 1 ? 'recibida' : 'recibidas'}`;
  if (!res.ok) {
    return { label, ok: false, detail: `${detail} — ${res.error}` };
  }

  await AsyncStorage.setItem('tpv:ticketsSyncedAt', new Date().toISOString());
  return { label, ok: true, detail };
}

// Registro de sincronizaciones. Añade aquí cualquier sync futuro (salvo la cola
// de tickets) para que se ejecute desde el botón unificado. Es una función para
// que la task de catálogo pueda capturar el callback de revisión de borrados.
function buildTasks(opts: FullSyncOptions): SyncTask[] {
  return [
    // Precios ANTES del catálogo: reintenta subir ediciones locales pendientes para
    // que ganen sobre lo que el catálogo baje a continuación.
    { label: 'Precios', run: syncPricesTask },
    { label: 'Productos', run: () => syncCatalogTask(opts.confirmCatalogDeletions) },
    { label: 'Locales', run: syncLocationsTask },
    // Sesiones al final: dependen de Locales (FK) y de Productos (priceOverrides).
    { label: 'Sesiones', run: syncSessionsTask },
    // Comandas después de Sesiones: cada comanda cuelga de su sesión (FK).
    { label: 'Comandas', run: syncTicketsTask },
  ];
}

// ── público ────────────────────────────────────────────────────────────────

/**
 * Ejecuta todas las sincronizaciones registradas de forma secuencial. Un fallo
 * en una no aborta las demás. Nunca lanza: cada task captura su propio error y
 * lo reporta como { ok:false, detail }.
 *
 * `opts.confirmCatalogDeletions` permite revisar (y vetar) los productos que la
 * sincronización de catálogo eliminaría. Sin él, no se borra ningún producto.
 */
export async function runFullSync(opts: FullSyncOptions = {}): Promise<FullSyncResult> {
  const results: SyncTaskResult[] = [];
  for (const task of buildTasks(opts)) {
    try {
      results.push(await task.run());
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      results.push({ label: task.label, ok: false, detail });
    }
  }
  return { results, allOk: results.every((r) => r.ok) };
}
