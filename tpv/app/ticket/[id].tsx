import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, TouchableWithoutFeedback, View } from 'react-native';
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
import { TouchableRipple } from 'react-native-paper';
import { useLocalSearchParams, useRouter } from 'expo-router';

import ProductGrid from '../../components/ProductGrid';
import ModifierSheet from '../../components/ModifierSheet';

import { formatPrice } from '../../lib/utils';
import { generateId } from '../../lib/utils';
import type { Order, OrderItem, Product } from '../../lib/types';

import { useSessionStore } from '../../stores/useSessionStore';

import {
  deleteTicket,
  getTicketById,
  markTicketPrinted,
  updateTicketWithOrders,
} from '../../services/db';
import { printTicket } from '../../services/printer';
import { buildMaps } from './NewTicketScreen';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScreenMode = 'view' | 'edit';

// ---------------------------------------------------------------------------
// OrderItemRow — used in both view and new-ticket modes
// ---------------------------------------------------------------------------

function OrderItemRow({
  item,
  modifierLabels,
  onLongPress,
}: {
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
// EditableItemRow — inline qty controls in edit mode
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
// Screen
// ---------------------------------------------------------------------------

export default function TicketScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();

  // ── stores ────────────────────────────────────────────────────────────────
  const testMode = useSessionStore((s) => s.testMode);
  const products = useSessionStore((s) => s.products);

  const { labels: MODIFIER_LABELS, radioNoSelection: RADIO_NO_SELECTION, radioOptionSets: RADIO_OPTION_SETS } =
    useMemo(() => buildMaps(products.flatMap((p) => p.modifiers)), [products]);

  // ── screen mode ───────────────────────────────────────────────────────────
  const [mode, setMode] = useState<ScreenMode>('view');

  // ── saved-ticket state ────────────────────────────────────────────────────
  const [savedTicket,   setSavedTicket]   = useState<import('../../lib/types').Ticket | null>(null);
  const [loadingTicket, setLoadingTicket] = useState(true);

  // ── edit mode state ───────────────────────────────────────────────────────
  const [editOrders, setEditOrders] = useState<Order[]>([]);
  const [saving,     setSaving]     = useState(false);

  const [addingToOrderId, setAddingToOrderId] = useState<string | null>(null);
  const [sheetProduct,    setSheetProduct]    = useState<Product | null>(null);
  const [renameOrder,     setRenameOrder]     = useState<Order | null>(null);
  const [renameText,      setRenameText]      = useState('');

  // ── load saved ticket ─────────────────────────────────────────────────────
  useEffect(() => {
    setLoadingTicket(true);
    getTicketById(id ?? '').then((t) => {
      setSavedTicket(t);
      setLoadingTicket(false);
    }).catch(() => setLoadingTicket(false));
  }, [id]);

  // ── edit mode: enter ──────────────────────────────────────────────────────
  function handleStartEdit(): void {
    if (!savedTicket) return;
    // Deep clone so Cancel can discard changes
    setEditOrders(JSON.parse(JSON.stringify(savedTicket.orders)) as Order[]);
    setMode('edit');
  }

  function handleCancelEdit(): void {
    setMode('view');
    setEditOrders([]);
    setAddingToOrderId(null);
  }

  // ── edit mode: order mutations ────────────────────────────────────────────
  function editSetOrders(updater: (prev: Order[]) => Order[]): void {
    setEditOrders(updater);
  }

  function handleItemIncrement(orderId: string, itemId: string): void {
    editSetOrders((orders) =>
      orders.map((o) =>
        o.id !== orderId ? o :
        { ...o, items: o.items.map((i) => i.id !== itemId ? i : { ...i, qty: i.qty + 1 }),
          total: recalcTotal({ ...o, items: o.items.map((i) => i.id !== itemId ? i : { ...i, qty: i.qty + 1 }) }) }
      )
    );
  }

  function handleItemDecrement(orderId: string, itemId: string): void {
    editSetOrders((orders) =>
      orders.map((o) => {
        if (o.id !== orderId) return o;
        const item = o.items.find((i) => i.id === itemId);
        if (!item) return o;
        const newItems = item.qty <= 1
          ? o.items.filter((i) => i.id !== itemId)
          : o.items.map((i) => i.id !== itemId ? i : { ...i, qty: i.qty - 1 });
        return { ...o, items: newItems, total: recalcTotal({ ...o, items: newItems }) };
      })
    );
  }

  function handleItemRemove(orderId: string, itemId: string): void {
    editSetOrders((orders) =>
      orders.map((o) => {
        if (o.id !== orderId) return o;
        const newItems = o.items.filter((i) => i.id !== itemId);
        return { ...o, items: newItems, total: recalcTotal({ ...o, items: newItems }) };
      })
    );
  }

  function handleAddComensal(): void {
    const newOrder: Order = {
      id: generateId(),
      ticketId: savedTicket?.id ?? '',
      clientName: '',
      priceProfile: 'normal',
      takeAway: false,
      items: [],
      amountPaid: null,
      change: null,
      total: 0,
      createdAt: new Date().toISOString(),
    };
    editSetOrders((prev) => [...prev, newOrder]);
  }

  function handleRemoveComensal(orderId: string): void {
    const order = editOrders.find((o) => o.id === orderId);
    if (!order) return;
    const doRemove = () => editSetOrders((prev) => prev.filter((o) => o.id !== orderId));
    if (order.items.length > 0) {
      Alert.alert(
        '¿Eliminar comensal?',
        `${order.clientName || 'Sin nombre'} tiene ${order.items.length} producto${order.items.length !== 1 ? 's' : ''}. Se perderán.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Eliminar', style: 'destructive', onPress: doRemove },
        ],
      );
    } else {
      doRemove();
    }
  }

  function handleRenameOrder(order: Order): void {
    setRenameOrder(order);
    setRenameText(order.clientName);
  }

  function handleRenameConfirm(): void {
    if (!renameOrder) return;
    editSetOrders((orders) =>
      orders.map((o) => o.id !== renameOrder.id ? o : { ...o, clientName: renameText.trim() })
    );
    setRenameOrder(null);
  }

  // ── edit mode: add product via ProductGrid ────────────────────────────────
  function handleAddProductToOrder(orderId: string, product: Product, selectedModifiers: string[], customLabel?: string): void {
    const effectivePrice = product.basePrice; // session overrides already in basePrice snapshot
    const modifierPriceAdd = product.modifiers.reduce((sum, m) => {
      if (m.priceAdd && selectedModifiers.includes(m.id)) return sum + m.priceAdd;
      return sum;
    }, 0);

    editSetOrders((orders) =>
      orders.map((o) => {
        if (o.id !== orderId) return o;
        const modKey = [...selectedModifiers].sort().join(',');
        const existing = o.items.find(
          (i) => i.productId === product.id &&
            [...i.selectedModifiers].sort().join(',') === modKey &&
            i.customLabel === (customLabel ?? null),
        );
        const newItems = existing
          ? o.items.map((i) => i.id === existing.id ? { ...i, qty: i.qty + 1 } : i)
          : [...o.items, {
              id: generateId(),
              orderId: o.id,
              productId: product.id,
              productName: product.name,
              qty: 1,
              unitPrice: effectivePrice,
              modifierPriceAdd,
              selectedModifiers,
              customLabel: customLabel ?? null,
            }];
        return { ...o, items: newItems, total: recalcTotal({ ...o, items: newItems }) };
      })
    );
  }

  // ── edit mode: save ───────────────────────────────────────────────────────
  async function handleSave(): Promise<void> {
    if (!savedTicket) return;
    setSaving(true);
    try {
      const updatedTicket: import('../../lib/types').Ticket = {
        ...savedTicket,
        orders: editOrders,
      };
      await updateTicketWithOrders(updatedTicket);

      const refreshed = await getTicketById(savedTicket.id);
      setSavedTicket(refreshed);

      setMode('view');
      setEditOrders([]);

      if (refreshed) {
        const result = await printTicket(refreshed, testMode, MODIFIER_LABELS, RADIO_NO_SELECTION, RADIO_OPTION_SETS);
        if (!result.ok) {
          Alert.alert('Error de impresión', result.error ?? 'No se pudo conectar con la impresora');
        } else if (!testMode) {
          await markTicketPrinted(refreshed.id);
        }
      }
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteTicket(): Promise<void> {
    if (!savedTicket) return;
    try {
      await deleteTicket(savedTicket.id);
      router.back();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo eliminar el ticket');
    }
  }


  // ── render ────────────────────────────────────────────────────────────────
  if (loadingTicket) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!savedTicket) {
    return (
      <View style={styles.centered}>
        <Text style={styles.noSessionText}>Ticket no encontrado</Text>
      </View>
    );
  }

  if (mode === 'edit') {
      return (
        <EditModeScreen
          ticket={savedTicket}
          editOrders={editOrders}
          products={products}
          modifierLabels={MODIFIER_LABELS}
          saving={saving}
          addingToOrderId={addingToOrderId}
          sheetProduct={sheetProduct}
          renameOrder={renameOrder}
          renameText={renameText}
          onRenameTextChange={setRenameText}
          onRenameConfirm={handleRenameConfirm}
          onRenameDismiss={() => setRenameOrder(null)}
          onItemIncrement={handleItemIncrement}
          onItemDecrement={handleItemDecrement}
          onItemRemove={handleItemRemove}
          onAddComensal={handleAddComensal}
          onRemoveComensal={handleRemoveComensal}
          onRenameOrder={handleRenameOrder}
          onOpenProductGrid={(orderId) => setAddingToOrderId(orderId)}
          onCloseProductGrid={() => setAddingToOrderId(null)}
          onProductSelected={(product) => {
            if (!addingToOrderId) return;
            if (product.isCustom) {
              // Custom products handled inline — skip for now, same as flow normal
              return;
            }
            if (product.alwaysShowModifiers && product.modifiers.length > 0) {
              setSheetProduct(product);
              return;
            }
            handleAddProductToOrder(addingToOrderId, product, []);
            setAddingToOrderId(null);
          }}
          onProductLongPress={(product) => {
            if (product.modifiers.length > 0) setSheetProduct(product);
          }}
          onModifierConfirm={(mods) => {
            if (sheetProduct && addingToOrderId) {
              handleAddProductToOrder(addingToOrderId, sheetProduct, mods);
            }
            setSheetProduct(null);
            setAddingToOrderId(null);
          }}
          onModifierDismiss={() => setSheetProduct(null)}
          onCancel={handleCancelEdit}
          onSave={() => void handleSave()}
        />
      );
    }

  // VIEW mode
  return (
    <ViewModeScreen
      ticket={savedTicket}
      modifierLabels={MODIFIER_LABELS}
      onStartEdit={handleStartEdit}
      onDeleteTicket={() => void handleDeleteTicket()}
    />
  );
}

// ---------------------------------------------------------------------------
// ViewModeScreen
// ---------------------------------------------------------------------------

function ViewModeScreen({
  ticket,
  modifierLabels,
  onStartEdit,
  onDeleteTicket,
}: {
  ticket: import('../../lib/types').Ticket;
  modifierLabels: Record<string, string>;
  onStartEdit: () => void;
  onDeleteTicket: () => void;
}): React.JSX.Element {
  const [deleteDialogVisible, setDeleteDialogVisible] = React.useState(false);
  const ticketTotal = ticket.orders.reduce((s, o) => s + o.total, 0);

  return (
    <View style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <Surface style={styles.viewHeader} elevation={1}>
          <Text style={styles.viewTicketNum}>Comanda #{ticket.ticketNumber}</Text>
          <View style={styles.viewHeaderActions}>
            <Button
              mode="contained-tonal"
              icon="pencil"
              onPress={onStartEdit}
              compact
              style={styles.editBtn}
              contentStyle={styles.editBtnContent}
            >
              Editar ticket
            </Button>
            <Button
              mode="contained"
              icon="delete"
              onPress={() => setDeleteDialogVisible(true)}
              compact
              style={styles.editBtn}
              contentStyle={styles.editBtnContent}
              buttonColor="#E53935"
            >
              Eliminar
            </Button>
          </View>
          {ticket.editedAt != null && (
            <View style={styles.editedBadge}>
              <Text style={styles.editedBadgeText}>✏ Editado · {ticket.editCount}×</Text>
            </View>
          )}
        </Surface>

        {/* Orders */}
        {ticket.orders.map((order) => (
          <Surface key={order.id} style={styles.orderCard} elevation={1}>
            <Text style={styles.orderClientName}>{order.clientName || '—'}</Text>
            <Divider />
            {order.items.map((item) => (
              <OrderItemRow
                key={item.id}
                item={item}
                modifierLabels={modifierLabels}
                onLongPress={() => {/* view mode: no-op */}}
              />
            ))}
            <View style={styles.orderTotalRow}>
              <Text style={styles.orderTotalLabel}>Subtotal</Text>
              <Text style={styles.orderTotalValue}>{formatPrice(order.total)}</Text>
            </View>
          </Surface>
        ))}

        {/* Grand total */}
        <View style={styles.grandTotalRow}>
          <Text style={styles.grandTotalLabel}>TOTAL</Text>
          <Text style={styles.grandTotalValue}>{formatPrice(ticketTotal)}</Text>
        </View>
      </ScrollView>

      {/* Delete confirmation dialog */}
      <Portal>
        <Dialog visible={deleteDialogVisible} onDismiss={() => setDeleteDialogVisible(false)}>
          <Dialog.Title>¿Eliminar ticket?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              Esta acción no se puede deshacer. Se eliminará la comanda #{ticket.ticketNumber} y todos sus pedidos.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDeleteDialogVisible(false)}>Cancelar</Button>
            <Button
              mode="contained"
              buttonColor="#E53935"
              onPress={() => { setDeleteDialogVisible(false); onDeleteTicket(); }}
            >
              Eliminar
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

    </View>
  );
}

// ---------------------------------------------------------------------------
// EditModeScreen
// ---------------------------------------------------------------------------

interface EditModeProps {
  ticket: import('../../lib/types').Ticket;
  editOrders: Order[];
  products: Product[];
  modifierLabels: Record<string, string>;
  saving: boolean;
  addingToOrderId: string | null;
  sheetProduct: Product | null;
  renameOrder: Order | null;
  renameText: string;
  onRenameTextChange: (t: string) => void;
  onRenameConfirm: () => void;
  onRenameDismiss: () => void;
  onItemIncrement: (orderId: string, itemId: string) => void;
  onItemDecrement: (orderId: string, itemId: string) => void;
  onItemRemove: (orderId: string, itemId: string) => void;
  onAddComensal: () => void;
  onRemoveComensal: (orderId: string) => void;
  onRenameOrder: (order: Order) => void;
  onOpenProductGrid: (orderId: string) => void;
  onCloseProductGrid: () => void;
  onProductSelected: (product: Product) => void;
  onProductLongPress: (product: Product) => void;
  onModifierConfirm: (mods: string[]) => void;
  onModifierDismiss: () => void;
  onCancel: () => void;
  onSave: () => void;
}

function EditModeScreen({
  ticket, editOrders, products, modifierLabels, saving,
  addingToOrderId, sheetProduct,
  renameOrder, renameText, onRenameTextChange, onRenameConfirm, onRenameDismiss,
  onItemIncrement, onItemDecrement, onItemRemove,
  onAddComensal, onRemoveComensal, onRenameOrder,
  onOpenProductGrid, onCloseProductGrid, onProductSelected, onProductLongPress,
  onModifierConfirm, onModifierDismiss,
  onCancel, onSave,
}: EditModeProps): React.JSX.Element {
  const editTotal = editOrders.reduce((s, o) => s + o.total, 0);

  return (
    <View style={styles.root}>
      {/* Edit mode banner */}
      <Banner visible icon="pencil" style={styles.editBanner}>
        <Text style={styles.editBannerText}>MODO EDICIÓN — Comanda #{ticket.ticketNumber}</Text>
      </Banner>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {editOrders.map((order, idx) => (
          <Surface key={order.id} style={styles.editOrderCard} elevation={1}>
            {/* Order header */}
            <View style={styles.editOrderHeader}>
              <View style={styles.editOrderHeaderLeft}>
                <Text style={styles.editComensalLabel}>Comensal {idx + 1}</Text>
                <Text style={styles.editClientName}>{order.clientName || '(sin nombre)'}</Text>
              </View>
              <View style={styles.editOrderHeaderActions}>
                <Button compact mode="text" icon="account-edit" onPress={() => onRenameOrder(order)} textColor="#1E88E5">
                  Nombre
                </Button>
                <Button compact mode="text" icon="account-remove" onPress={() => onRemoveComensal(order.id)} textColor="#E53935">
                  Quitar
                </Button>
              </View>
            </View>

            <Divider />

            {/* Items */}
            {order.items.length === 0 ? (
              <Text style={styles.emptyOrderText}>Sin productos</Text>
            ) : (
              order.items.map((item) => (
                <EditableItemRow
                  key={item.id}
                  item={item}
                  modifierLabels={modifierLabels}
                  onIncrement={() => onItemIncrement(order.id, item.id)}
                  onDecrement={() => onItemDecrement(order.id, item.id)}
                  onRemove={() => onItemRemove(order.id, item.id)}
                />
              ))
            )}

            {/* Add product button */}
            <Button
              mode="text"
              icon="plus"
              onPress={() => onOpenProductGrid(order.id)}
              style={styles.addProductBtn}
              contentStyle={styles.addProductBtnContent}
              textColor="#1E88E5"
            >
              Añadir producto
            </Button>
          </Surface>
        ))}

        {/* Add comensal */}
        <Button
          mode="outlined"
          icon="account-plus"
          onPress={onAddComensal}
          style={styles.addComensalBtn}
          contentStyle={styles.addComensalBtnContent}
        >
          + Añadir comensal
        </Button>

        {/* Edit total */}
        <View style={styles.grandTotalRow}>
          <Text style={styles.grandTotalLabel}>TOTAL</Text>
          <Text style={styles.grandTotalValue}>{formatPrice(editTotal)}</Text>
        </View>
      </ScrollView>

      {/* Bottom action bar */}
      <Surface style={styles.editActions} elevation={5}>
        <Divider />
        <View style={styles.editActionsInner}>
          <Button
            mode="outlined"
            onPress={onCancel}
            style={styles.editActionBtn}
            contentStyle={styles.editActionBtnContent}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button
            mode="contained"
            icon="content-save"
            onPress={onSave}
            style={styles.editActionBtn}
            contentStyle={styles.editActionBtnContent}
            labelStyle={styles.editActionBtnLabel}
            loading={saving}
            disabled={saving}
            buttonColor="#43A047"
          >
            Guardar cambios
          </Button>
        </View>
      </Surface>

      {/* Product grid modal */}
      <Modal
        visible={addingToOrderId !== null}
        animationType="slide"
        onRequestClose={onCloseProductGrid}
      >
        <TouchableWithoutFeedback onPress={onCloseProductGrid}>
          <View style={styles.gridBackdrop} />
        </TouchableWithoutFeedback>
        <Surface style={styles.gridSheet} elevation={4}>
          <View style={styles.gridHandle} />
          <Text style={styles.gridTitle}>Añadir producto</Text>
          <ProductGrid
            products={products}
            onSelect={onProductSelected}
            onLongPress={onProductLongPress}
          />
        </Surface>
      </Modal>

      {/* Modifier sheet */}
      <ModifierSheet
        product={sheetProduct}
        visible={sheetProduct !== null}
        onConfirm={onModifierConfirm}
        onDismiss={onModifierDismiss}
      />

      {/* Rename dialog */}
      <Portal>
        <Dialog visible={renameOrder !== null} onDismiss={onRenameDismiss}>
          <Dialog.Title>Nombre del comensal</Dialog.Title>
          <Dialog.Content>
            <TextInput
              value={renameText}
              onChangeText={onRenameTextChange}
              mode="outlined"
              autoCapitalize="words"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={onRenameConfirm}
              style={styles.renameInput}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={onRenameDismiss}>Cancelar</Button>
            <Button mode="contained" onPress={onRenameConfirm} buttonColor="#1E88E5">Guardar</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function recalcTotal(order: Pick<Order, 'items'>): number {
  const sum = order.items.reduce(
    (acc, i) => acc + (i.unitPrice + i.modifierPriceAdd) * i.qty,
    0,
  );
  return Math.round(sum * 100) / 100;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f5f5' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  noSessionText: { fontSize: 16, textAlign: 'center', color: '#555', lineHeight: 24 },
  goSessionBtn: { marginTop: 8 },

  // test banner
  testBanner: { backgroundColor: '#FF6F00' },
  testBannerText: { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: 0.5 },

  // edit mode banner
  editBanner: { backgroundColor: '#E3F2FD' },
  editBannerText: { color: '#1565C0', fontWeight: '800', fontSize: 14, letterSpacing: 0.4 },

  // new-ticket ticket header
  ticketHeader: { backgroundColor: '#E3F2FD', paddingVertical: 8, paddingHorizontal: 16 },
  ticketHeaderText: { fontSize: 14, color: '#1565C0', fontWeight: '600' },

  // view mode header
  viewHeader: {
    backgroundColor: '#fff',
    padding: 16,
    marginBottom: 12,
    borderRadius: 10,
    gap: 8,
  },
  viewHeaderActions: { flexDirection: 'row', gap: 8 },
  viewTicketNum: { fontSize: 20, fontWeight: '800', color: '#111' },
  editBtn: { borderRadius: 8, flex: 1 },
  editBtnContent: { height: 40 },
  editedBadge: {
    backgroundColor: '#FFF8E1',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  editedBadgeText: { fontSize: 12, fontWeight: '700', color: '#F57F17' },

  // order cards (view mode)
  orderCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    marginBottom: 12,
    overflow: 'hidden',
  },
  orderClientName: { fontSize: 16, fontWeight: '800', color: '#111', padding: 14, paddingBottom: 10 },
  orderTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
    paddingTop: 8,
  },
  orderTotalLabel: { fontSize: 12, color: '#888', fontWeight: '600' },
  orderTotalValue: { fontSize: 15, fontWeight: '700', color: '#333' },

  // edit mode order cards
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
  editOrderHeaderLeft: { gap: 2 },
  editOrderHeaderActions: { flexDirection: 'row', gap: 0 },
  editComensalLabel: { fontSize: 11, color: '#888', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  editClientName: { fontSize: 16, fontWeight: '800', color: '#111' },
  emptyOrderText: { fontSize: 13, color: '#bbb', fontStyle: 'italic', padding: 14, paddingVertical: 10 },
  addProductBtn: { margin: 4 },
  addProductBtnContent: { height: 40 },

  addComensalBtn: { borderRadius: 10, marginBottom: 16 },
  addComensalBtnContent: { height: 52 },

  // edit action bar
  editActions: { backgroundColor: '#fff' },
  editActionsInner: { flexDirection: 'row', padding: 12, gap: 10 },
  editActionBtn: { flex: 1, borderRadius: 10 },
  editActionBtnContent: { height: 52 },
  editActionBtnLabel: { fontSize: 15, fontWeight: '800' },

  // product grid sheet (modal)
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

  // rename dialog
  renameInput: { backgroundColor: '#fff' },

  // scroll
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 24 },

  // grand total
  grandTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: 12 },
  grandTotalLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 1, color: '#888' },
  grandTotalValue: { fontSize: 32, fontWeight: '800', color: '#1a1a1a' },

  // new ticket
  clientRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: 12 },
  clientLabel: { fontSize: 13, color: '#888', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  clientName: { fontSize: 20, fontWeight: '800', color: '#1a1a1a' },
  emptyText: { textAlign: 'center', color: '#bbb', fontStyle: 'italic', paddingVertical: 24, fontSize: 15 },
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
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 8 },
  qtyValue: { fontSize: 40, fontWeight: '800', color: '#1a1a1a', minWidth: 48, textAlign: 'center' },
});

const itemStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e0e0e0', gap: 8,
  },
  left: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 4 },
  name: { fontSize: 17, fontWeight: '700', color: '#1a1a1a', flexShrink: 1 },
  mod: { fontSize: 15, color: '#E65100', paddingLeft: 4, lineHeight: 22 },
  qty: { fontSize: 15, color: '#888', fontWeight: '600', minWidth: 24 },
  price: { fontSize: 17, fontWeight: '700', color: '#1a1a1a', marginTop: 2 },
});
