import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  Alert,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  ActivityIndicator,
  Button,
  Checkbox,
  Dialog,
  Divider,
  Icon,
  IconButton,
  Menu,
  Portal,
  SegmentedButtons,
  Surface,
  Switch,
  Text,
  TextInput,
  TouchableRipple,
} from 'react-native-paper';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { useSessionStore } from '../../stores/useSessionStore';
import { buildProfileList } from '../../lib/profiles';
import {
  getPendingSyncEntries,
  updateProductBasePrice,
} from '../../services/db';
import { runFullSync, type ConfirmCatalogDeletions } from '../../services/syncAll';
import type { Product } from '../../lib/types';
import { savePricesAndQueue, type PricePush } from '../../services/pricesApi';
import {
  getLocalApiBaseUrl,
  setApiBaseUrl,
  getServerMode,
  setServerMode,
  PRODUCTION_API_BASE_URL,
  type ServerMode,
} from '../../services/apiConfig';
import {
  clearPairedPrinter,
  getPairedPrinter,
  isPrinterConnected,
  printPromo,
  printTest,
  setAlias,
  type PrinterDevice,
} from '../../services/printer';
import { DEFAULT_FERIANTE_PRICES } from '../../lib/constants';
import StableTextInput from '../../components/StableTextInput';

/** Etiqueta a mostrar: alias del usuario si existe, si no el nombre Bluetooth. */
function labelOf(d: PrinterDevice): string {
  return d.alias && d.alias.trim() ? d.alias : d.name;
}

interface PriceRowProps {
  id: string;
  name: string;
  value: string;
  styleRow: any;
  styleName: any;
  styleInput: any;
  onChange: (id: string, v: string) => void;
}

