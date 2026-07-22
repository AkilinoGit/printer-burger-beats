// Sincronización de SESIONES (jornadas) con el backend TPV.
//
// A diferencia de los productos (el backend manda, la app hace replace total),
// aquí la TPV es la PRODUCTORA del dato: la dirección primaria es PUSH y el PULL
// nunca borra ni pisa una sesión con cambios locales pendientes.
// Ver tpv-sessions-sync-plan.md.
//
// Orden de una pasada de sync:
//   1. PUSH   — sube en lotes todas las sesiones con sync_status != 'synced'
//               (incluye el histórico en el primer arranque y los soft-deletes).
//   2. PULL   — baja lo cambiado desde el último sync y lo fusiona sin destruir.
// El push va ANTES del pull para que, ante un conflicto, lo local ya esté en el
// servidor y el merge lo respete.
//
// Convención de services/: nunca lanza; devuelve { ok, ... } / { ok:false, error }.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiGet, apiPost, ApiError } from './apiConfig';
import {
  adoptSessionAsLocal,
  getUnsyncedSessions,
  markSessionsSynced,
  markSessionsSyncError,
  upsertSessionsFromBackend,
} from './db';
import { getDeviceId } from '../lib/device';
import type { ApiSession, ApiSessionSyncResult, Session } from '../lib/types';

const SESSIONS_PATH = '/api/v1/tpv/sessions';
const BATCH_PATH = '/api/v1/tpv/sessions/batch';
const LAST_PULL_KEY = 'tpv:sessionsLastPull';
const PUSH_CHUNK = 200; // tope del backend por lote: 500; dejamos margen

export type SyncSessionsResult =
  | { ok: true; pushed: number; pulled: number }
  | { ok: false; error: string; pushed: number; pulled: number };

interface BatchResponse {
  results: ApiSessionSyncResult[];
  summary?: Record<string, number>;
  serverTime?: string;
}

interface ListResponse {
  sessions: ApiSession[];
  serverTime?: string;
}

// ── serialización TPV → API ─────────────────────────────────────────────────

/** Convierte una sesión local al cuerpo que espera el backend. */
function toApiBody(s: Session): Record<string, unknown> {
  return {
    id: s.id,
    locationId: s.locationId,
    date: s.date,
    status: s.status,
    priceOverrides: s.priceOverrides,
    notes: s.notes,
    sessionCode: s.sessionCode,
    openedAt: s.openedAt,
    autoCloseAt: s.autoCloseAt,
    closedAt: s.closedAt,
    deviceId: s.deviceId,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    deletedAt: s.deletedAt,
  };
}

// ── push ─────────────────────────────────────────────────────────────────────

/**
 * Sube todas las sesiones con cambios locales. Solo marca 'synced' las que el
 * backend confirma (created/updated/duplicate/conflict_ignored). Las que dan
 * 'error' se marcan como tal pero siguen pendientes para el próximo intento.
 *
 * Nunca lanza. Devuelve cuántas se confirmaron y si hubo algún fallo de red.
 */
export async function pushPendingSessions(): Promise<{ ok: boolean; pushed: number; error?: string }> {
  let pending: Session[];
  try {
    pending = await getUnsyncedSessions();
  } catch (e) {
    return { ok: false, pushed: 0, error: e instanceof Error ? e.message : 'Error leyendo la cola' };
  }
  if (pending.length === 0) return { ok: true, pushed: 0 };

  // La clave para reconciliar la confirmación con la fila local es el par
  // (id, updatedAt) que se envió: si la fila cambió entre medias, no se marca.
  const sentAt = new Map(pending.map((s) => [s.id, s.updatedAt] as const));
  let confirmed = 0;
  let lastError: string | undefined;

  for (let i = 0; i < pending.length; i += PUSH_CHUNK) {
    const chunk = pending.slice(i, i + PUSH_CHUNK);
    try {
      const data = await apiPost<BatchResponse>(BATCH_PATH, {
        sessions: chunk.map(toApiBody),
      });

      const ok: Array<{ id: string; updatedAt: string }> = [];
      const failed: Array<{ id: string; updatedAt: string }> = [];
      for (const r of data.results ?? []) {
        const updatedAt = sentAt.get(r.id);
        if (updatedAt === undefined) continue;
        if (r.status === 'error') {
          failed.push({ id: r.id, updatedAt });
          lastError = r.reason ?? lastError;
        } else {
          ok.push({ id: r.id, updatedAt });
        }
      }
      await markSessionsSynced(ok);
      await markSessionsSyncError(failed);
      confirmed += ok.length;
    } catch (e) {
      // Fallo de red/servidor del lote entero: se dejan pendientes tal cual.
      lastError = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Error de red';
    }
  }

  return { ok: lastError === undefined, pushed: confirmed, error: lastError };
}

