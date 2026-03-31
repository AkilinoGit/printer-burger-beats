import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Banner, Button, Dialog, Divider, IconButton, Portal, Surface, Text } from 'react-native-paper';
import { TouchableRipple } from 'react-native-paper';
import { useRouter } from 'expo-router';

import PaymentModal from '../../components/PaymentModal';
import TicketPreview from '../../components/TicketPreview';

import { formatPrice } from '../../lib/utils';
import type { Modifier, Order, OrderItem } from '../../lib/types';

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

// Build modifier lookup maps from live products (IDs come from DB, not constants)
function buildMaps(modifiers: Modifier[]): {
  labels: Record<string, string>;
  radioNoSelection: Record<string, string>;
  radioOptionSets: Record<string, Set<string>>;
} {
  const labels: Record<string, string> = {};
  const radioNoSelection: Record<string, string> = {};
  const radioOptionSets: Record<string, Set<string>> = {};
  for (const m of modifiers) {
    labels[m.id] = m.label;
    if (m.type === 'radio') {
      if (m.noSelectionLabel) radioNoSelection[m.id] = m.noSelectionLabel;
      radioOptionSets[m.id] = new Set((m.options ?? []).map((o) => o.id));
      for (const opt of m.options ?? []) {
        labels[opt.id] = opt.label;
      }
    }
  }
  return { labels, radioNoSelection, radioOptionSets };
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

type ActionState = 'idle' | 'saving' | 'printing';

export default function TicketScreen(): React.JSX.Element {
  const router = useRouter();

  // ── stores ────────────────────────────────────────────────────────────────
  const testMode      = useSessionStore((s) => s.testMode);
  const activeSession = useSessionStore((s) => s.activeSession);
  const products      = useSessionStore((s) => s.products);

  // ── modifier maps (built from live DB products) ───────────────────────────
  const { labels: MODIFIER_LABELS, radioNoSelection: RADIO_NO_SELECTION, radioOptionSets: RADIO_OPTION_SETS } =
    React.useMemo(() => buildMaps(products.flatMap((p) => p.modifiers)), [products]);

  const clientName      = useCartStore((s) => s.clientName);
  const cartItems       = useCartStore((s) => s.items);
  const cartTotal       = useCartStore((s) => s.total());
  const clearCart       = useCartStore((s) => s.clearCart);
  const incrementItem   = useCartStore((s) => s.incrementItem);
  const decrementItem   = useCartStore((s) => s.decrementItem);
  const removeItem      = useCartStore((s) => s.removeItem);

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
  const [qtyItem, setQtyItem]               = useState<OrderItem | null>(null);

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
      const result = await printTicket(ticket, testMode, MODIFIER_LABELS, RADIO_NO_SELECTION, RADIO_OPTION_SETS);

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
            <OrderItemRow key={item.id} item={item} modifierLabels={MODIFIER_LABELS} onLongPress={() => setQtyItem(item)} />
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

      {/* Qty dialog */}
      <Portal>
        <Dialog visible={qtyItem !== null} onDismiss={() => setQtyItem(null)}>
          <Dialog.Title numberOfLines={2}>
            {qtyItem?.customLabel ?? qtyItem?.productName ?? ''}
          </Dialog.Title>
          <Dialog.Content>
            <View style={styles.qtyRow}>
              <IconButton
                icon="minus"
                size={32}
                mode="contained"
                containerColor="#E53935"
                iconColor="#fff"
                onPress={() => {
                  if (!qtyItem) return;
                  if (qtyItem.qty <= 1) { removeItem(qtyItem.id); setQtyItem(null); }
                  else { decrementItem(qtyItem.id); setQtyItem({ ...qtyItem, qty: qtyItem.qty - 1 }); }
                }}
              />
              <Text style={styles.qtyValue}>{qtyItem?.qty ?? 0}</Text>
              <IconButton
                icon="plus"
                size={32}
                mode="contained"
                containerColor="#43A047"
                iconColor="#fff"
                onPress={() => {
                  if (!qtyItem) return;
                  incrementItem(qtyItem.id);
                  setQtyItem({ ...qtyItem, qty: qtyItem.qty + 1 });
                }}
              />
            </View>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => { if (qtyItem) { removeItem(qtyItem.id); setQtyItem(null); } }} textColor="#E53935">
              Eliminar
            </Button>
            <Button onPress={() => setQtyItem(null)}>Hecho</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// OrderItemRow sub-component
// ---------------------------------------------------------------------------

function OrderItemRow({ item, modifierLabels, onLongPress }: {
  item: OrderItem;
  modifierLabels: Record<string, string>;
  onLongPress: () => void;
}): React.JSX.Element {
  const modLabels = item.selectedModifiers.map((id) => modifierLabels[id] ?? id);
  const linePrice = (item.unitPrice + item.modifierPriceAdd) * item.qty;

  return (
    <TouchableRipple onLongPress={onLongPress} rippleColor="rgba(0,0,0,0.08)">
      <View style={itemStyles.row}>
        <View style={itemStyles.left}>
          <View style={itemStyles.nameRow}>
            <Text style={itemStyles.qty}>×{item.qty}</Text>
            <Text style={itemStyles.name}>{item.customLabel ?? item.productName}</Text>
          </View>
          {modLabels.map((label) => (
            <Text key={label} style={itemStyles.mod}>· {label}</Text>
          ))}
        </View>
        <Text style={itemStyles.price}>{formatPrice(linePrice)}</Text>
      </View>
    </TouchableRipple>
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
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 8,
  },
  qtyValue: {
    fontSize: 40,
    fontWeight: '800',
    color: '#1a1a1a',
    minWidth: 48,
    textAlign: 'center',
  },
});

const itemStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
    gap: 8,
  },
  left: { flex: 1 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 4,
  },
  name: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1a1a1a',
    flexShrink: 1,
  },
  mod: {
    fontSize: 15,
    color: '#E65100',
    paddingLeft: 4,
    lineHeight: 22,
  },
  right: {
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    minWidth: 80,
  },
  qty: {
    fontSize: 15,
    color: '#888',
    fontWeight: '600',
    minWidth: 24,
  },
  price: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1a1a1a',
    marginTop: 2,
  },
});
