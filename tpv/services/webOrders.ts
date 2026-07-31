// Poller de PEDIDOS WEB: los trae del backend y los imprime solos.
//
// Ver tpv-web-orders-plan.md §4. Resumen del ciclo:
//
//   pending → claim → Ticket+Order locales → printTicket() → ack
//
// Decisiones que conviene no deshacer sin releer el plan:
//
//  - **Polling, no WebSocket**: el backend vive en cPanel compartido sin SSH, así
//    que no hay proceso persistente posible. Un GET cada 3 s sobre un índice es
//    barato y da latencia percibida instantánea (§0.1).
//  - **El tick también es heartbeat**: `fetchPendingWebOrders(sessionId)` refresca
//    `sessions.last_seen_at`, y de eso depende que la web pública deje pedir. Por
//    eso el poller NO se salta ticks aunque no haya pedidos (§0.2).
//  - **Solo se imprime tras un claim con éxito**: es la garantía anti-doble
//    impresión con dos TPV en la misma jornada (§3.1).
//  - **Si falla la impresora, el pedido NO se pierde**: la comanda queda guardada
//    con printedAt=null y se reimprime desde la bandeja (§3.3).
//
// Convención de services/: nunca lanza hacia fuera.

import { AppState, type AppStateStatus } from 'react-native';

import { getDeviceId } from '../lib/device';
import { buildMaps } from '../lib/modifiers';
import { generateId } from '../lib/utils';
import type { ApiWebOrder, Order, OrderItem, Ticket } from '../lib/types';
import { useSessionStore } from '../stores/useSessionStore';
import { useWebOrdersStore } from '../stores/useWebOrdersStore';

import {
  getNextTicketNumber,
  getTicketByWebOrderId,
  getUnprintedWebTickets,
  insertTicket,
  markTicketPrinted,
  saveOrderWithItems,
} from './db';
import { log } from './logger';
import { printTicket } from './printer';
import { ackWebOrder, claimWebOrder, fetchPendingWebOrders } from './webOrdersApi';

/** Ritmo normal: latencia máxima de 3 s desde que el cliente pulsa "Enviar". */
const POLL_INTERVAL_MS = 3000;

/** Tras varios fallos seguidos de red, bajamos el ritmo para no castigar la batería. */
const POLL_BACKOFF_MS = 10000;
const FAILURES_BEFORE_BACKOFF = 3;

let timer: ReturnType<typeof setTimeout> | null = null;
let appStateSub: { remove: () => void } | null = null;
let running = false;
let consecutiveFailures = 0;
/** Evita que dos ticks se solapen si uno se alarga (impresión lenta). */
let ticking = false;

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------

/**
 * Arranca el poller. Idempotente: llamarlo dos veces no duplica timers.
 *
 * Se para solo cuando la app pasa a segundo plano — Android congela los timers
 * de todas formas, y sin heartbeat la web deja de aceptar pedidos, que es
 * justo el comportamiento correcto: si nadie mira la tablet, nadie imprime.
 */
export function startWebOrdersPolling(): void {
  if (running) return;
  running = true;
  consecutiveFailures = 0;

  appStateSub = AppState.addEventListener('change', handleAppStateChange);
  scheduleNextTick(0);

  log.info('WEB_ORDERS', 'poller arrancado');
}

export function stopWebOrdersPolling(): void {
  running = false;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  appStateSub?.remove();
  appStateSub = null;
  useWebOrdersStore.getState().setPolling(false);

  log.info('WEB_ORDERS', 'poller parado');
}

