import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  ActivityIndicator,
  Button,
  Dialog,
  Divider,
  Portal,
  SegmentedButtons,
  Surface,
  Text,
  TextInput,
} from 'react-native-paper';

import { useSessionStore } from '../../stores/useSessionStore';
import {
  closeSession,
  getLocations,
  getOpenSession,
  getProducts,
  insertSession,
  updateSessionPriceOverrides,
} from '../../services/db';
import { formatPrice } from '../../lib/utils';
import type { Location, Product } from '../../lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePrice(raw: string): number | null {
  const n = parseFloat(raw.replace(',', '.'));
  return isNaN(n) || n < 0 ? null : Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Price-override row component
// ---------------------------------------------------------------------------

interface PriceRowProps {
  product: Product;
  effectivePrice: number;
  hasOverride: boolean;
  onEdit: (product: Product) => void;
  onReset: (productId: string) => void;
}

function PriceRow({ product, effectivePrice, hasOverride, onEdit, onReset }: PriceRowProps): React.JSX.Element {
  return (
    <View style={styles.priceRow}>
      <View style={styles.priceRowLeft}>
        <Text style={styles.priceRowName} numberOfLines={1}>
          {product.name}
        </Text>
        {hasOverride && (
          <Text style={styles.priceRowBase}>base {formatPrice(product.basePrice)}</Text>
        )}
      </View>
      <View style={styles.priceRowRight}>
        <Text style={[styles.priceRowPrice, hasOverride && styles.priceRowPriceOverride]}>
          {formatPrice(effectivePrice)}
        </Text>
        <Button
          compact
          mode="text"
          icon={hasOverride ? 'restore' : 'pencil'}
          onPress={() => hasOverride ? onReset(product.id) : onEdit(product)}
          textColor={hasOverride ? '#E53935' : '#1565C0'}
        >
          {hasOverride ? 'Restablecer' : 'Cambiar'}
        </Button>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function SessionScreen(): React.JSX.Element {
  const {
    activeLocation,
    activeSession,
    products,
    setActiveLocation,
    setActiveSession,
    setProducts,
    setPriceOverride,
    getEffectivePrice,
  } = useSessionStore();

  // ── local state ───────────────────────────────────────────────────────────
  const [locations, setLocations]       = useState<Location[]>([]);
  const [loading, setLoading]           = useState(true);
  const [savingOverride, setSavingOverride] = useState(false);
  const [closingSession, setClosingSession] = useState(false);

  // Location selector (shown when no open session)
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');

  // Price-edit dialog
  const [editProduct, setEditProduct]   = useState<Product | null>(null);
  const [editPrice, setEditPrice]       = useState('');
  const [editPriceError, setEditPriceError] = useState('');

  // Close-session confirmation dialog
  const [closeDialogVisible, setCloseDialogVisible] = useState(false);

  // ── load data ─────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [locs, prods] = await Promise.all([getLocations(), getProducts()]);
      setLocations(locs);
      setProducts(prods);

      // If we already have an active location, check for an open session
      const loc = activeLocation ?? locs.find((l) => l.isDefault) ?? locs[0] ?? null;
      if (loc && !activeLocation) setActiveLocation(loc);

      if (loc && !activeSession) {
        const openSession = await getOpenSession(loc.id);
        if (openSession) setActiveSession(openSession);
      }

      setSelectedLocationId(
        activeSession?.locationId ?? loc?.id ?? locs[0]?.id ?? '',
      );
    } finally {
      setLoading(false);
    }
  }, [activeLocation, activeSession, setActiveLocation, setActiveSession, setProducts]);

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── open session ──────────────────────────────────────────────────────────
  async function handleOpenSession(): Promise<void> {
    const loc = locations.find((l) => l.id === selectedLocationId);
    if (!loc) return;

    // Check for existing open session for this location
    const existing = await getOpenSession(loc.id);
    if (existing) {
      setActiveSession(existing);
      setActiveLocation(loc);
      return;
    }

    const session = await insertSession(loc.id);
    setActiveSession(session);
    setActiveLocation(loc);
  }

  // ── close session ─────────────────────────────────────────────────────────
  async function handleCloseSession(): Promise<void> {
    if (!activeSession) return;
    setClosingSession(true);
    try {
      await closeSession(activeSession.id);
      useSessionStore.setState({ activeSession: null });
    } finally {
      setClosingSession(false);
      setCloseDialogVisible(false);
    }
  }

  // ── price override ────────────────────────────────────────────────────────
  function handleEditPrice(product: Product): void {
    const current = getEffectivePrice(product.id, product.basePrice);
    setEditProduct(product);
    setEditPrice(String(current).replace('.', ','));
    setEditPriceError('');
  }

  async function handleSavePrice(): Promise<void> {
    if (!editProduct || !activeSession) return;
    const price = parsePrice(editPrice);
    if (price === null) {
      setEditPriceError('Introduce un precio válido (ej: 12,50)');
      return;
    }
    setSavingOverride(true);
    try {
      setPriceOverride(editProduct.id, price);
      const updated = {
        ...activeSession.priceOverrides,
        [editProduct.id]: price,
      };
      await updateSessionPriceOverrides(activeSession.id, updated);
      setEditProduct(null);
    } finally {
      setSavingOverride(false);
    }
  }

  async function handleResetPrice(productId: string): Promise<void> {
    if (!activeSession) return;
    const updated = { ...activeSession.priceOverrides };
    delete updated[productId];
    await updateSessionPriceOverrides(activeSession.id, updated);
    useSessionStore.setState({
      activeSession: { ...activeSession, priceOverrides: updated },
    });
  }

  // ── grouped products ──────────────────────────────────────────────────────
  const categoryOrder: Array<Product['category']> = ['burger', 'side', 'drink', 'custom'];
  const categoryLabel: Record<Product['category'], string> = {
    burger: 'Hamburguesas',
    side:   'Acompañamientos',
    drink:  'Bebidas',
    custom: 'Otros',
  };

  const productsByCategory = categoryOrder.reduce<Record<string, Product[]>>(
    (acc, cat) => {
      const list = products.filter((p) => p.category === cat);
      if (list.length > 0) acc[cat] = list;
      return acc;
    },
    {},
  );

  // ── render: loading ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // ── render: no session open ───────────────────────────────────────────────
  if (!activeSession || activeSession.status !== 'open') {
    return (
      <ScrollView contentContainerStyle={styles.noSessionRoot}>
        <Text variant="headlineSmall" style={styles.sectionTitle}>
          Abrir sesión del día
        </Text>

        {locations.length > 1 && (
          <Surface style={styles.locationCard} elevation={1}>
            <Text variant="labelLarge" style={styles.locationLabel}>
              Selecciona el local
            </Text>
            <SegmentedButtons
              value={selectedLocationId}
              onValueChange={setSelectedLocationId}
              buttons={locations.map((l) => ({ value: l.id, label: l.name }))}
              style={styles.segmented}
            />
          </Surface>
        )}

        {locations.length === 1 && (
          <Surface style={styles.locationCard} elevation={1}>
            <Text variant="labelLarge" style={styles.locationLabel}>
              Local
            </Text>
            <Text variant="bodyLarge">{locations[0].name}</Text>
          </Surface>
        )}

        <Button
          mode="contained"
          icon="play-circle"
          onPress={() => void handleOpenSession()}
          style={styles.openBtn}
          contentStyle={styles.openBtnContent}
          buttonColor="#43A047"
          disabled={!selectedLocationId}
        >
          Abrir sesión
        </Button>
      </ScrollView>
    );
  }

  // ── render: session open ──────────────────────────────────────────────────
  const locationName = locations.find((l) => l.id === activeSession.locationId)?.name ?? '';
  const overrideCount = Object.keys(activeSession.priceOverrides).length;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scrollContent}>
      {/* Session header */}
      <Surface style={styles.sessionHeader} elevation={2}>
        <View style={styles.sessionHeaderRow}>
          <View>
            <Text variant="labelMedium" style={styles.sessionMeta}>SESIÓN ABIERTA</Text>
            <Text variant="titleLarge" style={styles.sessionLocation}>{locationName}</Text>
            <Text variant="bodySmall" style={styles.sessionDate}>{activeSession.date}</Text>
          </View>
          <Button
            mode="outlined"
            icon="stop-circle"
            onPress={() => setCloseDialogVisible(true)}
            textColor="#E53935"
            style={styles.closeBtn}
          >
            Cerrar sesión
          </Button>
        </View>
        {overrideCount > 0 && (
          <Text style={styles.overrideBadge}>
            {overrideCount} {overrideCount === 1 ? 'precio modificado' : 'precios modificados'}
          </Text>
        )}
      </Surface>

      {/* Price list by category */}
      <Text variant="titleMedium" style={styles.sectionTitle}>
        Precios de la sesión
      </Text>
      <Text variant="bodySmall" style={styles.sectionHint}>
        Toca "Cambiar" para aplicar un precio especial para hoy. El resto hereda el precio base.
      </Text>

      {Object.entries(productsByCategory).map(([cat, prods]) => (
        <Surface key={cat} style={styles.categoryCard} elevation={1}>
          <Text style={styles.categoryHeading}>
            {categoryLabel[cat as Product['category']]}
          </Text>
          <Divider />
          {prods.map((product, idx) => {
            const effective = getEffectivePrice(product.id, product.basePrice);
            const hasOverride = (activeSession.priceOverrides[product.id] ?? null) !== null;
            return (
              <React.Fragment key={product.id}>
                {idx > 0 && <Divider />}
                <PriceRow
                  product={product}
                  effectivePrice={effective}
                  hasOverride={hasOverride}
                  onEdit={handleEditPrice}
                  onReset={(id) => void handleResetPrice(id)}
                />
              </React.Fragment>
            );
          })}
        </Surface>
      ))}

      {/* ── Dialogs ─────────────────────────────────────────────────────────── */}
      <Portal>
        {/* Price edit */}
        <Dialog visible={editProduct !== null} onDismiss={() => setEditProduct(null)}>
          <Dialog.Title>Precio para hoy</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={styles.editDialogProduct}>
              {editProduct?.name}
            </Text>
            <TextInput
              label="Precio (€)"
              value={editPrice}
              onChangeText={(v) => {
                setEditPrice(v);
                setEditPriceError('');
              }}
              mode="outlined"
              keyboardType="decimal-pad"
              returnKeyType="done"
              onSubmitEditing={() => void handleSavePrice()}
              error={!!editPriceError}
              autoFocus
              style={styles.editInput}
            />
            {!!editPriceError && (
              <Text style={styles.editError}>{editPriceError}</Text>
            )}
            <Text variant="bodySmall" style={styles.editHint}>
              Precio base: {editProduct ? formatPrice(editProduct.basePrice) : ''}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setEditProduct(null)}>Cancelar</Button>
            <Button
              mode="contained"
              onPress={() => void handleSavePrice()}
              loading={savingOverride}
              disabled={savingOverride}
              buttonColor="#1565C0"
            >
              Guardar
            </Button>
          </Dialog.Actions>
        </Dialog>

        {/* Close session confirmation */}
        <Dialog visible={closeDialogVisible} onDismiss={() => setCloseDialogVisible(false)}>
          <Dialog.Title>¿Cerrar sesión?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              Se cerrará la jornada de hoy en {locationName}.
              Los tickets ya generados se conservan.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setCloseDialogVisible(false)}>Cancelar</Button>
            <Button
              mode="contained"
              onPress={() => void handleCloseSession()}
              loading={closingSession}
              disabled={closingSession}
              buttonColor="#E53935"
            >
              Cerrar sesión
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f5f5' },
  scrollContent: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // ── no-session layout ──
  noSessionRoot: {
    padding: 24,
    gap: 20,
    flexGrow: 1,
    justifyContent: 'center',
  },

  // ── location picker ──
  locationCard: {
    borderRadius: 12,
    padding: 16,
    gap: 12,
    backgroundColor: '#fff',
  },
  locationLabel: {
    color: '#555',
  },
  segmented: {
    flexWrap: 'wrap',
  },

  // ── open button ──
  openBtn: {
    borderRadius: 10,
    alignSelf: 'stretch',
  },
  openBtnContent: {
    height: 52,
  },

  // ── session header ──
  sessionHeader: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    backgroundColor: '#fff',
    gap: 8,
  },
  sessionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  sessionMeta: {
    color: '#43A047',
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  sessionLocation: {
    fontWeight: '700',
    color: '#111',
  },
  sessionDate: {
    color: '#777',
    marginTop: 2,
  },
  closeBtn: {
    borderColor: '#E53935',
    alignSelf: 'flex-start',
    flexShrink: 1,
  },
  overrideBadge: {
    fontSize: 12,
    color: '#1565C0',
    fontWeight: '600',
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },

  // ── price section ──
  sectionTitle: {
    fontWeight: '700',
    marginBottom: 4,
    color: '#222',
  },
  sectionHint: {
    color: '#777',
    marginBottom: 16,
  },

  // ── category card ──
  categoryCard: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 14,
    backgroundColor: '#fff',
  },
  categoryHeading: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: '#888',
    paddingHorizontal: 14,
    paddingVertical: 8,
    textTransform: 'uppercase',
  },

  // ── price row ──
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  priceRowLeft: {
    flex: 1,
    gap: 2,
  },
  priceRowName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111',
  },
  priceRowBase: {
    fontSize: 12,
    color: '#999',
  },
  priceRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  priceRowPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: '#222',
    minWidth: 64,
    textAlign: 'right',
  },
  priceRowPriceOverride: {
    color: '#1565C0',
  },

  // ── edit dialog ──
  editDialogProduct: {
    fontWeight: '700',
    marginBottom: 12,
  },
  editInput: {
    backgroundColor: '#fff',
  },
  editError: {
    color: '#E53935',
    fontSize: 12,
    marginTop: 4,
  },
  editHint: {
    color: '#888',
    marginTop: 6,
  },
});
