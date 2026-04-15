import React from 'react';
import { Modal, ScrollView, StyleSheet, TouchableWithoutFeedback, View } from 'react-native';
import {
  ActivityIndicator,
  Banner,
  Button,
  Dialog,
  Divider,
  IconButton,
  Portal,
  Surface,
  Text,
  TextInput,
} from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PaymentModal from '../../components/PaymentModal';
import TicketPreview from '../../components/TicketPreview';
import ProductGrid from '../../components/ProductGrid';
import ModifierSheet from '../../components/ModifierSheet';

import { formatPrice } from '../../lib/utils';
import type { Modifier, Order, OrderItem, Product, Ticket } from '../../lib/types';

// ---------------------------------------------------------------------------
// buildMaps — exported for use in index.tsx
// ---------------------------------------------------------------------------

export function buildMaps(modifiers: Modifier[]): {
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
// EditableItemRow — inline qty controls
// ---------------------------------------------------------------------------

function EditableItemRow({
  item,
  modifierLabels,
  onIncrement,
  onDecrement,
  onRemove,
}: {
  item: OrderItem;
  modifierLabels: Record<string, string>;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const modLabels = item.selectedModifiers.map((id) => modifierLabels[id] ?? id);
  const linePrice = (item.unitPrice + item.modifierPriceAdd) * item.qty;

  return (
    <View style={editItemStyles.row}>
      <View style={editItemStyles.left}>
        <Text style={editItemStyles.name}>{item.customLabel ?? item.productName}</Text>
        {modLabels.map((label) => (
          <Text key={label} style={editItemStyles.mod}>· {label}</Text>
        ))}
        <Text style={editItemStyles.price}>{formatPrice(linePrice)}</Text>
      </View>
      <View style={editItemStyles.controls}>
        <IconButton icon="delete-outline" size={20} iconColor="#E53935" onPress={onRemove} style={editItemStyles.iconBtn} />
        <IconButton icon="minus" size={20} mode="contained" containerColor="#EEE" iconColor="#333" onPress={onDecrement} style={editItemStyles.iconBtn} />
        <Text style={editItemStyles.qty}>{item.qty}</Text>
        <IconButton icon="plus" size={20} mode="contained" containerColor="#43A047" iconColor="#fff" onPress={onIncrement} style={editItemStyles.iconBtn} />
      </View>
    </View>
  );
}

const editItemStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
    gap: 8,
  },
  left: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '600', color: '#111' },
  mod: { fontSize: 13, color: '#E65100', paddingLeft: 4 },
  price: { fontSize: 13, color: '#555', fontWeight: '500' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  iconBtn: { margin: 0 },
  qty: { fontSize: 17, fontWeight: '800', color: '#111', minWidth: 24, textAlign: 'center' },
});

// ---------------------------------------------------------------------------
// NewTicketScreen
// ---------------------------------------------------------------------------

export interface NewTicketProps {
  testMode: boolean;
  activeTicket: Ticket | null;
  pendingOrders: Order[];
  clientName: string;
  cartItems: OrderItem[];
  cartTotal: number;
  paidAmount: number | null;
  paidChange: number | null;
  actionState: 'idle' | 'saving' | 'printing';
  isBusy: boolean;
  hasItems: boolean;
  previewTicket: Ticket | null;
  modifierLabels: Record<string, string>;
  products: Product[];
  paymentVisible: boolean;
  onCobrar: () => void;
  onPaymentConfirm: (amount: number, change: number) => void;
  onPaymentDismiss: () => void;
  onAddAnother: () => void;
  onPrint: () => void;
  onIncrementItem: (id: string) => void;
  onDecrementItem: (id: string) => void;
  onRemoveItem: (id: string) => void;
  onSetClientName: (name: string) => void;
  onAddProduct: (product: Product, selectedModifiers: string[], customLabel?: string) => void;
  onBack: () => void;
}