function handleAppStateChange(state: AppStateStatus): void {
  if (state === 'active') {
    // Al volver al frente, un tick inmediato: puede haber pedidos esperando.
    scheduleNextTick(0);
  } else if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function scheduleNextTick(delayMs: number): void {
  if (!running) return;
  if (timer !== null) clearTimeout(timer);

  timer = setTimeout(() => {
    void pollOnce().finally(() => {
      const delay = consecutiveFailures >= FAILURES_BEFORE_BACKOFF ? POLL_BACKOFF_MS : POLL_INTERVAL_MS;
      scheduleNextTick(delay);
    });
  }, delayMs);
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

/**
 * Un ciclo completo. Exportada para poder forzar una comprobación manual
 * ("Buscar pedidos ahora") sin esperar al siguiente tick.
 */
export async function pollOnce(): Promise<void> {
  if (ticking) return;
  if (AppState.currentState !== 'active') return;

  const session = useSessionStore.getState().activeSession;

  // Sin jornada abierta no se reclama nada: la comanda necesita una sesión a la
  // que colgarse y un número correlativo. Tampoco se manda heartbeat, así que la
  // web pública pasa a "cerrado" en cuanto caduque (60 s).
  if (!session || session.status !== 'open') {
    useWebOrdersStore.getState().setPolling(false);
    return;
  }

  ticking = true;
  const store = useWebOrdersStore.getState();
  store.setPolling(true);

  try {
    const result = await fetchPendingWebOrders(session.id);

    if (!result.ok) {
      consecutiveFailures++;
      // Silencioso por diseño: sin red se reintenta en el siguiente tick y no se
      // molesta al operario con alertas (convención offline-first del proyecto).
      store.setLastError(result.error);
      return;
    }

    consecutiveFailures = 0;
    store.setLastError(null);

    if (result.orders.length > 0) {
      for (const order of result.orders) {
        await processWebOrder(order, session.id);
      }

      // Solo tras procesar: la bandeja únicamente cambia cuando entra (o falla)
      // un pedido, así que no hace falta consultar SQLite en cada tick.
      await refreshUnprintedTray(session.id);
    }
  } catch (e) {
    consecutiveFailures++;
    log.error('WEB_ORDERS', 'tick falló', e instanceof Error ? e.message : String(e));
  } finally {
    ticking = false;
  }
}

// ---------------------------------------------------------------------------
// Procesado de un pedido
// ---------------------------------------------------------------------------

/**
 * Reclama, materializa e imprime un pedido. Cada paso puede fallar sin arrastrar
 * a los demás pedidos del lote.
 */
async function processWebOrder(apiOrder: ApiWebOrder, sessionId: string): Promise<void> {
  // Red de seguridad local: si ya creamos la comanda en un intento anterior (la
  // app murió antes del ACK y el claim caducó), no la duplicamos — se reintenta
  // el ACK que se perdió y el pedido sale de la cola.
  const existing = await getTicketByWebOrderId(apiOrder.id);
  if (existing) {
    log.info('WEB_ORDERS', `pedido ${apiOrder.id} ya materializado — reintentando ACK`);
    await ackWebOrder(apiOrder.id, existing.id, existing.printedAt !== null);
    return;
  }

  const deviceId = await getDeviceId();

  const claim = await claimWebOrder(apiOrder.id, deviceId);
  if (!claim.ok) {
    // takenByOther: otro TPV llegó antes. Es el caso normal con dos dispositivos,
    // no un error — ni log de error ni aviso al operario.
    if (!claim.takenByOther) {
      log.error('WEB_ORDERS', `claim falló: ${claim.error}`);
    }
    return;
  }

  const order = claim.order;

  let ticket: Ticket;
  try {
    ticket = await materializeTicket(order, sessionId);
  } catch (e) {
    log.error('WEB_ORDERS', 'no se pudo guardar la comanda', e instanceof Error ? e.message : String(e));
    // Sin ticket creado, el claim caducará en el backend (2 min) y el pedido
    // volverá a la cola para que lo coja otro dispositivo.
    return;
  }

  const printed = await printWebTicket(ticket);

  if (printed) {
    await markTicketPrinted(ticket.id);
  }

  // El ACK se manda tanto si imprimió como si no: con printed=false el backend
  // deja el pedido asociado a este dispositivo (ya tiene ticket) en vez de
  // devolverlo a la cola y que otro TPV cree una segunda comanda.
  const ack = await ackWebOrder(order.id, ticket.id, printed);
  if (!ack.ok) {
    log.error('WEB_ORDERS', `ACK falló para ${order.id}: ${ack.error}`);
  }

  useWebOrdersStore.getState().pushIncoming({
    webOrderId: order.id,
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumber,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    total: order.total,
    printed,
    at: new Date().toISOString(),
  });

  log.info(
    'WEB_ORDERS',
    `pedido web de ${order.customerName} → comanda #${ticket.ticketNumber}${printed ? '' : ' (SIN IMPRIMIR)'}`,
  );
}

/**
 * Crea el Ticket + Order locales a partir del pedido web.
 *
 * El número correlativo sale de `getNextTicketNumber(sesión, dispositivo)`, igual
 * que una comanda de mostrador: para la caja y el histórico, un pedido web es una
 * comanda más. Lo único que cambia es `source='web'`.
 */
async function materializeTicket(apiOrder: ApiWebOrder, sessionId: string): Promise<Ticket> {
  const ticketNumber = await getNextTicketNumber(sessionId);
  const ticket = await insertTicket(sessionId, ticketNumber, 'web', apiOrder.id);

  const orderId = generateId();
  const items: OrderItem[] = apiOrder.items.map((it) => ({
    id: generateId(),
    orderId,
    productId: it.productId,
    productName: it.productName,
    qty: it.qty,
    unitPrice: it.unitPrice,
    modifierPriceAdd: it.modifierPriceAdd,
    selectedModifiers: it.selectedModifiers ?? [],
    customLabel: it.customLabel,
  }));

  const order: Order = {
    id: orderId,
    ticketId: ticket.id,
    // El nombre del cliente web va tal cual a la comanda de cocina: es como se
    // le llama cuando viene a recoger.
    clientName: apiOrder.customerName,
    // El perfil lo decide el backend a partir de los códigos del comentario
    // (FERIANTE → 'feriante'). Las líneas ya vienen cotizadas con él, así que
    // aquí solo se conserva para que la comanda lo imprima igual que un pedido
    // feriante de mostrador. Ver tpv-web-orders-plan.md §5.1.
    priceProfile: apiOrder.priceProfile ?? 'normal',
    items,
    // El pedido web no se cobra en el TPV (pago al recoger), así que no hay
    // importe entregado ni cambio que calcular.
    amountPaid: null,
    change: null,
    // Ya con el descuento fijo restado: es lo que debe sumar la caja.
    total: apiOrder.total,
    createdAt: apiOrder.createdAt ?? new Date().toISOString(),
    notes: apiOrder.notes,
    discountAmount: apiOrder.discountAmount ?? 0,
    discountLabel: apiOrder.discountLabel ?? null,
  };

  await saveOrderWithItems(order);

  return { ...ticket, orders: [order] };
}

/**
 * Envía la comanda a la impresora. Devuelve si salió el papel.
 *
 * Los pedidos web se imprimen en copia única: la copia doble existe para darle
 * el resguardo al cliente en mostrador, y aquí el cliente no está delante.
 */
async function printWebTicket(ticket: Ticket): Promise<boolean> {
  const products = useSessionStore.getState().products;
  const session = useSessionStore.getState().activeSession;

  const { labels, radioNoSelection, radioOptionSets } = buildMaps(products.flatMap((p) => p.modifiers));

  const normalPrices: Record<string, number> = {};
  for (const p of products) {
    normalPrices[p.id] = session?.priceOverrides[p.id] ?? p.basePrice;
  }

  const result = await printTicket(
    ticket,
    false,
    labels,
    radioNoSelection,
    radioOptionSets,
    false,
    normalPrices,
  );

  if (!result.ok) {
    log.error('WEB_ORDERS', `impresión falló: ${result.error ?? 'desconocido'}`);
  }

  return result.ok;
}

// ---------------------------------------------------------------------------
// Bandeja de reimpresión
// ---------------------------------------------------------------------------

/** Recarga las comandas web que quedaron sin imprimir. */
export async function refreshUnprintedTray(sessionId: string): Promise<void> {
  try {
    const pending = await getUnprintedWebTickets(sessionId);
    useWebOrdersStore.getState().setUnprinted(pending);
  } catch (e) {
    log.error('WEB_ORDERS', 'no se pudo leer la bandeja', e instanceof Error ? e.message : String(e));
  }
}

/**
 * Reintenta la impresión de una comanda web de la bandeja.
 * Devuelve si esta vez salió.
 */
export async function reprintWebTicket(ticket: Ticket): Promise<boolean> {
  const printed = await printWebTicket(ticket);

  if (printed) {
    await markTicketPrinted(ticket.id);
    if (ticket.webOrderId) {
      // Ahora sí: el backend puede marcarlo como impreso de verdad.
      await ackWebOrder(ticket.webOrderId, ticket.id, true);
    }
    await refreshUnprintedTray(ticket.sessionId);
  }

  return printed;
}