const PriceRow = React.memo(function PriceRow({ id, name, value, styleRow, styleName, styleInput, onChange }: PriceRowProps): React.JSX.Element {
  const handleChange = useCallback((v: string) => onChange(id, v), [id, onChange]);
  return (
    <View style={styleRow}>
      <Text style={styleName}>{name}</Text>
      <StableTextInput
        value={value}
        onChangeText={handleChange}
        mode="outlined"
        keyboardType="decimal-pad"
        style={styleInput}
        right={<TextInput.Affix text="€" />}
      />
    </View>
  );
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function SettingsScreen(): React.JSX.Element {
  const router = useRouter();
  const products          = useSessionStore((s) => s.products);
  const loadProducts      = useSessionStore((s) => s.loadProducts);
  const feriantePrices    = useSessionStore((s) => s.feriantePrices);
  const setFeriantePrices = useSessionStore((s) => s.setFeriantePrices);
  const forcePrintTwice    = useSessionStore((s) => s.forcePrintTwice);
  const setForcePrintTwice = useSessionStore((s) => s.setForcePrintTwice);
  const loadForcePrintTwice = useSessionStore((s) => s.loadForcePrintTwice);
  const activeProductProfile    = useSessionStore((s) => s.activeProductProfile);
  const setActiveProductProfile = useSessionStore((s) => s.setActiveProductProfile);
  const loadActiveProductProfile = useSessionStore((s) => s.loadActiveProductProfile);
  const catalogProfiles = useSessionStore((s) => s.catalogProfiles);
  const deviceLetter    = useSessionStore((s) => s.deviceLetter);
  const setDeviceLetter = useSessionStore((s) => s.setDeviceLetter);
  const loadDeviceLetter = useSessionStore((s) => s.loadDeviceLetter);

  // Perfiles disponibles: entidad del backend si la hay, si no derivados de productos.
  const profileList = useMemo(
    () => buildProfileList(products, catalogProfiles),
    [products, catalogProfiles],
  );
  const activeProfileMeta = profileList.find((p) => p.value === activeProductProfile);

  useEffect(() => { void loadForcePrintTwice(); }, [loadForcePrintTwice]);
  useEffect(() => { void loadActiveProductProfile(); }, [loadActiveProductProfile]);
  useEffect(() => { void loadDeviceLetter(); }, [loadDeviceLetter]);

  // ── local state ───────────────────────────────────────────────────────────
  const [pendingCount, setPendingCount]     = useState(0);
  const [syncing, setSyncing]               = useState(false);
  const [loadingData, setLoadingData]       = useState(true);
  const [pairedPrinter, setPairedPrinter]   = useState<PrinterDevice | null>(null);
  const [testingPrinter, setTestingPrinter] = useState(false);
  const [printerConnected, setPrinterConnected] = useState(false);
  const [profileMenuVisible, setProfileMenuVisible] = useState(false);

  // Servidor / catálogo de productos
  // En modo 'production' la URL es fija; en 'local' se edita y se persiste.
  const [serverMode, setServerModeState] = useState<ServerMode>('production');
  const [apiBaseUrlInput, setApiBaseUrlInput]   = useState('');
  const [catalogUpdatedAt, setCatalogUpdatedAt] = useState<string | null>(null);

  // Sincronización unificada (productos + locales + futuras)
  const [syncingAll, setSyncingAll]             = useState(false);
  const [locationsSyncedAt, setLocationsSyncedAt] = useState<string | null>(null);

  // Revisión de borrados de catálogo: productos locales que el backend ya no trae.
  // El modal deja marcar cuáles eliminar; los no marcados se conservan. La promesa
  // del callback se resuelve al pulsar un botón del modal (resolver guardado en ref).
  const [reviewCandidates, setReviewCandidates] = useState<Product[] | null>(null);
  const [reviewSelected, setReviewSelected]     = useState<Set<string>>(new Set());
  const reviewResolverRef = useRef<((ids: Set<string>) => void) | null>(null);

  const confirmCatalogDeletions = useCallback<ConfirmCatalogDeletions>((candidates) => {
    return new Promise<Set<string>>((resolve) => {
      reviewResolverRef.current = resolve;
      setReviewSelected(new Set());     // por defecto nada marcado ⇒ conservar todo
      setReviewCandidates(candidates);  // abre el modal
    });
  }, []);

  // Resuelve la promesa del callback y cierra el modal. `ids` = productos a ELIMINAR.
  const resolveReview = useCallback((ids: Set<string>) => {
    reviewResolverRef.current?.(ids);
    reviewResolverRef.current = null;
    setReviewCandidates(null);
  }, []);

  const toggleReview = useCallback((id: string) => {
    setReviewSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    void (async () => {
      setServerModeState(await getServerMode());
      setApiBaseUrlInput(await getLocalApiBaseUrl());
      setCatalogUpdatedAt(await AsyncStorage.getItem('tpv:catalogUpdatedAt'));
      setLocationsSyncedAt(await AsyncStorage.getItem('tpv:locationsSyncedAt'));
    })();
  }, []);

  /** Cambia de servidor: persiste antes la URL local en edición para no perderla. */
  const handleChangeServerMode = useCallback(async (mode: ServerMode) => {
    setServerModeState(mode);
    try {
      await setApiBaseUrl(apiBaseUrlInput);
      await setServerMode(mode);
    } catch { /* ignore */ }
  }, [apiBaseUrlInput]);

  // Edición de alias de la impresora
  const [printerEditTarget, setPrinterEditTarget] = useState<PrinterDevice | null>(null);
  const [printerAliasInput, setPrinterAliasInput] = useState('');

  const reloadPairedPrinter = useCallback(async () => {
    const p = await getPairedPrinter();
    setPairedPrinter(p);
    setPrinterConnected(p ? await isPrinterConnected() : false);
  }, []);

  useFocusEffect(useCallback(() => {
    void reloadPairedPrinter();
  }, [reloadPairedPrinter]));

  async function handleTestPrint(): Promise<void> {
    setTestingPrinter(true);
    try {
      const result = await printTest();
      if (result.ok) {
        Alert.alert('OK', 'Prueba enviada a la impresora.');
      } else if (!result.cancelled) {
        Alert.alert('Error al imprimir', result.error ?? 'Fallo desconocido.');
      }
    } finally {
      setTestingPrinter(false);
      await reloadPairedPrinter(); // refleja el estado real de conexión tras el intento
    }
  }

  function openEditPrinter(d: PrinterDevice): void {
    setPrinterEditTarget(d);
    setPrinterAliasInput(d.alias ?? '');
  }

  async function savePrinterAlias(): Promise<void> {
    if (!printerEditTarget) return;
    await setAlias(printerEditTarget.address, printerAliasInput.trim());
    setPrinterEditTarget(null);
    await reloadPairedPrinter();
  }

  function handleClearPrinter(): void {
    Alert.alert(
      'Quitar impresora',
      '¿Olvidar la impresora actual? Tendrás que volver a seleccionarla.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Quitar',
          style: 'destructive',
          onPress: async () => {
            await clearPairedPrinter();
            await reloadPairedPrinter();
          },
        },
      ],
    );
  }

  // Promo print dialog
  const [promoVisible, setPromoVisible]   = useState(false);
  const [promoMessage, setPromoMessage]   = useState('');
  const [promoCountStr, setPromoCountStr] = useState('1');
  const [promoDate, setPromoDate]         = useState(() => {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  });
  // null = idle; { current, total } = printing in progress
  const [promoProgress, setPromoProgress] = useState<{ current: number; total: number } | null>(null);
  const promoCancelledRef = useRef(false);

  function validatePromoInputs(): number | null {
    if (!promoMessage.trim()) {
      Alert.alert('Texto vacío', 'Escribe un mensaje para imprimir.');
      return null;
    }
    const count = parseInt(promoCountStr, 10);
    if (isNaN(count) || count < 1) {
      Alert.alert('Número inválido', 'Introduce un número mayor que 0.');
      return null;
    }
    return count;
  }

  async function handlePrintPromo(copies: number): Promise<void> {
    promoCancelledRef.current = false;
    setPromoProgress({ current: 0, total: copies });
    try {
      const result = await printPromo(
        promoMessage.trim(),
        copies,
        promoDate.trim(),
        (current, total) => setPromoProgress({ current, total }),
        () => !promoCancelledRef.current,
      );
      if (result.ok) {
        setPromoVisible(false);
      } else if (!result.cancelled) {
        Alert.alert('Error al imprimir', result.error ?? 'Fallo desconocido.');
      }
    } finally {
      setPromoProgress(null);
    }
  }

  function handleStartPromo(): void {
    const count = validatePromoInputs();
    if (count !== null) void handlePrintPromo(count);
  }

  function handleTestPromo(): void {
    if (!promoMessage.trim()) {
      Alert.alert('Texto vacío', 'Escribe un mensaje para imprimir.');
      return;
    }
    void handlePrintPromo(2);
  }

  function handleCancelPromo(): void {
    promoCancelledRef.current = true;
  }

  // Base prices dialog
  const [basePricesVisible, setBasePricesVisible] = useState(false);
  const [baseDraft, setBaseDraft]                 = useState<Record<string, string>>({});
  const [savingBase, setSavingBase]               = useState(false);
  const setBaseForId = useCallback((id: string, v: string) => {
    setBaseDraft((prev) => ({ ...prev, [id]: v }));
  }, []);

  // Feriante prices dialog
  const ferianteProductIds = Object.keys(DEFAULT_FERIANTE_PRICES);
  const [ferianteVisible, setFerianteVisible] = useState(false);
  const [ferianteDraft, setFerianteDraft]     = useState<Record<string, string>>({});
  const [savingFeriante, setSavingFeriante]   = useState(false);
  const setFerianteForId = useCallback((id: string, v: string) => {
    setFerianteDraft((prev) => ({ ...prev, [id]: v }));
  }, []);

  // ── load ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoadingData(true);
    try {
      const pending = await getPendingSyncEntries();
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

  // ── sincronización unificada (productos + locales + futuras) ────────────────
  // Todas las sincronizaciones de datos se ejecutan desde aquí. La cola de
  // tickets (handleSync) es la única excepción y conserva su botón propio.
  async function handleSyncAll(): Promise<void> {
    // Persistir la URL local introducida antes de sincronizar (en producción es fija).
    if (serverMode === 'local') {
      try { await setApiBaseUrl(apiBaseUrlInput); } catch { /* ignore */ }
    }

    setSyncingAll(true);
    try {
      const { results, allOk } = await runFullSync({ confirmCatalogDeletions });
      // Refrescar la UI desde las fuentes que las tasks acaban de actualizar.
      setCatalogUpdatedAt(await AsyncStorage.getItem('tpv:catalogUpdatedAt'));
      setLocationsSyncedAt(await AsyncStorage.getItem('tpv:locationsSyncedAt'));

      const lines = results
        .map((r) => `${r.ok ? '✓' : '✗'} ${r.label}: ${r.detail}`)
        .join('\n');
      Alert.alert(
        allOk ? 'Sincronización completada' : 'Sincronización con errores',
        lines,
      );
    } finally {
      setSyncingAll(false);
    }
  }

  function formatUpdatedAt(iso: string | null): string {
    if (!iso) return 'Nunca actualizado desde el servidor.';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Nunca actualizado desde el servidor.';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `Última actualización: ${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
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
      const changed: PricePush[] = [];
      for (const p of editableProducts) {
        const val = parseFloat(baseDraft[p.id].replace(',', '.'));
        if (val !== p.basePrice) {
          await updateProductBasePrice(p.id, val);
          changed.push({ id: p.id, basePrice: val });
        }
      }
      // Reload from SQLite so store reflects persisted prices
      await loadProducts();
      // Subir al backend (best-effort; si falla queda en cola de reintento).
      void savePricesAndQueue(changed);
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
      // Subir al backend (best-effort; si falla queda en cola de reintento).
      const changed: PricePush[] = ferianteProductIds.map((id) => ({ id, feriantePrice: parsed[id] }));
      void savePricesAndQueue(changed);
      setFerianteVisible(false);
    } finally {
      setSavingFeriante(false);
    }
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

      {/* ── PRINTER SETTINGS ──────────────────────────────────────────────── */}
      <Text variant="labelLarge" style={styles.sectionLabel}>AJUSTES DE IMPRESORA</Text>
      <Surface style={styles.card} elevation={1}>
        {pairedPrinter ? (
          <>
            <View style={styles.printerCurrentRow}>
              <View style={styles.printerCurrentInfo}>
                <Text style={styles.printerCurrentName}>{labelOf(pairedPrinter)}</Text>
                <Text style={styles.printerCurrentAddress}>{pairedPrinter.address}</Text>
                <View style={styles.printerStatusRow}>
                  <View
                    style={[
                      styles.printerStatusDot,
                      { backgroundColor: printerConnected ? '#43A047' : '#BDBDBD' },
                    ]}
                  />
                  <Text
                    style={[
                      styles.printerStatusText,
                      { color: printerConnected ? '#43A047' : '#999' },
                    ]}
                  >
                    {printerConnected ? 'Conectada' : 'Desconectada'}
                  </Text>
                </View>
              </View>
              <IconButton
                icon="pencil"
                size={22}
                onPress={() => openEditPrinter(pairedPrinter)}
                accessibilityLabel="Editar nombre"
              />
            </View>
            <Divider />
            <View style={styles.printerActions}>
              <Button
                mode="contained"
                icon="printer-check"
                onPress={() => void handleTestPrint()}
                loading={testingPrinter}
                disabled={testingPrinter}
                buttonColor="#43A047"
                style={styles.printerActionBtn}
              >
                {testingPrinter ? 'Conectando…' : 'Imprimir prueba'}
              </Button>
              <Button
                mode="outlined"
                icon="link-off"
                onPress={() => handleClearPrinter()}
                textColor="#E53935"
                style={styles.printerActionBtn}
              >
                Quitar
              </Button>
            </View>
          </>
        ) : (
          <View style={styles.priceActionRow}>
            <View style={styles.priceActionText}>
              <Text style={styles.priceActionTitle}>Seleccionar impresora Bluetooth</Text>
              <Text style={styles.priceActionSubtitle}>
                Elige la impresora térmica emparejada con el teléfono y prueba la conexión.
              </Text>
            </View>
            <Button
              mode="outlined"
              icon="printer-settings"
              onPress={() => router.push('/settings/printer')}
              style={styles.priceActionBtn}
            >
              Abrir
            </Button>
          </View>
        )}
      </Surface>

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

      {/* ── PRINTING ──────────────────────────────────────────────────────── */}
      <Text variant="labelLarge" style={styles.sectionLabel}>IMPRESIÓN</Text>
      <Surface style={styles.card} elevation={1}>
        <View style={styles.priceActionRow}>
          <View style={styles.priceActionText}>
            <Text style={styles.priceActionTitle}>Imprimir siempre 2 copias</Text>
            <Text style={styles.priceActionSubtitle}>
              Cada ticket se imprime por duplicado, como si "Imprimir 2x" estuviera siempre activo.
            </Text>
          </View>
          <Switch
            value={forcePrintTwice}
            onValueChange={(v) => void setForcePrintTwice(v)}
          />
        </View>

        <Divider />

        <View style={styles.priceActionRow}>
          <View style={styles.priceActionText}>
            <Text style={styles.priceActionTitle}>Letra del dispositivo</Text>
            <Text style={styles.priceActionSubtitle}>
              Identificador interno para distinguir este TPV en sesiones compartidas.
              Se muestra en la app (ej. "{deviceLetter || 'A'}3"); NO se imprime en la comanda.
            </Text>
          </View>
          <TextInput
            mode="outlined"
            dense
            autoCapitalize="characters"
            maxLength={2}
            value={deviceLetter}
            onChangeText={(v) => void setDeviceLetter(v)}
            placeholder="—"
            style={styles.deviceLetterInput}
          />
        </View>
      </Surface>

      {/* ── CUPONES / FOLLETOS ────────────────────────────────────────────── */}
      <Text variant="labelLarge" style={styles.sectionLabel}>CUPONES / FOLLETOS</Text>
      <Surface style={styles.card} elevation={1}>
        <TouchableRipple onPress={() => setPromoVisible(true)} borderless style={styles.promoCardTouch}>
          <View style={styles.priceActionRow}>
            <View style={styles.priceActionText}>
              <Text style={styles.priceActionTitle}>Imprimir logo con mensaje</Text>
              <Text style={styles.priceActionSubtitle}>
                Imprime el logo de la empresa con un texto personalizado, tantas veces como quieras.
              </Text>
            </View>
            <Icon source="chevron-right" size={22} color="#888" />
          </View>
        </TouchableRipple>
      </Surface>

      {/* ── PRODUCTOS ─────────────────────────────────────────────────────── */}
      <Text variant="labelLarge" style={styles.sectionLabel}>PRODUCTOS</Text>
      <Surface style={styles.card} elevation={1}>
        <View style={styles.profileSection}>
          <Text style={styles.priceActionTitle}>Carta activa en venta</Text>
          <Menu
            visible={profileMenuVisible}
            onDismiss={() => setProfileMenuVisible(false)}
            anchor={
              <TouchableRipple
                onPress={() => setProfileMenuVisible(true)}
                style={styles.profileAnchor}
              >
                <View style={styles.profileAnchorRow}>
                  {activeProfileMeta?.icon ? (
                    <Icon source={activeProfileMeta.icon} size={20} color="#111" />
                  ) : null}
                  <Text style={styles.profileAnchorLabel} numberOfLines={1}>
                    {activeProfileMeta?.label ?? activeProductProfile}
                  </Text>
                  <Icon source="chevron-down" size={22} color="#888" />
                </View>
              </TouchableRipple>
            }
            anchorPosition="bottom"
          >
            {profileList.map((p) => (
              <Menu.Item
                key={p.value}
                title={p.label}
                leadingIcon={p.icon}
                trailingIcon={activeProductProfile === p.value ? 'check' : undefined}
                onPress={() => {
                  setProfileMenuVisible(false);
                  void setActiveProductProfile(p.value);
                }}
              />
            ))}
          </Menu>
        </View>
      </Surface>

      {/* ── SYNC ──────────────────────────────────────────────────────────── */}
      <Text variant="labelLarge" style={styles.sectionLabel}>SINCRONIZACIÓN</Text>
      <Surface style={styles.card} elevation={1}>
        {/* Servidor: URL usada por todas las sincronizaciones */}
        <Text style={[styles.syncTitle, styles.serverTitle]}>Servidor</Text>
        <SegmentedButtons
          value={serverMode}
          onValueChange={(v) => void handleChangeServerMode(v as ServerMode)}
          style={styles.serverModeButtons}
          buttons={[
            { value: 'production', label: 'Producción', icon: 'cloud-check' },
            { value: 'local',      label: 'Local',      icon: 'lan-connect' },
          ]}
        />
        {serverMode === 'production' ? (
          <>
            <Text style={styles.apiUrlValue}>{PRODUCTION_API_BASE_URL}</Text>
            <Text style={styles.serverModeHint}>URL fija del servidor de producción.</Text>
          </>
        ) : (
          <StableTextInput
            value={apiBaseUrlInput}
            onChangeText={setApiBaseUrlInput}
            onBlur={() => void setApiBaseUrl(apiBaseUrlInput)}
            mode="outlined"
            placeholder="http://192.168.1.50 o http://10.0.2.2"
            autoCapitalize="none"
            keyboardType="url"
            style={styles.apiUrlInput}
          />
        )}
        <Divider style={styles.cardDivider} />

        {/* Botón unificado: productos + locales (+ futuras sincronizaciones) */}
        <Button
          mode="contained"
          icon="cloud-sync"
          onPress={() => void handleSyncAll()}
          loading={syncingAll}
          disabled={syncingAll}
          buttonColor="#43A047"
          style={styles.syncBtn}
        >
          Sincronizar ahora
        </Button>
        <Text style={styles.syncHint}>
          Sincroniza productos y locales con el servidor.{'\n'}
          Productos — {formatUpdatedAt(catalogUpdatedAt)}{'\n'}
          Locales — {formatUpdatedAt(locationsSyncedAt)}
        </Text>

        <Divider style={styles.cardDivider} />

        {/* Cola de tickets: sincronización propia, independiente del botón unificado */}
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
          Sincronizar cola de tickets
        </Button>
        <Text style={styles.syncHint}>
          API no configurada. Los datos se sincronizarán automáticamente cuando esté disponible.
        </Text>
      </Surface>

      {/* ── DIALOGS ───────────────────────────────────────────────────────── */}
      <Portal>

        {/* Printer alias dialog */}
        <Dialog visible={printerEditTarget !== null} onDismiss={() => setPrinterEditTarget(null)}>
          <Dialog.Title>Nombre de la impresora</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.printerDialogMac}>{printerEditTarget?.address}</Text>
            <StableTextInput
              mode="outlined"
              label="Nombre"
              value={printerAliasInput}
              onChangeText={setPrinterAliasInput}
              placeholder={printerEditTarget?.name}
              autoFocus
              style={styles.printerAliasInput}
            />
            <Text style={styles.printerDialogHint}>
              Déjalo vacío para volver al nombre original del dispositivo.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setPrinterEditTarget(null)}>Cancelar</Button>
            <Button onPress={() => void savePrinterAlias()}>Guardar</Button>
          </Dialog.Actions>
        </Dialog>

        {/* Promo print dialog */}
        <Dialog visible={promoVisible} onDismiss={() => promoProgress === null && setPromoVisible(false)}>
          <Dialog.Title>Imprimir logo con mensaje</Dialog.Title>
          <Dialog.Content style={styles.promoDialogContent}>
            {promoProgress === null ? (
              <>
                <StableTextInput
                  label="Mensaje a imprimir"
                  value={promoMessage}
                  onChangeText={setPromoMessage}
                  mode="outlined"
                  multiline
                  numberOfLines={3}
                  autoCapitalize="sentences"
                  style={styles.promoMessageInput}
                />
                <StableTextInput
                  label="Válido el día (dd/mm/aaaa)"
                  value={promoDate}
                  onChangeText={setPromoDate}
                  mode="outlined"
                  keyboardType="numeric"
                  style={styles.promoMessageInput}
                />
                <StableTextInput
                  label="Número de copias"
                  value={promoCountStr}
                  onChangeText={setPromoCountStr}
                  mode="outlined"
                  keyboardType="number-pad"
                  style={styles.promoCountInput}
                />
              </>
            ) : (
              <View style={styles.promoProgressBox}>
                <ActivityIndicator size="large" />
                <Text style={styles.promoProgressText}>
                  {promoProgress.current === 0
                    ? 'Conectando con la impresora...'
                    : `Imprimiendo copia ${promoProgress.current} de ${promoProgress.total}...`}
                </Text>
              </View>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            {promoProgress === null ? (
              <>
                <Button onPress={() => setPromoVisible(false)}>Cancelar</Button>
                <Button
                  mode="contained"
                  buttonColor="#43A047"
                  icon="printer-check"
                  onPress={handleTestPromo}
                >
                  Prueba
                </Button>
                <Button
                  mode="contained"
                  buttonColor="#1565C0"
                  icon="printer"
                  onPress={handleStartPromo}
                >
                  Imprimir
                </Button>
              </>
            ) : (
              <Button
                mode="contained"
                buttonColor="#777"
                icon="cancel"
                onPress={handleCancelPromo}
              >
                Cancelar impresión
              </Button>
            )}
          </Dialog.Actions>
        </Dialog>

        {/* Base prices dialog */}
        <Dialog visible={basePricesVisible} onDismiss={() => setBasePricesVisible(false)}>
          <Dialog.Title>Precios por defecto</Dialog.Title>
          <Dialog.ScrollArea style={styles.dialogScroll}>
            <ScrollView>
              {editableProducts.map((p, idx) => (
                <React.Fragment key={p.id}>
                  {idx > 0 && <Divider />}
                  <PriceRow
                    id={p.id}
                    name={p.name}
                    value={baseDraft[p.id] ?? ''}
                    styleRow={styles.priceRow}
                    styleName={styles.priceName}
                    styleInput={styles.priceInput}
                    onChange={setBaseForId}
                  />
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
                    <PriceRow
                      id={id}
                      name={name}
                      value={ferianteDraft[id] ?? ''}
                      styleRow={styles.priceRow}
                      styleName={styles.priceName}
                      styleInput={styles.priceInput}
                      onChange={setFerianteForId}
                    />
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

        {/* Revisión de borrados de catálogo (red de seguridad) */}
        <Dialog
          visible={reviewCandidates !== null}
          onDismiss={() => resolveReview(new Set())}
        >
          <Dialog.Title>Productos a eliminar</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.reviewIntro}>
              Estos productos están en este dispositivo pero el servidor ya no los
              incluye. Marca los que quieras eliminar; los que dejes sin marcar se
              conservarán.
            </Text>
          </Dialog.Content>
          <Dialog.ScrollArea style={styles.dialogScroll}>
            <ScrollView>
              {(reviewCandidates ?? []).map((p, idx) => {
                const checked = reviewSelected.has(p.id);
                return (
                  <React.Fragment key={p.id}>
                    {idx > 0 && <Divider />}
                    <TouchableRipple onPress={() => toggleReview(p.id)}>
                      <View style={styles.reviewRow}>
                        <Checkbox status={checked ? 'checked' : 'unchecked'} />
                        <View style={styles.reviewRowText}>
                          <Text style={styles.reviewName}>{p.name}</Text>
                          <Text style={styles.reviewMeta}>
                            {p.category}{p.isActive ? '' : ' · inactivo'}
                          </Text>
                        </View>
                      </View>
                    </TouchableRipple>
                  </React.Fragment>
                );
              })}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => resolveReview(new Set())}>Conservar todos</Button>
            <Button
              mode="contained"
              buttonColor="#E53935"
              disabled={reviewSelected.size === 0}
              onPress={() => resolveReview(reviewSelected)}
            >
              Eliminar ({reviewSelected.size})
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
  deviceLetterInput: {
    width: 72,
    backgroundColor: '#fff',
    textAlign: 'center',
  },
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

  // ── product profile section ──
  profileSection: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 6,
  },
  profileAnchor: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  profileAnchorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  profileAnchorLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#111',
  },

  // ── price dialog rows ──
  dialogScroll: {
    maxHeight: 400,
    paddingHorizontal: 0,
  },
  reviewIntro: {
    fontSize: 14,
    lineHeight: 20,
    opacity: 0.8,
  },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    gap: 8,
  },
  reviewRowText: {
    flex: 1,
  },
  reviewName: {
    fontSize: 16,
  },
  reviewMeta: {
    fontSize: 12,
    opacity: 0.6,
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
  serverTitle: {
    paddingHorizontal: 16,
    paddingTop: 12,
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
  apiUrlInput: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  apiUrlValue: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 2,
    fontSize: 16,
    fontWeight: '600',
    color: '#222',
  },
  serverModeButtons: {
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 4,
  },
  serverModeHint: {
    fontSize: 12,
    color: '#999',
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

  // ── printer current ──
  printerCurrentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  printerCurrentInfo: { flex: 1 },
  printerCurrentName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
  },
  printerCurrentAddress: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  printerStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  printerStatusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginRight: 6,
  },
  printerStatusText: {
    fontSize: 13,
    fontWeight: '600',
  },
  printerActions: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
  },
  printerActionBtn: {
    flex: 1,
    borderRadius: 8,
  },
  printerDialogMac: {
    fontSize: 13,
    color: '#666',
    marginBottom: 10,
  },
  printerDialogHint: {
    fontSize: 12,
    color: '#999',
    marginTop: 8,
    lineHeight: 16,
  },

  // ── promo card ──
  promoCardTouch: { borderRadius: 12 },

  // ── promo dialog ──
  promoDialogContent: { gap: 12 },
  promoMessageInput: { backgroundColor: '#fff' },
  promoCountInput: { backgroundColor: '#fff', width: 180 },
  promoProgressBox: {
    alignItems: 'center',
    paddingVertical: 16,
    gap: 16,
  },
  promoProgressText: {
    fontSize: 15,
    color: '#333',
    textAlign: 'center',
  },

  // ── location dialog ──
  printerAliasInput: { backgroundColor: '#fff' },
});
