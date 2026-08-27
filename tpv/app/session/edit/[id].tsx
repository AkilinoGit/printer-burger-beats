// Edición de una sesión (jornada) — Fase 3 del sync de sesiones.
//
// Permite cambiar notas, ubicación y precios de sesión, y borrar (soft delete).
// Cada guardado usa las funciones de db.ts que ya marcan la sesión como
// 'pending' y lanzan un push silencioso, de modo que el cambio viaja al backend
// en la próxima sincronización sin bloquear la UI. Editable también en sesiones
// de otros dispositivos (decisión 2026-07-21). Ver tpv-sessions-sync-plan.md §3.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Dialog,
  Divider,
  HelperText,
  Menu,
  Portal,
  Surface,
  Text,
  TextInput,
} from 'react-native-paper';
import { useLocalSearchParams, useRouter } from 'expo-router';

import {
  getLocations,
  getSessionById,
  getSessionSummary,
  softDeleteSession,
  updateSessionDiscount,
  updateSessionLocation,
  updateSessionNotes,
  updateSessionPriceOverrides,
} from '../../../services/db';
import { syncSessions } from '../../../services/sessionsApi';
import { formatPrice } from '../../../lib/utils';
import { useSessionStore } from '../../../stores/useSessionStore';
import SessionDiscountToggles from '../../../components/SessionDiscountToggles';
import type { Location, Session, SessionDiscountPct } from '../../../lib/types';

/** Lanza un sync en segundo plano; los errores se ignoran (se reintenta luego). */
function fireSync(): void {
  void syncSessions().catch(() => {});
}

