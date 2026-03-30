import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Banner, Button, Chip, Divider, Surface, Text } from 'react-native-paper';
import { useRouter } from 'expo-router';

import PaymentModal from '../../components/PaymentModal';
import TicketPreview from '../../components/TicketPreview';

import { formatPrice } from '../../lib/utils';
import { INITIAL_MODIFIERS } from '../../lib/constants';
import type { Order, OrderItem } from '../../lib/types';

import { useCartStore } from '../../stores/useCartStore';
import { useSessionStore } from '../../stores/useSessionStore';
import { useTicketStore } from '../../stores/useTicketStore';

import {
  getNextTicketNumber,
  insertTicket,
  markTicketPrinted,
  saveOrderWithItems,
} from '../../services/db';
import { printTicket } from '../../services/printer';

// ---------------------------------------------------------------------------
// Modifier label lookup — built once from INITIAL_MODIFIERS
// (In production this would come from the DB; sufficient for current product set)
// ---------------------------------------------------------------------------
const MODIFIER_LABELS: Record<string, string> = Object.fromEntries(
  INITIAL_MODIFIERS.map((m) => [m.id, m.label]),
);

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

type ActionState = 'idle' | 'saving' | 'printing';

export default function TicketScreen(): React.JSX.Element {
  const router = useRouter();

  // ── stores ────────────────────────────────────────────────────────────────
  const testMode      = useSessionStore((s) => s.testMode);
  const activeSession = useSessionStore((s) => s.activeSession);

  const clientName = useCartStore((s) => s.clientName);
  const cartItems  = useCartStore((s) => s.items);
  const cartTotal  = useCartStore((s) => s.total());
  const clearCart  = useCartStore((s) => s.clearCart);

  const activeTicket    = useTicketStore((s) => s.activeTicket);
  const openTicket      = useTicketStore((s) => s.openTicket);
  const addOrder        = useTicketStore((s) => s.addOrder);
  const markPrinted     = useTicketStore((s) => s.markPrinted);
  const clearActiveTicket = useTicketStore((s) => s.clearActiveTicket);

  // ── local state ───────────────────────────────────────────────────────────
  const [paymentVisible, setPaymentVisible] = useState(false);
  const [paidAmount, setPaidAmount]         = useState<number | null>(null);
  const [paidChange, setPaidChange]         = useState<number | null>(null);
  const [actionState, setActionState]       = useState<ActionState>('idle');

  // ── derived ───────────────────────────────────────────────────────────────
  const hasItems    = cartItems.length > 0;
  const hasSession  = activeSession !== null;
  const isBusy      = actionState !== 'idle';

  // Ticket temporal para vista previa — incluye pedidos anteriores + carrito actual
  const previewTicket: import('../../lib/types').Ticket | null = hasItems ? {
    id: activeTicket?.id ?? 'preview',
    sessionId: activeSession?.id ?? '',
    ticketNumber: activeTicket?.ticketNumber ?? 1,
    printedAt: null,
    syncStatus: 'pending',
    createdAt: new Date().toISOString(),
    orders: [
      ...(activeTicket?.orders ?? []),
      {
        id: 'preview-order',
        ticketId: activeTicket?.id ?? 'preview',
        clientName,
        items: cartItems,
        amountPaid: null,
        change: null,
        total: cartTotal,
        createdAt: new Date().toISOString(),
      },
    ],
  } : activeTicket;

  // ── helpers ───────────────────────────────────────────────────────────────

  /**
   * Ensures an active Ticket exists in the store (and SQLite).
   * Returns the ticket id.
   */
  async function ensureTicket(): Promise<string> {
    if (activeTicket) return activeTicket.id;
    if (!activeSession) throw new Error('No hay sesión activa');

    const ticketNumber = await getNextTicketNumber(activeSession.id);
    const dbTicket     = await insertTicket(activeSession.id, ticketNumber);
    openTicket(activeSession.id, dbTicket.ticketNumber);
    // Sync openTicket's in-memory id with the one from DB
    return dbTicket.id;
  }

  /**
   * Build an Order from the current cart state and persist it (unless test mode).
   * Returns the Order (for subsequent print step).
   */
  async function persistCurrentOrder(
    ticketId: string,
    overrideAmountPaid?: number,
    overrideChange?: number,
  ): Promise<Order> {
    const order = addOrder({
      clientName: clientName.trim() || 'COMENSAL',
      items: cartItems,
      total: cartTotal,
      amountPaid: overrideAmountPaid ?? paidAmount ?? undefined,
      change:     overrideChange     ?? paidChange  ?? undefined,
    });

    // Stamp the ticketId on the order (addOrder uses the in-memory ticket,
    // but if the ticket was just created from DB we need the DB id)
    const finalOrder: Order = { ...order, ticketId };

    if (!testMode) {
      await saveOrderWithItems(finalOrder);
    }

    return finalOrder;
  }

  // ── action: COBRAR ────────────────────────────────────────────────────────
  function handleCobrar(): void {
    setPaymentVisible(true);
  }

  function handlePaymentConfirm(amountPaid: number, change: number): void {
    setPaidAmount(amountPaid);
    setPaidChange(change);
    setPaymentVisible(false);
  }

  // ── action: AÑADIR OTRO ───────────────────────────────────────────────────
  async function handleAddAnother(): Promise<void> {
    if (!hasItems) return;
    setActionState('saving');
    try {
      const ticketId = await ensureTicket();
      await persistCurrentOrder(ticketId);
      clearCart();
      // Go back to product selection with the same ticket open
      router.replace('/');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo guardar el pedido');
    } finally {
      setActionState('idle');
    }
  }

  // ── action: IMPRIMIR ──────────────────────────────────────────────────────
  async function handlePrint(): Promise<void> {
    if (!hasItems) return;
    setActionState('printing');
    try {
      const ticketId = await ensureTicket();
      await persistCurrentOrder(ticketId);

      // Re-read the ticket from the store (now includes all orders)
      const ticket = useTicketStore.getState().activeTicket;
      if (!ticket) throw new Error('Ticket no encontrado en store');

      // Print (fire-and-forget: even on BT error we close the ticket)
      const result = await printTicket(ticket, testMode, MODIFIER_LABELS);

      if (!testMode) {
        await markTicketPrinted(ticket.id);
      }
      markPrinted();

      if (!result.ok) {
        // Print failed — warn but don't block closing
        Alert.alert(
          'Error de impresión',
          result.error ?? 'No se pudo conectar con la impresora',
          [{ text: 'Continuar', style: 'default' }],
        );
      }

      // Close ticket and return to home
      clearActiveTicket();
      clearCart();
      router.replace('/');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo imprimir');
    } finally {
      setActionState('idle');
    }
  }

  // ── guard: no session ─────────────────────────────────────────────────────
  if (!hasSession) {
    return (
      <View style={styles.centered}>
        <Text style={styles.noSessionText}>
          No hay sesión activa.{'\n'}Ve a la pestaña Sesión para abrir una.
        </Text>
        <Button mode="outlined" onPress={() => router.replace('/session')} style={styles.goSessionBtn}>
          Ir a Sesión
        </Button>
      </View>
    );
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>

      {/* Test-mode banner */}
      <Banner visible={testMode} style={styles.testBanner} icon="alert">
        <Text style={styles.testBannerText}>MODO PRUEBA — nada se guardará</Text>
      </Banner>

      {/* Ticket-in-progress header */}
      {activeTicket && (
        <Surface style={styles.ticketHeader} elevation={1}>
          <Text style={styles.ticketHeaderText}>
            Comanda #{activeTicket.ticketNumber}
            {activeTicket.orders.length > 0
              ? `  ·  ${activeTicket.orders.length} pedido${activeTicket.orders.length > 1 ? 's' : ''} previo${activeTicket.orders.length > 1 ? 's' : ''}`
              : ''}
          </Text>
        </Surface>
      )}

      {/* Client + order items list */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

        {/* Client name */}
        <View style={styles.clientRow}>
          <Text style={styles.clientLabel}>Cliente</Text>
          <Text style={styles.clientName}>{clientName || '—'}</Text>
        </View>

        <Divider />

        {/* Items */}
        {cartItems.length === 0 ? (
          <Text style={styles.emptyText}>No hay productos en el carrito</Text>
        ) : (
          cartItems.map((item) => (
            <OrderItemRow key={item.id} item={item} />
          ))
        )}

        <Divider style={styles.totalDivider} />

        {/* Total */}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>TOTAL</Text>
          <Text style={styles.totalAmount}>{formatPrice(cartTotal)}</Text>
        </View>

        {/* Cobrado / cambio (shown after COBRAR) */}
        {paidAmount !== null && (
          <View style={styles.paidRow}>
            <View style={styles.paidCol}>
              <Text style={styles.paidLabel}>Entregado</Text>
              <Text style={styles.paidValue}>{formatPrice(paidAmount)}</Text>
            </View>
            <View style={styles.paidCol}>
              <Text style={styles.paidLabel}>Cambio</Text>
              <Text style={[styles.paidValue, styles.changeValue]}>
                {paidChange !== null ? formatPrice(paidChange) : '—'}
              </Text>
            </View>
          </View>
        )}

        {/* Previous orders summary */}
        {activeTicket && activeTicket.orders.length > 0 && (
          <View style={styles.prevOrdersBox}>
            <Text style={styles.prevOrdersTitle}>Pedidos anteriores en esta comanda</Text>
            {activeTicket.orders.map((o, i) => (
              <Text key={o.id} style={styles.prevOrderRow}>
                {i + 1}. {o.clientName} — {formatPrice(o.total)}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>

      {/* vista previa — solo visible en modo prueba */}
      {testMode && (
        <View style={styles.previewRow}>
          <TicketPreview
            ticket={previewTicket}
            isTest={testMode}
            modifierLabels={MODIFIER_LABELS}
          />
        </View>
      )}

      {/* Action buttons */}
      <Surface style={styles.actions} elevation={8}>
        <Divider />
        <View style={styles.actionsInner}>

          {/* COBRAR */}
          <Button
            mode="contained"
            onPress={handleCobrar}
            disabled={!hasItems || isBusy}
            buttonColor="#43A047"
            style={styles.btn}
            contentStyle={styles.btnContent}
            labelStyle={styles.btnLabel}
            icon="cash"
          >
            {paidAmount !== null ? 'Recobrar' : 'Cobrar'}
          </Button>

          <View style={styles.btnRow}>
            {/* AÑADIR OTRO */}
            <Button
              mode="contained"
              onPress={handleAddAnother}
              disabled={!hasItems || isBusy}
              buttonColor="#1E88E5"
              style={[styles.btn, styles.btnHalf]}
              contentStyle={styles.btnContent}
              labelStyle={styles.btnLabel}
              icon={actionState === 'saving' ? undefined : 'plus'}
            >
              {actionState === 'saving'
                ? <ActivityIndicator color="#fff" size={20} />
                : 'Añadir otro'}
            </Button>

            {/* IMPRIMIR */}
            <Button
              mode="contained"
              onPress={handlePrint}
              disabled={!hasItems || isBusy}
              buttonColor="#E53935"
              style={[styles.btn, styles.btnHalf]}
              contentStyle={styles.btnContent}
              labelStyle={styles.btnLabel}
              icon={actionState === 'printing' ? undefined : 'printer'}
            >
              {actionState === 'printing'
                ? <ActivityIndicator color="#fff" size={20} />
                : testMode ? 'Imprimir prueba' : 'Imprimir'}
            </Button>
          </View>

        </View>
      </Surface>

      {/* Payment modal */}
      <PaymentModal
        visible={paymentVisible}
        total={cartTotal}
        onConfirm={handlePaymentConfirm}
        onDismiss={() => setPaymentVisible(false)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// OrderItemRow sub-component
// ---------------------------------------------------------------------------

function OrderItemRow({ item }: { item: OrderItem }): React.JSX.Element {
  const modLabels = item.selectedModifiers
    .map((id) => MODIFIER_LABELS[id] ?? id);

  return (
    <View style={itemStyles.row}>
      <View style={itemStyles.left}>
        <Text style={itemStyles.name}>
          {item.customLabel ?? item.productName}
        </Text>
        {modLabels.length > 0 && (
          <View style={itemStyles.chips}>
            {modLabels.map((label) => (
              <Chip key={label} style={itemStyles.chip} textStyle={itemStyles.chipText} compact>
                {label}
              </Chip>
            ))}
          </View>
        )}
      </View>
      <View style={itemStyles.right}>
        <Text style={itemStyles.qty}>×{item.qty}</Text>
        <Text style={itemStyles.price}>{formatPrice(item.unitPrice * item.qty)}</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  noSessionText: {
    fontSize: 16,
    textAlign: 'center',
    color: '#555',
    lineHeight: 24,
  },
  goSessionBtn: {
    marginTop: 8,
  },

  // test banner
  testBanner: {
    backgroundColor: '#FF6F00',
  },
  testBannerText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.5,
  },

  // ticket header
  ticketHeader: {
    backgroundColor: '#E3F2FD',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  ticketHeaderText: {
    fontSize: 14,
    color: '#1565C0',
    fontWeight: '600',
  },

  // scroll
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 24 },

  // client
  clientRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: 12,
  },
  clientLabel: {
    fontSize: 13,
    color: '#888',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  clientName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1a1a1a',
  },

  // empty
  emptyText: {
    textAlign: 'center',
    color: '#bbb',
    fontStyle: 'italic',
    paddingVertical: 24,
    fontSize: 15,
  },

  // total
  totalDivider: { marginTop: 8 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: 12,
  },
  totalLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    color: '#888',
  },
  totalAmount: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1a1a1a',
  },

  // paid / change
  paidRow: {
    flexDirection: 'row',
    gap: 16,
    paddingBottom: 12,
  },
  paidCol: { flex: 1 },
  paidLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 2,
  },
  paidValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  changeValue: {
    color: '#43A047',
  },

  // previous orders
  prevOrdersBox: {
    backgroundColor: '#F3F8FF',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  prevOrdersTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1565C0',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  prevOrderRow: {
    fontSize: 14,
    color: '#333',
    paddingVertical: 2,
  },

  // vista previa trigger row
  previewRow: {
    paddingHorizontal: 16,
    paddingBottom: 2,
    alignItems: 'flex-end',
    backgroundColor: '#f5f5f5',
  },

  // action bar
  actions: {
    backgroundColor: '#fff',
  },
  actionsInner: {
    padding: 12,
    gap: 10,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  btn: {
    borderRadius: 10,
  },
  btnHalf: {
    flex: 1,
  },
  btnContent: {
    height: 56,
  },
  btnLabel: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});

const itemStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
    gap: 8,
  },
  left: { flex: 1 },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  chip: {
    height: 26,
    backgroundColor: '#FFF3E0',
  },
  chipText: {
    fontSize: 11,
    color: '#E65100',
  },
  right: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    minWidth: 80,
  },
  qty: {
    fontSize: 13,
    color: '#888',
  },
  price: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
  },
});
