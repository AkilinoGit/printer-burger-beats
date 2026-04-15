import React, { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Banner, Button, Dialog, Portal, Text, TextInput } from 'react-native-paper';

import CartSummary from '../../components/CartSummary';
import ModifierSheet from '../../components/ModifierSheet';
import ProductGrid from '../../components/ProductGrid';
import NewTicketScreen from '../ticket/NewTicketScreen';

import type { Product } from '../../lib/types';
import type { Order } from '../../lib/types';
import { useCartStore } from '../../stores/useCartStore';
import { useSessionStore } from '../../stores/useSessionStore';
import { useTicketStore } from '../../stores/useTicketStore';
import { buildMaps } from '../ticket/NewTicketScreen';

import {
  insertTicket,
  markTicketPrinted,
  saveOrderWithItems,
} from '../../services/db';
import { printTicket, printTickets } from '../../services/printer';
import { log, perf } from '../../services/logger';

type ActionState = 'idle' | 'saving' | 'printing';

export default function HomeScreen(): React.JSX.Element {
  // ── stores ────────────────────────────────────────────────────────────────
  const products          = useSessionStore((s) => s.products);
  const isLoadingProducts = useSessionStore((s) => s.isLoadingProducts);
  const loadProducts      = useSessionStore((s) => s.loadProducts);
  const testMode          = useSessionStore((s) => s.testMode);
  const activeSession     = useSessionStore((s) => s.activeSession);
  const nextTicketNumber  = useSessionStore((s) => s.nextTicketNumber);

  const clientName    = useCartStore((s) => s.clientName);
  const items         = useCartStore((s) => s.items);
  const total         = items.reduce((acc, i) => acc + (i.unitPrice + i.modifierPriceAdd) * i.qty, 0);
  const priceProfile  = useCartStore((s) => s.priceProfile);
  const cartTakeAway  = useCartStore((s) => s.takeAway);
  const setClientName = useCartStore((s) => s.setClientName);
  const addProduct    = useCartStore((s) => s.addProduct);
  const clearCart     = useCartStore((s) => s.clearCart);
  const incrementItem = useCartStore((s) => s.incrementItem);
  const decrementItem = useCartStore((s) => s.decrementItem);
  const removeItem    = useCartStore((s) => s.removeItem);

  const activeTicket    = useTicketStore((s) => s.activeTicket);
  const pendingTickets  = useTicketStore((s) => s.pendingTickets);
  const openTicket      = useTicketStore((s) => s.openTicket);
  const addOrder        = useTicketStore((s) => s.addOrder);
  const parkTicket      = useTicketStore((s) => s.parkTicket);
  const markPrinted     = useTicketStore((s) => s.markPrinted);
  const clearActiveTicket = useTicketStore((s) => s.clearActiveTicket);

  // ── modifier maps ─────────────────────────────────────────────────────────
  const { labels: MODIFIER_LABELS, radioNoSelection: RADIO_NO_SELECTION, radioOptionSets: RADIO_OPTION_SETS } =
    useMemo(() => buildMaps(products.flatMap((p) => p.modifiers)), [products]);

  // ── modal state ───────────────────────────────────────────────────────────
  const [ticketVisible, setTicketVisible] = useState(false);

  // ── new-ticket state ──────────────────────────────────────────────────────
  const [paymentVisible, setPaymentVisible] = useState(false);
  const [paidAmount, setPaidAmount]         = useState<number | null>(null);
  const [paidChange, setPaidChange]         = useState<number | null>(null);
  const [actionState, setActionState]       = useState<ActionState>('idle');

  // ── modifier sheet state (index grid) ────────────────────────────────────
  const [sheetProduct, setSheetProduct] = useState<Product | null>(null);

  // ── "OTROS" dialog state ──────────────────────────────────────────────────
  const [otrosVisible, setOtrosVisible]       = useState(false);
  const [otrosLabel, setOtrosLabel]           = useState('');
  const [otrosPrice, setOtrosPrice]           = useState('');
  const [otrosPriceError, setOtrosPriceError] = useState('');

  // ── derived ───────────────────────────────────────────────────────────────
  const hasItems = items.length > 0;
  const isBusy   = actionState !== 'idle';

  const previewTicket = useMemo<import('../../lib/types').Ticket | null>(() => {
    if (!hasItems) return activeTicket;
    return {
      id: activeTicket?.id ?? 'preview',
      sessionId: activeSession?.id ?? '',
      ticketNumber: activeTicket?.ticketNumber ?? 1,
      printedAt: null,
      syncStatus: 'pending',
      createdAt: activeTicket?.createdAt ?? new Date().toISOString(),
      editedAt: null,
      editCount: 0,
      orders: [
        ...(activeTicket?.orders ?? []),
        {
          id: 'preview-order',
          ticketId: activeTicket?.id ?? 'preview',
          clientName,
          priceProfile,
          items,
          amountPaid: null,
          change: null,
          total,
          takeAway: cartTakeAway,
          createdAt: new Date().toISOString(),
        },
      ],
    };
  }, [hasItems, activeTicket, activeSession?.id, clientName, priceProfile, items, total, cartTakeAway]);

  // ── helpers ───────────────────────────────────────────────────────────────
  async function ensureTicket(): Promise<string> {
    if (activeTicket) return activeTicket.id;
    if (!activeSession) throw new Error('No hay sesión activa');
    const ticketNumber = nextTicketNumber();
    const dbTicket     = await insertTicket(activeSession.id, ticketNumber);
    openTicket(activeSession.id, dbTicket.ticketNumber, dbTicket.id);
    return dbTicket.id;
  }

  async function persistCurrentOrder(
    ticketId: string,
    overrideAmountPaid?: number,
    overrideChange?: number,
  ): Promise<Order> {
    const order = addOrder({
      clientName: clientName.trim() || 'PEDIDO',
      items,
      total,
      priceProfile,
      takeAway: cartTakeAway,
      amountPaid: overrideAmountPaid ?? paidAmount ?? undefined,
      change:     overrideChange     ?? paidChange  ?? undefined,
    });
    const finalOrder: Order = { ...order, ticketId };
    if (!testMode) {
      await saveOrderWithItems(finalOrder);
    }
    return finalOrder;
  }

  // ── new-ticket actions ────────────────────────────────────────────────────
  function handleCobrar(): void { setPaymentVisible(true); }

  function handlePaymentConfirm(amount: number, change: number): void {
    setPaidAmount(amount);
    setPaidChange(change);
    setPaymentVisible(false);
  }

  async function handleAddAnother(): Promise<void> {
    if (!hasItems) return;
    setActionState('saving');
    try {
      const done = perf.start('TICKET', 'handleAddAnother');
      const ticketId = await ensureTicket();
      await persistCurrentOrder(ticketId);
      parkTicket();
      done();
      log.info('TICKET', 'order parked, back to grid');
      clearCart();
      setPaidAmount(null);
      setPaidChange(null);
      setTicketVisible(false);
    } catch (e) {
      log.error('TICKET', 'handleAddAnother failed', e instanceof Error ? e.message : String(e));
      Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo guardar el pedido');
    } finally {
      setActionState('idle');
    }
  }

  async function handlePrint(): Promise<void> {
    if (!hasItems) return;
    setActionState('printing');
    try {
      const doneAll = perf.start('TICKET', 'handlePrint total');
      const ticketId = await ensureTicket();
      await persistCurrentOrder(ticketId);

      const currentTicket = useTicketStore.getState().activeTicket;
      if (!currentTicket) throw new Error('Ticket no encontrado en store');

      const allTickets = [...pendingTickets, currentTicket];
      log.info('TICKET', 'printing', { tickets: allTickets.length });

      const result = allTickets.length === 1
        ? await printTicket(currentTicket, testMode, MODIFIER_LABELS, RADIO_NO_SELECTION, RADIO_OPTION_SETS)
        : await printTickets(allTickets, testMode, MODIFIER_LABELS);

      if (!testMode) {
        for (const t of allTickets) {
          await markTicketPrinted(t.id);
        }
      }
      markPrinted();
      doneAll();

      if (!result.ok) {
        Alert.alert('Error de impresión', result.error ?? 'No se pudo conectar con la impresora',
          [{ text: 'Continuar', style: 'default' }]);
      }

      clearActiveTicket();
      clearCart();
      setPaidAmount(null);
      setPaidChange(null);
      setTicketVisible(false);
    } catch (e) {
      log.error('TICKET', 'handlePrint failed', e instanceof Error ? e.message : String(e));
      Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo imprimir');
    } finally {
      setActionState('idle');
    }
  }

  // ── index grid handlers ───────────────────────────────────────────────────
  function handleProductPress(product: Product): void {
    if (product.isCustom) {
      setOtrosLabel('');
      setOtrosPrice('');
      setOtrosPriceError('');
      setOtrosVisible(true);
      return;
    }
    if (product.alwaysShowModifiers && product.modifiers.length > 0) {
      setSheetProduct(product);
      return;
    }
    addProduct(product, []);
  }

  function handleProductLongPress(product: Product): void {
    if (product.modifiers.length > 0) setSheetProduct(product);
  }

  function handleModifierConfirm(selectedModifiers: string[]): void {
    if (sheetProduct) addProduct(sheetProduct, selectedModifiers);
    setSheetProduct(null);
  }

  function handleOtrosConfirm(): void {
    const label = otrosLabel.trim() || 'OTROS';
    const price = parseFloat(otrosPrice.replace(',', '.'));
    if (isNaN(price) || price <= 0) {
      setOtrosPriceError('Introduce un precio válido');
      return;
    }
    const otrosProduct = products.find((p) => p.isCustom);
    if (!otrosProduct) return;
    addProduct({ ...otrosProduct, basePrice: price }, [], label);
    setOtrosVisible(false);
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Test-mode banner */}
      <Banner visible={testMode} style={styles.testBanner} icon="alert">
        <Text style={styles.testBannerText}>MODO PRUEBA — nada se guardará</Text>
      </Banner>

      {/* Price profile banners */}
      <Banner visible={priceProfile === 'feriante'} style={styles.ferianteBanner} icon="tag-multiple">
        <Text style={styles.ferianteBannerText}>⚡ OFERTA FERIANTE activa</Text>
      </Banner>
      <Banner visible={priceProfile === 'invitacion'} style={styles.invitacionBanner} icon="gift">
        <Text style={styles.invitacionBannerText}>🎁 INVITACIÓN activa</Text>
      </Banner>

      {/* Client name input */}
      <View style={styles.nameRow}>
        <TextInput
          label="Nombre del cliente"
          value={clientName}
          onChangeText={setClientName}
          mode="outlined"
          style={styles.nameInput}
          autoCorrect={false}
          autoCapitalize="words"
          returnKeyType="done"
          dense
          placeholder="PEDIDO"
          right={
            clientName.length > 0
              ? <TextInput.Icon icon="close-circle" onPress={() => setClientName('')} />
              : undefined
          }
        />
      </View>

      {/* Pending tickets badge */}
      {pendingTickets.length > 0 && (
        <View style={styles.ticketBadge}>
          <Text style={styles.ticketBadgeText}>
            {pendingTickets.length} comanda{pendingTickets.length > 1 ? 's' : ''} en cola de impresión
          </Text>
        </View>
      )}

      {/* Product grid */}
      <View style={styles.gridWrapper}>
        {isLoadingProducts ? (
          <View style={styles.gridCenter}>
            <ActivityIndicator size="large" />
          </View>
        ) : products.length === 0 ? (
          <View style={styles.gridCenter}>
            <Text style={styles.gridErrorText}>No se pudieron cargar los productos.</Text>
            <Button mode="contained" onPress={() => void loadProducts()} style={styles.retryBtn}>
              Reintentar
            </Button>
          </View>
        ) : (
          <ProductGrid products={products} onSelect={handleProductPress} onLongPress={handleProductLongPress} />
        )}
      </View>

      {/* Cart summary */}
      <CartSummary
        items={items}
        total={total}
        onViewOrder={() => setTicketVisible(true)}
      />

      {/* Modifier sheet (index grid) */}
      <ModifierSheet
        product={sheetProduct}
        visible={sheetProduct !== null}
        onConfirm={handleModifierConfirm}
        onDismiss={() => setSheetProduct(null)}
      />

      {/* OTROS dialog */}
      <Portal>
        <Dialog visible={otrosVisible} onDismiss={() => setOtrosVisible(false)}>
          <Dialog.Title>Añadir producto</Dialog.Title>
          <Dialog.Content style={styles.otrosContent}>
            <TextInput
              label="Concepto"
              value={otrosLabel}
              onChangeText={setOtrosLabel}
              mode="outlined"
              autoCapitalize="sentences"
              returnKeyType="next"
              placeholder="OTROS"
              style={styles.otrosInput}
            />
            <TextInput
              label="Precio (€) *"
              value={otrosPrice}
              onChangeText={(v) => { setOtrosPrice(v); setOtrosPriceError(''); }}
              mode="outlined"
              keyboardType="decimal-pad"
              returnKeyType="done"
              error={!!otrosPriceError}
              style={styles.otrosInput}
            />
            {!!otrosPriceError && (
              <Text style={styles.otrosError}>{otrosPriceError}</Text>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setOtrosVisible(false)}>Cancelar</Button>
            <Button mode="contained" onPress={handleOtrosConfirm} disabled={!otrosPrice.trim()} buttonColor="#43A047">
              Añadir
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* New ticket modal — full screen, no navigation */}
      <Modal
        visible={ticketVisible}
        animationType="slide"
        onRequestClose={() => setTicketVisible(false)}
      >
        <NewTicketScreen
          testMode={testMode}
          activeTicket={activeTicket}
          pendingOrders={activeTicket?.orders ?? []}
          clientName={clientName}
          cartItems={items}
          cartTotal={total}
          paidAmount={paidAmount}
          paidChange={paidChange}
          actionState={actionState}
          isBusy={isBusy}
          hasItems={hasItems}
          previewTicket={previewTicket}
          modifierLabels={MODIFIER_LABELS}
          products={products}
          paymentVisible={paymentVisible}
          onCobrar={handleCobrar}
          onPaymentConfirm={handlePaymentConfirm}
          onPaymentDismiss={() => setPaymentVisible(false)}
          onAddAnother={() => void handleAddAnother()}
          onPrint={() => void handlePrint()}
          onIncrementItem={incrementItem}
          onDecrementItem={decrementItem}
          onRemoveItem={removeItem}
          onSetClientName={setClientName}
          onAddProduct={addProduct}
          onBack={() => setTicketVisible(false)}
        />
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  testBanner: { backgroundColor: '#FF6F00' },
  testBannerText: { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: 0.5 },
  ferianteBanner: { backgroundColor: '#1E88E5' },
  ferianteBannerText: { color: '#fff', fontWeight: '800', fontSize: 14, letterSpacing: 0.4 },
  invitacionBanner: { backgroundColor: '#43A047' },
  invitacionBannerText: { color: '#fff', fontWeight: '800', fontSize: 14, letterSpacing: 0.4 },
  nameRow: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: '#fff',
  },
  nameInput: {
    fontSize: 17,
    backgroundColor: '#fff',
  },
  ticketBadge: {
    backgroundColor: '#E3F2FD',
    paddingVertical: 2,
    paddingLeft: 16,
    paddingRight: 4,
  },
  ticketBadgeText: {
    fontSize: 13,
    color: '#1565C0',
    fontWeight: '600',
  },
  gridWrapper: { flex: 1 },
  gridCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 32,
  },
  gridErrorText: { fontSize: 15, color: '#666', textAlign: 'center' },
  retryBtn: { borderRadius: 8 },
  otrosContent: { gap: 12 },
  otrosInput: { backgroundColor: '#fff' },
  otrosError: { color: '#E53935', fontSize: 12, marginTop: -8 },
});