export default function SessionEditScreen(): React.JSX.Element {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const products = useSessionStore((s) => s.products);
  const activeSession = useSessionStore((s) => s.activeSession);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);

  const [session, setSession] = useState<Session | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [summary, setSummary] = useState<{ ticketCount: number; total: number }>({ ticketCount: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // form state
  const [notes, setNotes] = useState('');
  const [locationId, setLocationId] = useState('');
  const [locationMenu, setLocationMenu] = useState(false);
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});
  const [discountPct, setDiscountPct] = useState<SessionDiscountPct>(0);

  const [deleteDialog, setDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [found, locs, sum] = await Promise.all([
        getSessionById(id),
        getLocations(),
        getSessionSummary(id),
      ]);
      setSession(found);
      setLocations(locs);
      setSummary(sum);
      if (found) {
        setNotes(found.notes ?? '');
        setLocationId(found.locationId);
        const draft: Record<string, string> = {};
        for (const [pid, price] of Object.entries(found.priceOverrides)) {
          draft[pid] = String(price);
        }
        setPriceDraft(draft);
        setDiscountPct(found.summaryDiscountPct);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const editableProducts = useMemo(
    () => products.filter((p) => p.isActive && !p.isCustom),
    [products],
  );

  const locationName = (lid: string): string =>
    locations.find((l) => l.id === lid)?.name ?? lid;

  // ── guardar ────────────────────────────────────────────────────────────────
  async function handleSave(): Promise<void> {
    if (!session) return;
    setSaving(true);
    try {
      // Notas (solo si cambiaron).
      const nextNotes = notes.trim() === '' ? null : notes.trim();
      if (nextNotes !== (session.notes ?? null)) {
        await updateSessionNotes(session.id, nextNotes);
      }

      // Ubicación (solo si cambió).
      if (locationId && locationId !== session.locationId) {
        await updateSessionLocation(session.id, locationId);
      }

      // Precios de sesión: solo se guardan overrides que difieren del basePrice.
      const overrides: Record<string, number> = {};
      for (const p of editableProducts) {
        const raw = priceDraft[p.id]?.replace(',', '.').trim();
        if (raw === undefined || raw === '') continue;
        const val = parseFloat(raw);
        if (!isNaN(val) && val !== p.basePrice) overrides[p.id] = val;
      }
      if (!shallowEqualNumberMap(overrides, session.priceOverrides)) {
        await updateSessionPriceOverrides(session.id, overrides);
      }

      if (discountPct !== session.summaryDiscountPct) {
        await updateSessionDiscount(session.id, discountPct);
      }

      // Si es la sesión activa en memoria, refrescar el store para que la UI
      // (precios de venta incluidos) refleje los cambios de inmediato.
      const fresh = await getSessionById(session.id);
      if (fresh && activeSession?.id === fresh.id) {
        setActiveSession(fresh);
      }

      fireSync();
      router.back();
    } catch {
      Alert.alert('Error', 'No se pudieron guardar los cambios. Inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  // ── borrar (soft delete) ─────────────────────────────────────────────────────
  async function handleDelete(): Promise<void> {
    if (!session) return;
    setDeleting(true);
    try {
      await softDeleteSession(session.id);
      // Si borramos la sesión activa, limpiar el store para no dejarla "colgada".
      if (activeSession?.id === session.id) {
        useSessionStore.setState({ activeSession: null, lastTicketNumber: 0 });
      }
      fireSync();
      setDeleteDialog(false);
      // Volver al inicio del historial: la sesión ya no existe para el usuario.
      router.back();
    } catch {
      Alert.alert('Error', 'No se pudo borrar la sesión. Inténtalo de nuevo.');
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}><ActivityIndicator size="large" /></View>
    );
  }
  if (!session) {
    return (
      <View style={styles.center}><Text style={styles.notFound}>Sesión no encontrada</Text></View>
    );
  }

  const isRemote = session.origin === 'remote';
  const hasTickets = summary.ticketCount > 0;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {isRemote && (
        <Surface style={styles.remoteBanner} elevation={0}>
          <Text style={styles.remoteText}>
            Sesión de otro dispositivo{session.deviceId ? ` (${session.deviceId.slice(0, 8)})` : ''}. Puedes editarla; los cambios se sincronizan.
          </Text>
        </Surface>
      )}

      {/* Notas */}
      <Text style={styles.label}>Comentario de la jornada</Text>
      <TextInput
        mode="outlined"
        value={notes}
        onChangeText={setNotes}
        placeholder="Notas, incidencias, observaciones…"
        multiline
        numberOfLines={3}
        style={styles.notesInput}
      />

      {/* Ubicación */}
      <Text style={styles.label}>Ubicación</Text>
      <Menu
        visible={locationMenu}
        onDismiss={() => setLocationMenu(false)}
        anchor={
          <Button
            mode="outlined"
            icon="map-marker"
            onPress={() => setLocationMenu(true)}
            contentStyle={styles.locationBtnContent}
            style={styles.locationBtn}
          >
            {locationName(locationId)}
          </Button>
        }
      >
        {locations.map((l) => (
          <Menu.Item
            key={l.id}
            onPress={() => { setLocationId(l.id); setLocationMenu(false); }}
            title={l.name}
            leadingIcon={l.id === locationId ? 'check' : undefined}
          />
        ))}
      </Menu>

      {/* Precios de sesión */}
      <Text style={styles.label}>Precios de esta sesión</Text>
      <HelperText type="info" style={styles.priceHelp}>
        Deja el precio base para no aplicar oferta. Solo se guardan los que cambies.
      </HelperText>
      <Surface style={styles.priceCard} elevation={1}>
        {editableProducts.map((p, i) => (
          <View key={p.id}>
            {i > 0 && <Divider />}
            <View style={styles.priceRow}>
              <Text style={styles.priceName} numberOfLines={1}>{p.name}</Text>
              <TextInput
                mode="outlined"
                dense
                keyboardType="decimal-pad"
                value={priceDraft[p.id] ?? ''}
                onChangeText={(v) => setPriceDraft((prev) => ({ ...prev, [p.id]: v }))}
                placeholder={String(p.basePrice)}
                right={<TextInput.Affix text="€" />}
                style={styles.priceInput}
              />
            </View>
          </View>
        ))}
      </Surface>

      {/* Descuento de jornada */}
      <View style={styles.discountBlock}>
        <SessionDiscountToggles value={discountPct} onChange={setDiscountPct} disabled={saving} />
      </View>

      {/* Acciones */}
      <Button
        mode="contained"
        icon="content-save"
        onPress={() => void handleSave()}
        loading={saving}
        disabled={saving}
        style={styles.saveBtn}
        contentStyle={styles.saveBtnContent}
      >
        Guardar cambios
      </Button>

      <Button
        mode="outlined"
        icon="delete-outline"
        onPress={() => setDeleteDialog(true)}
        textColor="#C62828"
        style={styles.deleteBtn}
      >
        Borrar sesión
      </Button>

      {/* Confirmación de borrado — reforzada si hay tickets */}
      <Portal>
        <Dialog visible={deleteDialog} onDismiss={() => setDeleteDialog(false)}>
          <Dialog.Title>¿Borrar esta sesión?</Dialog.Title>
          <Dialog.Content>
            {hasTickets ? (
              <Text variant="bodyMedium">
                Esta sesión tiene{' '}
                <Text style={styles.bold}>{summary.ticketCount} ticket{summary.ticketCount !== 1 ? 's' : ''}</Text>
                {' '}por un total de{' '}
                <Text style={styles.bold}>{formatPrice(summary.total)}</Text>.
                {'\n\n'}Los tickets no se eliminan, pero la sesión dejará de mostrarse
                en el historial. Esta acción se sincroniza con el resto de dispositivos.
              </Text>
            ) : (
              <Text variant="bodyMedium">
                La sesión dejará de mostrarse en el historial. Esta acción se
                sincroniza con el resto de dispositivos.
              </Text>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDeleteDialog(false)}>Cancelar</Button>
            <Button
              mode="contained"
              onPress={() => void handleDelete()}
              loading={deleting}
              disabled={deleting}
              buttonColor="#C62828"
            >
              Borrar
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </ScrollView>
  );
}

/** Igualdad superficial entre dos mapas productId→precio. */
function shallowEqualNumberMap(a: Record<string, number>, b: Record<string, number>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a[k] === b[k]);
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 16, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notFound: { fontSize: 16, color: '#888' },

  remoteBanner: {
    backgroundColor: '#FFF8E1',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  remoteText: { fontSize: 12, color: '#8D6E00' },

  label: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: '#777',
    marginTop: 14,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  notesInput: { backgroundColor: '#fff' },

  locationBtn: { borderRadius: 8, alignSelf: 'flex-start' },
  locationBtnContent: { height: 44, paddingHorizontal: 8 },

  priceHelp: { paddingHorizontal: 0, marginTop: -2 },
  priceCard: { borderRadius: 12, backgroundColor: '#fff', overflow: 'hidden' },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 12,
  },
  priceName: { flex: 1, fontSize: 15, color: '#222' },
  priceInput: { width: 110, backgroundColor: '#fff' },

  discountBlock: { marginTop: 20 },
  saveBtn: { marginTop: 24, borderRadius: 10 },
  saveBtnContent: { height: 48 },
  deleteBtn: { marginTop: 12, borderRadius: 10, borderColor: '#E5A0A0' },

  bold: { fontWeight: '800' },
});