export default function NewTicketScreen({
  testMode, activeTicket, pendingOrders, clientName, cartItems, cartTotal,
  paidAmount, paidChange, actionState, isBusy, hasItems, previewTicket, modifierLabels,
  paymentVisible, onCobrar, onPaymentConfirm, onPaymentDismiss,
  onAddAnother, onPrint,
  onIncrementItem, onDecrementItem, onRemoveItem,
  onSetClientName, onAddProduct, products,
  onBack: _onBack,
}: NewTicketProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [renameVisible, setRenameVisible] = React.useState(false);
  const [renameText, setRenameText] = React.useState('');
  const [addingProduct, setAddingProduct] = React.useState(false);
  const [sheetProduct, setSheetProduct] = React.useState<Product | null>(null);

  function handleRenameOpen(): void {
    setRenameText(clientName);
    setRenameVisible(true);
  }
  function handleRenameConfirm(): void {
    onSetClientName(renameText.trim());
    setRenameVisible(false);
  }
  function handleProductSelected(product: Product): void {
    if (product.isCustom) return;
    if (product.alwaysShowModifiers && product.modifiers.length > 0) {
      setSheetProduct(product);
      return;
    }
    onAddProduct(product, []);
    setAddingProduct(false);
  }
  function handleProductLongPress(product: Product): void {
    if (product.modifiers.length > 0) setSheetProduct(product);
  }
  function handleModifierConfirm(mods: string[]): void {
    if (sheetProduct) onAddProduct(sheetProduct, mods);
    setSheetProduct(null);
    setAddingProduct(false);
  }

  return (
    <View style={styles.root}>
      <Banner visible={testMode} style={styles.testBanner} icon="alert">
        <Text style={styles.testBannerText}>MODO PRUEBA — nada se guardará</Text>
      </Banner>

      {/* Ticket header */}
      <Surface style={styles.ticketHeader} elevation={1}>
        <Text style={styles.ticketHeaderText}>RESUMEN DEL PEDIDO</Text>
        {activeTicket && activeTicket.orders.length > 0 && (
          <Text style={styles.ticketHeaderSub}>
            Comanda #{activeTicket.ticketNumber}  ·  {activeTicket.orders.length} pedido{activeTicket.orders.length > 1 ? 's' : ''} previo{activeTicket.orders.length > 1 ? 's' : ''}
          </Text>
        )}
      </Surface>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View>
          {/* Client header */}
          <Surface style={styles.editOrderCard} elevation={1}>
            <View style={styles.editOrderHeader}>
              <Text style={styles.editClientName}>{clientName || '—'}</Text>
              <View style={styles.editOrderHeaderActions}>
                <Button compact mode="text" icon="account-edit" onPress={handleRenameOpen} textColor="#1E88E5">
                  Nombre
                </Button>
              </View>
            </View>

            <Divider />

            {cartItems.length === 0 ? (
              <Text style={styles.emptyOrderText}>No hay productos en el carrito</Text>
            ) : (
              cartItems.map((item) => (
                <EditableItemRow
                  key={item.id}
                  item={item}
                  modifierLabels={modifierLabels}
                  onIncrement={() => onIncrementItem(item.id)}
                  onDecrement={() => onDecrementItem(item.id)}
                  onRemove={() => onRemoveItem(item.id)}
                />
              ))
            )}

            <Button
              mode="text"
              icon="plus"
              onPress={() => setAddingProduct(true)}
              style={styles.addProductBtn}
              contentStyle={styles.addProductBtnContent}
              textColor="#1E88E5"
            >
              Añadir producto
            </Button>
          </Surface>

          <Divider style={styles.totalDivider} />

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>TOTAL</Text>
            <Text style={styles.totalAmount}>{formatPrice(cartTotal)}</Text>
          </View>

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

          {pendingOrders.length > 0 && (
            <View style={styles.prevOrdersBox}>
              <Text style={styles.prevOrdersTitle}>Pedidos anteriores en esta comanda</Text>
              {pendingOrders.map((o) => (
                <Text key={o.id} style={styles.prevOrderRow}>
                  {o.clientName} — {formatPrice(o.total)}
                </Text>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {testMode && (
        <View style={styles.previewRow}>
          <TicketPreview
            ticket={previewTicket}
            isTest={testMode}
            modifierLabels={modifierLabels}
          />
        </View>
      )}

      <Surface style={styles.actions} elevation={5}>
        <Divider />
        <View style={[styles.actionsInner, { paddingBottom: 12 + insets.bottom }]}>
          <Button
            mode="contained"
            onPress={onCobrar}
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
            <Button
              mode="contained"
              onPress={onAddAnother}
              disabled={!hasItems || isBusy}
              buttonColor="#1E88E5"
              style={[styles.btn, styles.btnHalf]}
              contentStyle={styles.btnContent}
              labelStyle={styles.btnLabel}
              icon={actionState === 'saving' ? undefined : 'plus'}
            >
              {actionState === 'saving' ? <ActivityIndicator color="#fff" size={20} /> : 'Añadir otro'}
            </Button>
            <Button
              mode="contained"
              onPress={onPrint}
              disabled={!hasItems || isBusy}
              buttonColor="#E53935"
              style={[styles.btn, styles.btnHalf]}
              contentStyle={styles.btnContent}
              labelStyle={styles.btnLabel}
              icon={actionState === 'printing' ? undefined : 'printer'}
            >
              {actionState === 'printing' ? <ActivityIndicator color="#fff" size={20} /> : testMode ? 'Imprimir prueba' : 'Imprimir'}
            </Button>
          </View>
        </View>
      </Surface>

      <PaymentModal
        visible={paymentVisible}
        total={cartTotal}
        onConfirm={onPaymentConfirm}
        onDismiss={onPaymentDismiss}
      />

      {/* Product grid modal */}
      <Modal
        visible={addingProduct}
        animationType="slide"
        onRequestClose={() => setAddingProduct(false)}
      >
        <TouchableWithoutFeedback onPress={() => setAddingProduct(false)}>
          <View style={styles.gridBackdrop} />
        </TouchableWithoutFeedback>
        <Surface style={styles.gridSheet} elevation={4}>
          <View style={styles.gridHandle} />
          <Text style={styles.gridTitle}>Añadir producto</Text>
          <ProductGrid
            products={products}
            onSelect={handleProductSelected}
            onLongPress={handleProductLongPress}
          />
        </Surface>
      </Modal>

      <ModifierSheet
        product={sheetProduct}
        visible={sheetProduct !== null}
        onConfirm={handleModifierConfirm}
        onDismiss={() => setSheetProduct(null)}
      />

      {/* Rename dialog */}
      <Portal>
        <Dialog visible={renameVisible} onDismiss={() => setRenameVisible(false)}>
          <Dialog.Title>Nombre del cliente</Dialog.Title>
          <Dialog.Content>
            <TextInput
              value={renameText}
              onChangeText={setRenameText}
              mode="outlined"
              autoCapitalize="words"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleRenameConfirm}
              style={styles.renameInput}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setRenameVisible(false)}>Cancelar</Button>
            <Button mode="contained" onPress={handleRenameConfirm} buttonColor="#1E88E5">Guardar</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f5f5' },

  testBanner: { backgroundColor: '#FF6F00' },
  testBannerText: { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: 0.5 },

  ticketHeader: { backgroundColor: '#E3F2FD', paddingVertical: 10, paddingHorizontal: 16 },
  ticketHeaderText: { fontSize: 13, color: '#1565C0', fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  ticketHeaderSub: { fontSize: 12, color: '#1565C0', fontWeight: '500', marginTop: 2, opacity: 0.8 },

  editOrderCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    marginBottom: 12,
    overflow: 'hidden',
  },
  editOrderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    paddingBottom: 8,
  },
  editOrderHeaderActions: { flexDirection: 'row', gap: 0 },
  editClientName: { fontSize: 16, fontWeight: '800', color: '#111' },
  emptyOrderText: { fontSize: 13, color: '#bbb', fontStyle: 'italic', padding: 14, paddingVertical: 10 },
  addProductBtn: { margin: 4 },
  addProductBtnContent: { height: 40 },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 24 },

  totalDivider: { marginTop: 8 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: 12 },
  totalLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 1, color: '#888' },
  totalAmount: { fontSize: 32, fontWeight: '800', color: '#1a1a1a' },
  paidRow: { flexDirection: 'row', gap: 16, paddingBottom: 12 },
  paidCol: { flex: 1 },
  paidLabel: { fontSize: 12, color: '#888', marginBottom: 2 },
  paidValue: { fontSize: 18, fontWeight: '700', color: '#333' },
  changeValue: { color: '#43A047' },
  prevOrdersBox: { backgroundColor: '#F3F8FF', borderRadius: 8, padding: 12, marginTop: 8 },
  prevOrdersTitle: { fontSize: 12, fontWeight: '700', color: '#1565C0', marginBottom: 6, letterSpacing: 0.5 },
  prevOrderRow: { fontSize: 14, color: '#333', paddingVertical: 2 },

  previewRow: { paddingHorizontal: 16, paddingBottom: 2, alignItems: 'flex-end', backgroundColor: '#f5f5f5' },

  actions: { backgroundColor: '#fff' },
  actionsInner: { padding: 12, gap: 10 },
  btnRow: { flexDirection: 'row', gap: 10 },
  btn: { borderRadius: 10 },
  btnHalf: { flex: 1 },
  btnContent: { height: 56 },
  btnLabel: { fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },

  gridBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  gridSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
    backgroundColor: '#fff',
    maxHeight: '80%',
  },
  gridHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: '#ccc',
    alignSelf: 'center', marginTop: 12, marginBottom: 4,
  },
  gridTitle: { fontSize: 16, fontWeight: '700', color: '#111', padding: 16, paddingBottom: 8 },

  renameInput: { backgroundColor: '#fff' },
});
