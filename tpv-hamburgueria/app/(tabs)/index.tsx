import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { Banner, Button, Dialog, Divider, IconButton, Portal, Text, TextInput } from 'react-native-paper';
import { useRouter } from 'expo-router';

import CartSummary from '../../components/CartSummary';
import ModifierSheet from '../../components/ModifierSheet';
import ProductGrid from '../../components/ProductGrid';

import type { OrderItem, Product } from '../../lib/types';
import { useCartStore } from '../../stores/useCartStore';
import { useSessionStore } from '../../stores/useSessionStore';
import { useTicketStore } from '../../stores/useTicketStore';
import { buildModifierLabels } from '../../lib/constants';

export default function HomeScreen(): React.JSX.Element {
  const router = useRouter();

  // ── stores ────────────────────────────────────────────────────────────────
  const products   = useSessionStore((s) => s.products);
  const testMode   = useSessionStore((s) => s.testMode);

  const clientName = useCartStore((s) => s.clientName);
  const items      = useCartStore((s) => s.items);
  const total      = useCartStore((s) => s.total());
  const setClientName = useCartStore((s) => s.setClientName);
  const addProduct    = useCartStore((s) => s.addProduct);

  const activeTicket = useTicketStore((s) => s.activeTicket);

  // ── modifier sheet state ───────────────────────────────────────────────────
  const [sheetProduct, setSheetProduct] = useState<Product | null>(null);

  // ── "OTROS" dialog state ──────────────────────────────────────────────────
  const [otrosVisible, setOtrosVisible] = useState(false);
  const [otrosLabel, setOtrosLabel]     = useState('');
  const [otrosPrice, setOtrosPrice]     = useState('');
  const [otrosPriceError, setOtrosPriceError] = useState('');

  // ── handlers ──────────────────────────────────────────────────────────────
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
    if (product.modifiers.length > 0) {
      setSheetProduct(product);
    }
  }

  function handleModifierConfirm(selectedModifiers: string[]): void {
    if (sheetProduct) {
      addProduct(sheetProduct, selectedModifiers);
    }
    setSheetProduct(null);
  }

  function handleOtrosConfirm(): void {
    const label = otrosLabel.trim() || 'OTROS';
    const price = parseFloat(otrosPrice.replace(',', '.'));

    if (isNaN(price) || price <= 0) {
      setOtrosPriceError('Introduce un precio válido');
      return;
    }

    // Find the OTROS product template
    const otrosProduct = products.find((p) => p.isCustom);
    if (!otrosProduct) return;

    // Build a synthetic product with the custom price for addProduct to snapshot
    const synthetic: Product = {
      ...otrosProduct,
      basePrice: price,
    };

    addProduct(synthetic, [], label);
    setOtrosVisible(false);
  }

  function handleViewOrder(): void {
    // If no active ticket yet we'll open one in the ticket screen
    router.push('/ticket/new');
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Test-mode banner */}
      <Banner
        visible={testMode}
        style={styles.testBanner}
        icon="alert"
      >
        <Text style={styles.testBannerText}>
          MODO PRUEBA — nada se guardará
        </Text>
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
          placeholder="COMENSAL"
          right={
            clientName.length > 0
              ? <TextInput.Icon icon="close-circle" onPress={() => setClientName('')} />
              : undefined
          }
        />
      </View>

      {/* Ticket-in-progress indicator */}
      {activeTicket && activeTicket.orders.length > 0 && (
        <View style={styles.ticketBadge}>
          <Text style={styles.ticketBadgeText}>
            Comanda #{activeTicket.ticketNumber} · {activeTicket.orders.length}{' '}
            {activeTicket.orders.length === 1 ? 'pedido' : 'pedidos'}
          </Text>
        </View>
      )}

      {/* Product grid */}
      <View style={styles.gridWrapper}>
        <ProductGrid products={products} onSelect={handleProductPress} onLongPress={handleProductLongPress} />
      </View>

      {/* Cart summary (sticky bottom) */}
      <CartSummary
        items={items}
        total={total}
        onViewOrder={handleViewOrder}
      />

      {/* Modifier bottom sheet */}
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
              onChangeText={(v) => {
                setOtrosPrice(v);
                setOtrosPriceError('');
              }}
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
            <Button
              mode="contained"
              onPress={handleOtrosConfirm}
              disabled={!otrosPrice.trim()}
              buttonColor="#43A047"
            >
              Añadir
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },

  // test mode banner
  testBanner: {
    backgroundColor: '#FF6F00',
  },
  testBannerText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.5,
  },

  // client name
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

  // in-progress ticket badge
  ticketBadge: {
    backgroundColor: '#E3F2FD',
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  ticketBadgeText: {
    fontSize: 13,
    color: '#1565C0',
    fontWeight: '600',
  },

  // grid
  gridWrapper: {
    flex: 1,
  },

  // otros dialog
  otrosContent: {
    gap: 12,
  },
  otrosInput: {
    backgroundColor: '#fff',
  },
  otrosError: {
    color: '#E53935',
    fontSize: 12,
    marginTop: -8,
  },
});