// ── pull ─────────────────────────────────────────────────────────────────────

/**
 * Baja lo cambiado desde el último pull y lo fusiona sin destruir nada local
 * (ver upsertSessionsFromBackend). Avanza el cursor `since` con el serverTime
 * SOLO si el merge fue bien, para no perderse cambios ante un fallo intermedio.
 */
export async function pullSessions(): Promise<{ ok: boolean; pulled: number; error?: string }> {
  let since: string | null = null;
  try {
    since = await AsyncStorage.getItem(LAST_PULL_KEY);
  } catch {
    since = null;
  }

  const path = since ? `${SESSIONS_PATH}?since=${encodeURIComponent(since)}` : SESSIONS_PATH;

  try {
    const data = await apiGet<ListResponse>(path);
    const applied = await upsertSessionsFromBackend(data.sessions ?? []);

    // Avanzamos el cursor con el reloj del servidor (evita desfases de reloj
    // entre dispositivo y backend). Si no vino, no lo movemos: repetir es seguro.
    if (data.serverTime) {
      try {
        await AsyncStorage.setItem(LAST_PULL_KEY, data.serverTime);
      } catch {
        // no crítico — el próximo pull volverá a traer lo mismo (idempotente)
      }
    }

    return { ok: true, pulled: applied };
  } catch (e) {
    const error = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Error de red';
    return { ok: false, pulled: 0, error };
  }
}

// ── orquestación ─────────────────────────────────────────────────────────────

// ── compartir al abrir (Fase 5) ──────────────────────────────────────────────

/**
 * Consulta EN VIVO al backend qué sesiones hay abiertas en OTROS dispositivos
 * (cualquier local — decisión 2026-07-22). Para ofrecer "unirse" al abrir una
 * jornada. Nunca lanza; sin red devuelve lista vacía con ok:false para que la UI
 * pueda distinguir "no hay" de "no se pudo comprobar".
 */
export async function fetchJoinableSessions(): Promise<
  { ok: true; sessions: ApiSession[] } | { ok: false; error: string }
> {
  try {
    const myDevice = await getDeviceId();
    const data = await apiGet<ListResponse>(SESSIONS_PATH);
    const open = (data.sessions ?? []).filter(
      (s) => s.status === 'open' && !s.deletedAt && s.deviceId !== myDevice,
    );
    return { ok: true, sessions: open };
  } catch (e) {
    const error = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Error de red';
    return { ok: false, error };
  }
}

/**
 * "Unirse" a una sesión abierta en otro dispositivo: la baja a SQLite y la marca
 * como local para que este TPV la use como jornada activa. No la sube (adoptar
 * no cambia el dato). Devuelve la sesión ya persistida lista para el store.
 */
export async function joinRemoteSession(
  session: ApiSession,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await upsertSessionsFromBackend([session]);
    await adoptSessionAsLocal(session.id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error al unirse' };
  }
}

/**
 * Sincroniza las sesiones en ambas direcciones (push y luego pull).
 * Nunca lanza. Un fallo de pull no invalida lo que ya se subió en el push.
 */
export async function syncSessions(): Promise<SyncSessionsResult> {
  const push = await pushPendingSessions();
  const pull = await pullSessions();

  const ok = push.ok && pull.ok;
  if (ok) {
    return { ok: true, pushed: push.pushed, pulled: pull.pulled };
  }
  return {
    ok: false,
    pushed: push.pushed,
    pulled: pull.pulled,
    error: pull.error ?? push.error ?? 'Error desconocido',
  };
}
