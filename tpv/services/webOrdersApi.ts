// Cliente HTTP de los PEDIDOS WEB (backend → TPV).
//
// El cliente hace el pedido en la web, el backend lo guarda como `pending` y este
// módulo es el que lo trae al TPV: pendientes → claim → (imprimir) → ack.
// Ver tpv-web-orders-plan.md §2.2. La orquestación (cada cuánto, qué hacer con el
// pedido) vive en services/webOrders.ts; aquí solo está el transporte.
//
// Convención de services/: NUNCA lanza; devuelve { ok, ... } / { ok:false, error }.

import { apiGet, apiPost, ApiError } from './apiConfig';
import type { ApiWebOrder } from '../lib/types';

const PENDING_PATH = '/api/v1/tpv/web-orders/pending';
const ORDER_PATH = '/api/v1/tpv/web-orders';

export type FetchPendingResult =
  | { ok: true; orders: ApiWebOrder[] }
  | { ok: false; error: string };

export type ClaimResult =
  | { ok: true; order: ApiWebOrder }
  /** Otro dispositivo se lo llevó primero. NO es un error: no hay que imprimirlo. */
  | { ok: false; takenByOther: true; error: string }
  | { ok: false; takenByOther: false; error: string };

export type AckResult = { ok: true } | { ok: false; error: string };

interface PendingResponse {
  orders: ApiWebOrder[];
  serverTime?: string;
}

interface OrderResponse {
  order: ApiWebOrder;
}

/**
 * Pedidos pendientes de procesar. Pasar `sessionId` hace de heartbeat: le dice al
 * backend que este TPV sigue escuchando esa jornada, y de eso depende que la web
 * pública deje pedir (GET /web/status). Es el motivo de que el poller no pueda
 * "ahorrarse" ticks cuando no hay pedidos.
 */
export async function fetchPendingWebOrders(sessionId: string | null): Promise<FetchPendingResult> {
  try {
    const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
    const data = await apiGet<PendingResponse>(`${PENDING_PATH}${query}`);

    return { ok: true, orders: Array.isArray(data.orders) ? data.orders : [] };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Error al consultar pedidos web' };
  }
}

/**
 * Reclama el pedido para este dispositivo. **Solo se imprime si esto devuelve ok**:
 * es lo que impide que dos TPV saquen la misma comanda.
 *
 * `takenByOther` distingue el 409 (otro se lo llevó, silencio absoluto) de un fallo
 * real de red que sí conviene registrar.
 */
export async function claimWebOrder(orderId: string, deviceId: string): Promise<ClaimResult> {
  try {
    const data = await apiPost<OrderResponse>(`${ORDER_PATH}/${orderId}/claim`, { deviceId });

    return { ok: true, order: data.order };
  } catch (e) {
    const taken = e instanceof ApiError && (e.code === 'ALREADY_CLAIMED' || e.httpStatus === 409);

    return {
      ok: false,
      takenByOther: taken,
      error: e instanceof ApiError ? e.message : 'Error al reclamar el pedido',
    };
  }
}

/**
 * Cierra el círculo tras intentar imprimir.
 *
 * `printed:false` (falló la impresora) deja el pedido asociado a este dispositivo
 * con su ticket: la comanda ya existe en local y se reimprime desde la bandeja, así
 * que el backend NO debe devolverlo a la cola de otro TPV.
 */
export async function ackWebOrder(
  orderId: string,
  ticketId: string,
  printed: boolean,
): Promise<AckResult> {
  try {
    await apiPost<OrderResponse>(`${ORDER_PATH}/${orderId}/ack`, { ticketId, printed });

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Error al confirmar el pedido' };
  }
}

/** Anulación manual desde el TPV (el cliente no aparece, pedido broma…). */
export async function cancelWebOrder(orderId: string): Promise<AckResult> {
  try {
    await apiPost<OrderResponse>(`${ORDER_PATH}/${orderId}/cancel`, {});

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Error al anular el pedido' };
  }
}
