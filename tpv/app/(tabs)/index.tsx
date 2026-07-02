import React, { useCallback, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { ActivityIndicator, Banner, Button, Dialog, Portal, Text, TextInput } from 'react-native-paper';

import CartSummary from '../../components/CartSummary';
import ModifierSheet from '../../components/ModifierSheet';
import PaymentModal from '../../components/PaymentModal';
import ProductGrid from '../../components/ProductGrid';
import StableTextInput from '../../components/StableTextInput';
import NewTicketScreen from '../ticket/NewTicketScreen';

import type { Product } from '../../lib/types';
import type { Order } from '../../lib/types';
import { isSessionStale } from '../../lib/utils';
import { useCartStore } from '../../stores/useCartStore';
import { useSessionStore } from '../../stores/useSessionStore';
import { useTicketStore } from '../../stores/useTicketStore';
import { buildMaps } from '../ticket/NewTicketScreen';

import {
  insertTicket,
  markTicketPrinted,
  saveOrderWithItems,
} from '../../services/db';
import { printTicket } from '../../services/printer';
import { log, perf } from '../../services/logger';

type ActionState = 'idle' | 'printing';

export default function HomeScreen(): React.JSX.Element {
  const router = useRouter();

  // ── stores ────────────────────────────────────────────────────────────────
  const products          = useSessionStore((s) => s.products);
  const isLoadingProducts = useSessionStore((s) => s.isLoadingProducts);
  const loadProducts      = useSessionStore((s) => s.loadProducts);
  const activeSession       = useSessionStore((s) => s.activeSession);
  const activeProductProfile = useSessionStore((s) => s.activeProductProfile);
  const nextTicketNumber    = useSessionStore((s) => s.nextTicketNumber);
  const forcePrintTwice     = useSessionStore((s) => s.forcePrintTwice);
  const printNoPrint        = useSessionStore((s) => s.printNoPrint);
  const printCopies         = useSessionStore((s) => s.printCopies);
  const setPrintNoPrint     = useSessionStore((s) => s.setPrintNoPrint);
  const togglePrintCopies   = useSessionStore((s) => s.togglePrintCopies);
  const closeCurrentSession = useSessionStore((s) => s.closeCurrentSession);

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
  const openTicket      = useTicketStore((s) => s.openTicket);
  const addOrder        = useTicketStore((s) => s.addOrder);
  const markPrinted     = useTicketStore((s) => s.markPrinted);
  const clearActiveTicket = useTicketStore((s) => s.clearActiveTicket);

  // ── modifier maps ─────────────────────────────────────────────────────────
  // Built from ALL products (not the profile-filtered grid) so modifier labels
  // always resolve, even for items whose product belongs to another profile.
  const { labels: MODIFIER_LABELS, radioNoSelection: RADIO_NO_SELECTION, radioOptionSets: RADIO_OPTION_SETS } =
    useMemo(() => buildMaps(products.flatMap((p) => p.modifiers)), [products]);

  // ── profile-filtered grid ─────────────────────────────────────────────────
  // Only products of the active profile are shown; the custom "OTROS" product
  // is always visible so a free-price item can be added in any profile.
  const visibleProducts = useMemo(
    () => products.filter((p) => p.isCustom || p.profile === activeProductProfile),
    [products, activeProductProfile],
  );

  // ── stale session warning ─────────────────────────────────────────────────
  const [staleDialogVisible, setStaleDialogVisible] = useState(false);
  const [closingStale, setClosingStale]             = useState(false);

  useFocusEffect(useCallback(() => {
    if (activeSession && isSessionStale(activeSession.openedAt)) {
      setStaleDialogVisible(true);
    }
  }, [activeSession]));

  async function handleCloseStaleSession(): Promise<void> {
    setClosingStale(true);
    try {
      await closeCurrentSession();
      setStaleDialogVisible(false);
      router.navigate('/(tabs)/session');
    } catch {
      Alert.alert('Error', 'No se pudo cerrar la sesión. Inténtalo desde la pestaña Sesión.');
      setStaleDialogVisible(false);
    } finally {
      setClosingStale(false);
    }
  }

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
    await saveOrderWithItems(finalOrder);
    return finalOrder;
  }

  // ── new-ticket actions ────────────────────────────────────────────────────
  function handleCobrar(): void { setPaymentVisible(true); }

  function handlePaymentConfirm(amount: number, change: number): void {
    setPaidAmount(amount);
    setPaidChange(change);
    setPaymentVisible(false);
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

      const effectiveTwice = printCopies === 'x2' || forcePrintTwice;
      log.info('TICKET', 'printing', { noPrint: printNoPrint, twice: effectiveTwice, forced: forcePrintTwice });

      // Red "no print" toggle: save and finalize the order but skip the physical print.
      if (!printNoPrint) {
        const normalPrices: Record<string, number> = {};
        for (const p of products) {
          normalPrices[p.id] = activeSession?.priceOverrides[p.id] ?? p.basePrice;
        }
        const result = await printTicket(currentTicket, false, MODIFIER_LABELS, RADIO_NO_SELECTION, RADIO_OPTION_SETS, effectiveTwice, normalPrices);
        // result.cancelled = el usuario abortó el envío desde el overlay; no es
        // un error real, así que no mostramos alerta.
        if (!result.ok && !result.cancelled) {
          Alert.alert('Error de impresión', result.error ?? 'No se pudo conectar con la impresora',
            [{ text: 'Continuar', style: 'default' }]);
        }
      }

      await markTicketPrinted(currentTicket.id);
      markPrinted();
      doneAll();

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
      {/* Price profile banners */}
      <Banner visible={priceProfile === 'feriante'} style={styles.ferianteBanner} icon="tag-multiple">
        <Text style={styles.ferianteBannerText}>⚡ OFERTA FERIANTE activa</Text>
      </Banner>
      <Banner visible={priceProfile === 'invitacion'} style={styles.invitacionBanner} icon="gift">
        <Text style={styles.invitacionBannerText}>🎁 INVITACIÓN activa</Text>
      </Banner>

      {/* Client name input */}
      <View style={styles.nameRow}>
        <StableTextInput
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
          <ProductGrid products={visibleProducts} onSelect={handleProductPress} onLongPress={handleProductLongPress} />
        )}
      </View>

      {/* Cart summary */}
      <CartSummary
        items={items}
        total={total}
        onViewOrder={() => {
          if (!activeSession) {
            Alert.alert(
              'Sin sesión activa',
              'No hay ninguna sesión abierta. ¿Quieres ir a abrir una?',
              [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Ir a Sesión', onPress: () => router.navigate('/(tabs)/session') },
              ],
            );
            return;
          }
          setTicketVisible(true);
        }}
      />

      {/* Modifier sheet (index grid) */}
      <ModifierSheet
        product={sheetProduct}
        visible={sheetProduct !== null}
        onConfirm={handleModifierConfirm}
        onDismiss={() => setSheetProduct(null)}
      />

      {/* Stale session warning */}
      <Portal>
        <Dialog visible={staleDialogVisible} onDismiss={() => setStaleDialogVisible(false)}>
          <Dialog.Title>Sesión antigua activa</Dialog.Title>
          <Dialog.Content>
            <Text>La sesión actual lleva más de 20 horas abierta. Los nuevos pedidos se añadirán a la sesión anterior.{'\n\n'}¿Quieres cerrarla y abrir una sesión nueva?</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setStaleDialogVisible(false)} disabled={closingStale}>
              Continuar así
            </Button>
            <Button
              mode="contained"
              onPress={() => void handleCloseStaleSession()}
              loading={closingStale}
              buttonColor="#E53935"
            >
              Cerrar y nueva sesión
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* OTROS dialog */}
      <Portal>
        <Dialog visible={otrosVisible} onDismiss={() => setOtrosVisible(false)}>
          <Dialog.Title>Añadir producto</Dialog.Title>
          <Dialog.Content style={styles.otrosContent}>
            <StableTextInput
              label="Concepto"
              value={otrosLabel}
              onChangeText={setOtrosLabel}
              mode="outlined"
              autoCapitalize="sentences"
              returnKeyType="next"
              placeholder="OTROS"
              style={styles.otrosInput}
            />
            <StableTextInput
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
        <Portal.Host>
          <NewTicketScreen
            clientName={clientName}
            cartItems={items}
            cartTotal={total}
            paidAmount={paidAmount}
            paidChange={paidChange}
            actionState={actionState}
            isBusy={isBusy}
            hasItems={hasItems}
            printNoPrint={printNoPrint}
            printCopies={printCopies}
            modifierLabels={MODIFIER_LABELS}
            products={visibleProducts}
            onCobrar={handleCobrar}
            onPrint={() => void handlePrint()}
            onPressNoPrint={() => void setPrintNoPrint()}
            onPressCopies={() => void togglePrintCopies()}
            onIncrementItem={incrementItem}
            onDecrementItem={decrementItem}
            onRemoveItem={removeItem}
            onSetClientName={setClientName}
            onAddProduct={addProduct}
            onBack={() => setTicketVisible(false)}
          />
          <PaymentModal
            visible={paymentVisible}
            total={total}
            onConfirm={handlePaymentConfirm}
            onDismiss={() => setPaymentVisible(false)}
          />
        </Portal.Host>
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
