// Sincronización de PRESETS DE TEXTO (mensajes de ticket + batería de nombres)
// con el backend TPV.
//
// Solo se sincroniza el CONTENIDO (texto): `enabled` y el modo de impresión son
// locales de cada dispositivo y no viajan (ver tpv-text-presets-plan.md §2).
//
// Como las sesiones, la TPV es productora del dato: dirección primaria PUSH y el
// PULL nunca borra ni pisa una fila con cambios locales pendientes.
//   1. PUSH  — sube en lotes los presets con sync_status != 'synced' (incluye
//              soft-deletes).
//   2. PULL  — baja lo cambiado desde el último sync y lo fusiona sin destruir,
//              y SIN tocar `enabled`.
//
// Convención de services/: nunca lanza; devuelve { ok, ... } / { ok:false, error }.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiGet, apiPost, ApiError } from './apiConfig';
import {
  getUnsyncedTextPresets,
  markTextPresetsSynced,
  markTextPresetsSyncError,
  upsertTextPresetsFromBackend,
} from './db';
import type { ApiTextPreset, TextPreset } from '../lib/types';

const PRESETS_PATH = '/api/v1/tpv/text-presets';
const BATCH_PATH = '/api/v1/tpv/text-presets/batch';
const LAST_PULL_KEY = 'tpv:textPresetsLastPull';
const PUSH_CHUNK = 200;

export type SyncTextPresetsResult =
  | { ok: true; pushed: number; pulled: number }
  | { ok: false; error: string; pushed: number; pulled: number };

interface BatchResult {
  id: string;
  status: 'created' | 'updated' | 'duplicate' | 'conflict_ignored' | 'deleted' | 'error';
  reason?: string;
}

interface BatchResponse {
  results: BatchResult[];
  serverTime?: string;
}

interface ListResponse {
  presets: ApiTextPreset[];
  serverTime?: string;
}

// ── serialización TPV → API (omite `enabled`, que es local) ──────────────────

function toApiBody(p: TextPreset): Record<string, unknown> {
  return {
    id: p.id,
    kind: p.kind,
    text: p.text,
    slot: p.slot,
    sortOrder: p.sortOrder,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    deletedAt: p.deletedAt,
  };
}

// ── push ─────────────────────────────────────────────────────────────────────

export async function pushPendingTextPresets(): Promise<{ ok: boolean; pushed: number; error?: string }> {
  let pending: TextPreset[];
  try {
    pending = await getUnsyncedTextPresets();
  } catch (e) {
    return { ok: false, pushed: 0, error: e instanceof Error ? e.message : 'Error leyendo la cola' };
  }
  if (pending.length === 0) return { ok: true, pushed: 0 };

  const sentAt = new Map(pending.map((p) => [p.id, p.updatedAt] as const));
  let confirmed = 0;
  let lastError: string | undefined;

  for (let i = 0; i < pending.length; i += PUSH_CHUNK) {
    const chunk = pending.slice(i, i + PUSH_CHUNK);
    try {
      const data = await apiPost<BatchResponse>(BATCH_PATH, {
        presets: chunk.map(toApiBody),
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
      await markTextPresetsSynced(ok);
      await markTextPresetsSyncError(failed);
      confirmed += ok.length;
    } catch (e) {
      lastError = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Error de red';
    }
  }

  return { ok: lastError === undefined, pushed: confirmed, error: lastError };
}

// ── pull ─────────────────────────────────────────────────────────────────────

export async function pullTextPresets(): Promise<{ ok: boolean; pulled: number; error?: string }> {
  let since: string | null = null;
  try {
    since = await AsyncStorage.getItem(LAST_PULL_KEY);
  } catch {
    since = null;
  }

  const path = since ? `${PRESETS_PATH}?since=${encodeURIComponent(since)}` : PRESETS_PATH;

  try {
    const data = await apiGet<ListResponse>(path);
    const applied = await upsertTextPresetsFromBackend(data.presets ?? []);

    if (data.serverTime) {
      try {
        await AsyncStorage.setItem(LAST_PULL_KEY, data.serverTime);
      } catch {
        // no crítico — el próximo pull es idempotente
      }
    }

    return { ok: true, pulled: applied };
  } catch (e) {
    const error = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Error de red';
    return { ok: false, pulled: 0, error };
  }
}

// ── orquestación ─────────────────────────────────────────────────────────────

/**
 * Sincroniza los presets en ambas direcciones (push y luego pull). Nunca lanza.
 * Un fallo de pull no invalida lo que ya se subió en el push.
 */
export async function syncTextPresets(): Promise<SyncTextPresetsResult> {
  const push = await pushPendingTextPresets();
  const pull = await pullTextPresets();

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
