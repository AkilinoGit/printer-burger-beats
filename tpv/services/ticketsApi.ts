// Sincronización de COMANDAS (tickets) con el backend TPV.
//
// Modelo Opción B: cada ticket agrupa un conjunto de orders (personas), cada uno
// con sus items. El backend hace upsert idempotente por `edit_count`. Ver
// tpv-orders-sync-plan.md.
//
// De momento solo PUSH (Fase 2). El PULL (bajar comandas de otros dispositivos y
// fusionarlas) se añade en la Fase 3.
//
// Convención de services/: nunca lanza; devuelve { ok, ... } / { ok:false, error }.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiGet, apiPost, ApiError } from './apiConfig';
import {
  getUnsyncedTickets,
  markTicketsSynced,
  markTicketsSyncError,
  upsertTicketsFromBackend,
} from './db';
import type { ApiTicket, Ticket } from '../lib/types';

const TICKETS_BATCH_PATH = '/api/v1/tpv/sync/tickets';
const TICKETS_PATH = '/api/v1/tpv/tickets';
const LAST_PULL_KEY = 'tpv:ticketsLastPull';
const PUSH_CHUNK = 100; // tope del backend: 300; margen para lotes cómodos

export type SyncTicketsResult =
  | { ok: true; pushed: number; pulled: number }
  | { ok: false; error: string; pushed: number; pulled: number };

interface TicketSyncResultRow {
  id: string;
  status: 'created' | 'updated' | 'duplicate' | 'error';
  reason?: string;
}

interface BatchResponse {
  results: TicketSyncResultRow[];
  summary?: Record<string, number>;
  serverTime?: string;
}

interface ListResponse {
  tickets: ApiTicket[];
  serverTime?: string;
}

/** Serializa una comanda local al cuerpo que espera el backend. */
function toApiBody(t: Ticket): Record<string, unknown> {
  return {
    id: t.id,
    sessionId: t.sessionId,
    ticketNumber: t.ticketNumber,
    deviceId: t.deviceId,
    printedAt: t.printedAt,
    createdAt: t.createdAt,
    editedAt: t.editedAt,
    editCount: t.editCount,
    orders: t.orders.map((o) => ({
      id: o.id,
      clientName: o.clientName,
      priceProfile: o.priceProfile,
      total: o.total,
      createdAt: o.createdAt,
      items: o.items.map((it) => ({
        id: it.id,
        productId: it.productId,
        productName: it.productName,
        qty: it.qty,
        unitPrice: it.unitPrice,
        modifierPriceAdd: it.modifierPriceAdd,
        selectedModifiers: it.selectedModifiers,
        customLabel: it.customLabel,
      })),
    })),
  };
}

/**
 * Sube todas las comandas con cambios locales. Solo marca 'synced' las que el
 * backend confirma (created/updated/duplicate); las 'error' se marcan como tal
 * pero siguen pendientes para el próximo intento. La reconciliación con la fila
 * local usa el par (id, editCount) enviado: si la comanda cambió entre medias,
 * no se marca.
 */
export async function pushPendingTickets(): Promise<{ ok: boolean; pushed: number; error?: string }> {
  let pending: Ticket[];
  try {
    pending = await getUnsyncedTickets();
  } catch (e) {
    return { ok: false, pushed: 0, error: e instanceof Error ? e.message : 'Error leyendo comandas' };
  }
  if (pending.length === 0) return { ok: true, pushed: 0 };

  const sentEditCount = new Map(pending.map((t) => [t.id, t.editCount] as const));
  let confirmed = 0;
  let lastError: string | undefined;

  for (let i = 0; i < pending.length; i += PUSH_CHUNK) {
    const chunk = pending.slice(i, i + PUSH_CHUNK);
    try {
      const data = await apiPost<BatchResponse>(TICKETS_BATCH_PATH, {
        tickets: chunk.map(toApiBody),
      });

      const ok: Array<{ id: string; editCount: number }> = [];
      const failed: Array<{ id: string; editCount: number }> = [];
      for (const r of data.results ?? []) {
        const editCount = sentEditCount.get(r.id);
        if (editCount === undefined) continue;
        if (r.status === 'error') {
          failed.push({ id: r.id, editCount });
          lastError = r.reason ?? lastError;
        } else {
          ok.push({ id: r.id, editCount });
        }
      }
      await markTicketsSynced(ok);
      await markTicketsSyncError(failed);
      confirmed += ok.length;
    } catch (e) {
      lastError = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Error de red';
    }
  }

  return { ok: lastError === undefined, pushed: confirmed, error: lastError };
}

/**
 * Baja las comandas cambiadas desde el último pull y las fusiona en SQLite sin
 * destruir lo local (ver upsertTicketsFromBackend). Avanza el cursor `since` con
 * el reloj del servidor solo si el merge fue bien.
 */
export async function pullTickets(): Promise<{ ok: boolean; pulled: number; error?: string }> {
  let since: string | null = null;
  try {
    since = await AsyncStorage.getItem(LAST_PULL_KEY);
  } catch {
    since = null;
  }

  const path = since ? `${TICKETS_PATH}?since=${encodeURIComponent(since)}` : TICKETS_PATH;

  try {
    const data = await apiGet<ListResponse>(path);
    const applied = await upsertTicketsFromBackend(data.tickets ?? []);

    if (data.serverTime) {
      try {
        await AsyncStorage.setItem(LAST_PULL_KEY, data.serverTime);
      } catch {
        // no crítico — el próximo pull repite (idempotente)
      }
    }

    return { ok: true, pulled: applied };
  } catch (e) {
    const error = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Error de red';
    return { ok: false, pulled: 0, error };
  }
}

/**
 * Sincroniza las comandas: push y luego pull. El push va antes para que, ante un
 * conflicto, lo local ya esté en el servidor y el merge lo respete. Nunca lanza.
 */
export async function syncTickets(): Promise<SyncTicketsResult> {
  const push = await pushPendingTickets();
  const pull = await pullTickets();

  if (push.ok && pull.ok) {
    return { ok: true, pushed: push.pushed, pulled: pull.pulled };
  }
  return {
    ok: false,
    pushed: push.pushed,
    pulled: pull.pulled,
    error: pull.error ?? push.error ?? 'Error desconocido',
  };
}
