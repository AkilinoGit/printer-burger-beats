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
} from '../../services/db';
import { DEFAULT_FERIANTE_PRICES } from '../../lib/constants';
import type { Location } from '../../lib/types';

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function SettingsScreen(): React.JSX.Element {
  const products          = useSessionStore((s) => s.products);
  const feriantePrices    = useSessionStore((s) => s.feriantePrices);
  const setFeriantePrices = useSessionStore((s) => s.setFeriantePrices);

  // ── local state ───────────────────────────────────────────────────────────
  const [locations, setLocations]           = useState<Location[]>([]);
  const [pendingCount, setPendingCount]     = useState(0);
  const [syncing, setSyncing]               = useState(false);
  const [loadingData, setLoadingData]       = useState(true);

  // Feriante prices
  const ferianteProductIds = Object.keys(DEFAULT_FERIANTE_PRICES);
  const ferianteProducts   = products.filter((p) => ferianteProductIds.includes(p.id));
  const [ferianteDraft, setFerianteDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(ferianteProductIds.map((id) => [id, String(feriantePrices[id] ?? DEFAULT_FERIANTE_PRICES[id])]))
  );
  const [savingFeriante, setSavingFeriante] = useState(false);

  async function handleSaveFeriantePrices(): Promise<void> {
    const parsed: Record<string, number> = {};
    for (const id of ferianteProductIds) {
      const val = parseFloat(ferianteDraft[id].replace(',', '.'));
      if (isNaN(val) || val < 0) {
        Alert.alert('Precio inválido', `El precio de "${ferianteDraft[id]}" no es válido.`);
        return;
      }
      parsed[id] = val;
    }
    setSavingFeriante(true);
    try {
      await setFeriantePrices(parsed);
    } finally {
      setSavingFeriante(false);
    }
  }

  // Location management
  const [locationDialogVisible, setLocationDialogVisible] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [locationName, setLocationName]     = useState('');
  const [locationNameError, setLocationNameError] = useState('');
  const [savingLocation, setSavingLocation] = useState(false);

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
      // API is not configured yet — just refresh the pending count
      // When the API is ready, call runSync() from services/sync.ts here
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
    // setDefaultLocation is not yet exposed by db.ts — will be added in a future prompt.
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

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scrollContent}>

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

      {/* ── FERIANTE PRICES ──────────────────────────────────────────────── */}
      <Text variant="labelLarge" style={styles.sectionLabel}>PRECIOS FERIANTE</Text>
      <Surface style={styles.card} elevation={1}>
        {ferianteProductIds.map((id, idx) => {
          const product = ferianteProducts.find((p) => p.id === id);
          const name    = product?.name ?? id;
          return (
            <React.Fragment key={id}>
              {idx > 0 && <Divider />}
              <View style={styles.ferianteRow}>
                <Text style={styles.ferianteName}>{name}</Text>
                <TextInput
                  value={ferianteDraft[id]}
                  onChangeText={(v) => setFerianteDraft((prev) => ({ ...prev, [id]: v }))}
                  mode="outlined"
                  keyboardType="decimal-pad"
                  dense
                  style={styles.ferianteInput}
                  right={<TextInput.Affix text="€" />}
                />
              </View>
            </React.Fragment>
          );
        })}
        <Divider />
        <Button
          mode="contained"
          icon="content-save"
          onPress={() => void handleSaveFeriantePrices()}
          loading={savingFeriante}
          disabled={savingFeriante}
          buttonColor="#1E88E5"
          style={styles.ferianteSaveBtn}
        >
          Guardar precios feriante
        </Button>
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

  // ── feriante prices ──
  ferianteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    gap: 12,
  },
  ferianteName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#111',
  },
  ferianteInput: {
    width: 90,
    backgroundColor: '#fff',
  },
  ferianteSaveBtn: {
    borderRadius: 8,
    margin: 12,
  },

  // ── location dialog ──
  locationInput: { backgroundColor: '#fff' },
  locationInputError: {
    color: '#E53935',
    fontSize: 12,
    marginTop: 4,
  },
});
