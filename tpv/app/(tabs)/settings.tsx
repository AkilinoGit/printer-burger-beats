import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
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
  Surface,
  Text,
  TextInput,
} from 'react-native-paper';

import { useSessionStore } from '../../stores/useSessionStore';
import {
  getLocations,
  getPendingSyncEntries,
  insertLocation,
  updateLocation,
  updateProductBasePrice,
} from '../../services/db';
import { DEFAULT_FERIANTE_PRICES } from '../../lib/constants';
import type { Location } from '../../lib/types';

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function SettingsScreen(): React.JSX.Element {
  const products          = useSessionStore((s) => s.products);
  const loadProducts      = useSessionStore((s) => s.loadProducts);
  const feriantePrices    = useSessionStore((s) => s.feriantePrices);
  const setFeriantePrices = useSessionStore((s) => s.setFeriantePrices);

  // ── local state ───────────────────────────────────────────────────────────
  const [locations, setLocations]           = useState<Location[]>([]);
  const [pendingCount, setPendingCount]     = useState(0);
  const [syncing, setSyncing]               = useState(false);
  const [loadingData, setLoadingData]       = useState(true);

  // Base prices dialog
  const [basePricesVisible, setBasePricesVisible] = useState(false);
  const [baseDraft, setBaseDraft]                 = useState<Record<string, string>>({});
  const [savingBase, setSavingBase]               = useState(false);

  // Feriante prices dialog
  const ferianteProductIds = Object.keys(DEFAULT_FERIANTE_PRICES);
  const [ferianteVisible, setFerianteVisible] = useState(false);
  const [ferianteDraft, setFerianteDraft]     = useState<Record<string, string>>({});
  const [savingFeriante, setSavingFeriante]   = useState(false);

  // Location management
  const [locationDialogVisible, setLocationDialogVisible] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [locationName, setLocationName]       = useState('');
  const [locationNameError, setLocationNameError] = useState('');
  const [savingLocation, setSavingLocation]   = useState(false);

  // ── load ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoadingData(true);
    try {
      const [locs, pending] = await Promise.all([
        getLocations(),
        getPendingSyncEntries(),
      ]);
      setLocations(locs);
      setPendingCount(pending.length);
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // ── sync ──────────────────────────────────────────────────────────────────
  async function handleSync(): Promise<void> {
    setSyncing(true);
    try {
      const pending = await getPendingSyncEntries();
      setPendingCount(pending.length);
      Alert.alert(
        'Sin API configurada',
        pending.length === 0
          ? 'No hay pedidos pendientes de sincronizar.'
          : `${pending.length} ${pending.length === 1 ? 'pedido pendiente' : 'pedidos pendientes'} en cola. Se sincronizarán cuando la API esté disponible.`,
        [{ text: 'OK' }],
      );
    } finally {
      setSyncing(false);
    }
  }

  // ── base prices ───────────────────────────────────────────────────────────
  function openBasePrices(): void {
    const draft: Record<string, string> = {};
    for (const p of products.filter((pr) => pr.isActive && !pr.isCustom)) {
      draft[p.id] = String(p.basePrice);
    }
    setBaseDraft(draft);
    setBasePricesVisible(true);
  }

  async function handleSaveBasePrices(): Promise<void> {
    const editableProducts = products.filter((p) => p.isActive && !p.isCustom);
    for (const p of editableProducts) {
      const val = parseFloat(baseDraft[p.id]?.replace(',', '.') ?? '');
      if (isNaN(val) || val < 0) {
        Alert.alert('Precio inválido', `El precio de "${p.name}" no es válido.`);
        return;
      }
    }
    setSavingBase(true);
    try {
      for (const p of editableProducts) {
        const val = parseFloat(baseDraft[p.id].replace(',', '.'));
        if (val !== p.basePrice) {
          await updateProductBasePrice(p.id, val);
        }
      }
      // Reload from SQLite so store reflects persisted prices
      await loadProducts();
      setBasePricesVisible(false);
    } finally {
      setSavingBase(false);
    }
  }

  // ── feriante prices ───────────────────────────────────────────────────────
  function openFeriantePrices(): void {
    const draft: Record<string, string> = {};
    for (const id of ferianteProductIds) {
      draft[id] = String(feriantePrices[id] ?? DEFAULT_FERIANTE_PRICES[id]);
    }
    setFerianteDraft(draft);
    setFerianteVisible(true);
  }

  async function handleSaveFeriantePrices(): Promise<void> {
    const parsed: Record<string, number> = {};
    for (const id of ferianteProductIds) {
      const val = parseFloat(ferianteDraft[id]?.replace(',', '.') ?? '');
      if (isNaN(val) || val < 0) {
        Alert.alert('Precio inválido', `El precio de "${ferianteDraft[id]}" no es válido.`);
        return;
      }
      parsed[id] = val;
    }
    setSavingFeriante(true);
    try {
      await setFeriantePrices(parsed);
      setFerianteVisible(false);
    } finally {
      setSavingFeriante(false);
    }
  }

  // ── location management ───────────────────────────────────────────────────
  function openAddLocation(): void {
    setEditingLocation(null);
    setLocationName('');
    setLocationNameError('');
    setLocationDialogVisible(true);
  }

  function openEditLocation(loc: Location): void {
    setEditingLocation(loc);
    setLocationName(loc.name);
    setLocationNameError('');
    setLocationDialogVisible(true);
  }

  async function handleSaveLocation(): Promise<void> {
    const name = locationName.trim();
    if (!name) {
      setLocationNameError('El nombre no puede estar vacío.');
      return;
    }
    setSavingLocation(true);
    try {
      if (editingLocation) {
        await updateLocation(editingLocation.id, name);
      } else {
        await insertLocation(name, locations.length === 0);
      }
      const updated = await getLocations();
      setLocations(updated);
      setLocationDialogVisible(false);
    } finally {
      setSavingLocation(false);
    }
  }

  function handleSetDefault(_loc: Location): void {
    Alert.alert(
      'No disponible',
      'El cambio de local por defecto se implementará junto con la API. Próximamente.',
    );
  }

  // ── render ────────────────────────────────────────────────────────────────
  if (loadingData) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const editableProducts = products.filter((p) => p.isActive && !p.isCustom);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scrollContent}>

      {/* ── PRECIOS ───────────────────────────────────────────────────────── */}
      <Text variant="labelLarge" style={styles.sectionLabel}>PRECIOS</Text>
      <Surface style={styles.card} elevation={1}>
        <View style={styles.priceActionRow}>
          <View style={styles.priceActionText}>
            <Text style={styles.priceActionTitle}>Precios por defecto</Text>
            <Text style={styles.priceActionSubtitle}>Precio base de cada producto</Text>
          </View>
          <Button
            mode="outlined"
            icon="pencil"
            onPress={openBasePrices}
            style={styles.priceActionBtn}
          >
            Editar
          </Button>
        </View>
        <Divider />
        <View style={styles.priceActionRow}>
          <View style={styles.priceActionText}>
            <Text style={styles.priceActionTitle}>Oferta feriante</Text>
            <Text style={styles.priceActionSubtitle}>Precios con descuento de feria</Text>
          </View>
          <Button
            mode="outlined"
            icon="pencil"
            onPress={openFeriantePrices}
            style={styles.priceActionBtn}
          >
            Editar
          </Button>
        </View>
      </Surface>

      {/* ── SYNC ──────────────────────────────────────────────────────────── */}
      <Text variant="labelLarge" style={styles.sectionLabel}>SINCRONIZACIÓN</Text>
      <Surface style={styles.card} elevation={1}>
        <View style={styles.syncRow}>
          <View>
            <Text style={styles.syncTitle}>Cola de sincronización</Text>
            <Text style={styles.syncSubtitle}>
              {pendingCount === 0
                ? 'No hay pedidos pendientes.'
                : `${pendingCount} ${pendingCount === 1 ? 'pedido pendiente' : 'pedidos pendientes'} en cola`}
            </Text>
          </View>
          <View style={[
            styles.syncBadge,
            pendingCount > 0 ? styles.syncBadgePending : styles.syncBadgeOk,
          ]}>
            <Text style={styles.syncBadgeText}>{pendingCount}</Text>
          </View>
        </View>
        <Divider style={styles.cardDivider} />
        <Button
          mode="contained"
          icon="cloud-sync"
          onPress={() => void handleSync()}
          loading={syncing}
          disabled={syncing}
          buttonColor="#546E7A"
          style={styles.syncBtn}
        >
          Sincronizar ahora
        </Button>
        <Text style={styles.syncHint}>
          API no configurada. Los datos se sincronizarán automáticamente cuando esté disponible.
        </Text>
      </Surface>

      {/* ── LOCATIONS ─────────────────────────────────────────────────────── */}
      <Text variant="labelLarge" style={styles.sectionLabel}>LOCALES</Text>
      <Surface style={styles.card} elevation={1}>
        {locations.map((loc, idx) => (
          <React.Fragment key={loc.id}>
            {idx > 0 && <Divider />}
            <View style={styles.locationRow}>
              <View style={styles.locationRowLeft}>
                <Text style={styles.locationName}>{loc.name}</Text>
                {loc.isDefault && (
                  <Text style={styles.locationDefault}>Por defecto</Text>
                )}
              </View>
              <View style={styles.locationRowActions}>
                {!loc.isDefault && (
                  <Button
                    compact
                    mode="text"
                    onPress={() => void handleSetDefault(loc)}
                    textColor="#777"
                  >
                    Predeterminar
                  </Button>
                )}
                <Button
                  compact
                  mode="text"
                  icon="pencil"
                  onPress={() => openEditLocation(loc)}
                  textColor="#1565C0"
                >
                  Editar
                </Button>
              </View>
            </View>
          </React.Fragment>
        ))}
        {locations.length > 0 && <Divider />}
        <Button
          mode="text"
          icon="plus"
          onPress={openAddLocation}
          style={styles.addLocationBtn}
          textColor="#43A047"
        >
          Añadir local
        </Button>
      </Surface>

      {/* ── DIALOGS ───────────────────────────────────────────────────────── */}
      <Portal>

        {/* Base prices dialog */}
        <Dialog visible={basePricesVisible} onDismiss={() => setBasePricesVisible(false)}>
          <Dialog.Title>Precios por defecto</Dialog.Title>
          <Dialog.ScrollArea style={styles.dialogScroll}>
            <ScrollView>
              {editableProducts.map((p, idx) => (
                <React.Fragment key={p.id}>
                  {idx > 0 && <Divider />}
                  <View style={styles.priceRow}>
                    <Text style={styles.priceName}>{p.name}</Text>
                    <TextInput
                      value={baseDraft[p.id] ?? ''}
                      onChangeText={(v) => setBaseDraft((prev) => ({ ...prev, [p.id]: v }))}
                      mode="outlined"
                      keyboardType="decimal-pad"
                      style={styles.priceInput}
                      right={<TextInput.Affix text="€" />}
                    />
                  </View>
                </React.Fragment>
              ))}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setBasePricesVisible(false)}>Cancelar</Button>
            <Button
              mode="contained"
              buttonColor="#43A047"
              onPress={() => void handleSaveBasePrices()}
              loading={savingBase}
              disabled={savingBase}
            >
              Guardar
            </Button>
          </Dialog.Actions>
        </Dialog>

        {/* Feriante prices dialog */}
        <Dialog visible={ferianteVisible} onDismiss={() => setFerianteVisible(false)}>
          <Dialog.Title>Oferta feriante</Dialog.Title>
          <Dialog.ScrollArea style={styles.dialogScroll}>
            <ScrollView>
              {ferianteProductIds.map((id, idx) => {
                const product = products.find((p) => p.id === id);
                const name = product?.name ?? id;
                return (
                  <React.Fragment key={id}>
                    {idx > 0 && <Divider />}
                    <View style={styles.priceRow}>
                      <Text style={styles.priceName}>{name}</Text>
                      <TextInput
                        value={ferianteDraft[id] ?? ''}
                        onChangeText={(v) => setFerianteDraft((prev) => ({ ...prev, [id]: v }))}
                        mode="outlined"
                        keyboardType="decimal-pad"
                        style={styles.priceInput}
                        right={<TextInput.Affix text="€" />}
                      />
                    </View>
                  </React.Fragment>
                );
              })}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setFerianteVisible(false)}>Cancelar</Button>
            <Button
              mode="contained"
              buttonColor="#1E88E5"
              onPress={() => void handleSaveFeriantePrices()}
              loading={savingFeriante}
              disabled={savingFeriante}
            >
              Guardar
            </Button>
          </Dialog.Actions>
        </Dialog>

        {/* Add / edit location */}
        <Dialog visible={locationDialogVisible} onDismiss={() => setLocationDialogVisible(false)}>
          <Dialog.Title>
            {editingLocation ? 'Editar local' : 'Nuevo local'}
          </Dialog.Title>
          <Dialog.Content>
            <TextInput
              label="Nombre del local"
              value={locationName}
              onChangeText={(v) => {
                setLocationName(v);
                setLocationNameError('');
              }}
              mode="outlined"
              autoFocus
              autoCapitalize="sentences"
              returnKeyType="done"
              onSubmitEditing={() => void handleSaveLocation()}
              error={!!locationNameError}
              style={styles.locationInput}
            />
            {!!locationNameError && (
              <Text style={styles.locationInputError}>{locationNameError}</Text>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setLocationDialogVisible(false)}>Cancelar</Button>
            <Button
              mode="contained"
              onPress={() => void handleSaveLocation()}
              loading={savingLocation}
              disabled={savingLocation || !locationName.trim()}
              buttonColor="#43A047"
            >
              Guardar
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
  scrollContent: { padding: 16, paddingBottom: 48, gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 6,
    marginLeft: 4,
  },

  card: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  cardDivider: {
    marginHorizontal: 0,
  },

  // ── prices section ──
  priceActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  priceActionText: { flex: 1, gap: 3 },
  priceActionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111',
  },
  priceActionSubtitle: {
    fontSize: 13,
    color: '#666',
  },
  priceActionBtn: {
    borderRadius: 8,
    flexShrink: 0,
  },

  // ── price dialog rows ──
  dialogScroll: {
    maxHeight: 400,
    paddingHorizontal: 0,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    gap: 12,
  },
  priceName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#111',
  },
  priceInput: {
    width: 110,
    backgroundColor: '#fff',
  },

  // ── sync ──
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  syncTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111',
  },
  syncSubtitle: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  syncBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  syncBadgeOk: { backgroundColor: '#E8F5E9' },
  syncBadgePending: { backgroundColor: '#FFF3E0' },
  syncBadgeText: {
    fontWeight: '800',
    fontSize: 15,
    color: '#555',
  },
  syncBtn: {
    borderRadius: 8,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  syncHint: {
    fontSize: 12,
    color: '#999',
    paddingHorizontal: 16,
    paddingBottom: 14,
    lineHeight: 17,
  },

  // ── locations ──
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 8,
  },
  locationRowLeft: { flex: 1, gap: 2 },
  locationName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111',
  },
  locationDefault: {
    fontSize: 12,
    color: '#43A047',
    fontWeight: '600',
  },
  locationRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  addLocationBtn: {
    margin: 4,
  },

  // ── location dialog ──
  locationInput: { backgroundColor: '#fff' },
  locationInputError: {
    color: '#E53935',
    fontSize: 12,
    marginTop: 4,
  },
});
