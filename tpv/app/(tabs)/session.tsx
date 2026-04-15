import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  ActivityIndicator,
  Button,
  Dialog,
  Divider,
  Menu,
  Portal,
  SegmentedButtons,
  Surface,
  Text,
  TextInput,
  TouchableRipple,
} from 'react-native-paper';
import { useRouter } from 'expo-router';

import { useSessionStore } from '../../stores/useSessionStore';
import {
  getActiveSession,
  getLocations,
  getNextTicketNumber,
  getSessionSummary,
  getSessions,
  insertSession,
} from '../../services/db';
import { formatPrice } from '../../lib/utils';
import type { Location, Session } from '../../lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES', {
    weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// SessionCard — used in history list
// ---------------------------------------------------------------------------

interface SessionCardProps {
  session: Session;
  locationName: string;
  onPress: () => void;
  onViewSummary: () => void;
}

function SessionCard({ session, locationName, onPress, onViewSummary }: SessionCardProps): React.JSX.Element {
  const [summary, setSummary] = useState<{ ticketCount: number; total: number }>({ ticketCount: 0, total: 0 });

  useEffect(() => {
    getSessionSummary(session.id).then(setSummary).catch(() => {});
  }, [session.id]);

  return (
    <View>
      <TouchableRipple onPress={onPress} rippleColor="rgba(0,0,0,0.06)">
        <View style={cardStyles.row}>
          <View style={cardStyles.left}>
            <Text style={cardStyles.date}>{formatDate(session.openedAt ?? session.createdAt)}</Text>
            <Text style={cardStyles.location}>{locationName}</Text>
            {session.sessionCode && (
              <Text style={cardStyles.code}>{session.sessionCode}</Text>
            )}
          </View>
          <View style={cardStyles.right}>
            <Text style={cardStyles.total}>{formatPrice(summary.total)}</Text>
            <Text style={cardStyles.tickets}>{summary.ticketCount} ticket{summary.ticketCount !== 1 ? 's' : ''}</Text>
          </View>
        </View>
      </TouchableRipple>
      <View style={cardStyles.actions}>
        <Button
          mode="text"
          icon="format-list-bulleted"
          onPress={onPress}
          compact
          style={cardStyles.actionBtn}
        >
          Ver tickets
        </Button>
        <Button
          mode="text"
          icon="chart-bar"
          onPress={onViewSummary}
          compact
          style={cardStyles.actionBtn}
        >
          Ver resumen
        </Button>
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  left: { flex: 1, gap: 3 },
  right: { alignItems: 'flex-end', gap: 3 },
  date: { fontSize: 15, fontWeight: '700', color: '#111' },
  location: { fontSize: 13, color: '#666' },
  code: { fontSize: 12, color: '#1565C0', fontWeight: '600' },
  total: { fontSize: 16, fontWeight: '800', color: '#1a1a1a' },
  tickets: { fontSize: 12, color: '#888' },
  actions: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e0e0e0',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  actionBtn: { flex: 1 },
});

// ---------------------------------------------------------------------------
// ActiveSessionCard
// ---------------------------------------------------------------------------

interface ActiveSessionCardProps {
  session: Session;
  locationName: string;
  summary: { ticketCount: number; total: number };
  onViewTickets: () => void;
  onViewSummary: () => void;
  onCloseRequest: () => void;
}

function ActiveSessionCard({ session, locationName, summary, onViewTickets, onViewSummary, onCloseRequest }: ActiveSessionCardProps): React.JSX.Element {
  const openedAt = session.openedAt ?? session.createdAt;

  return (
    <TouchableRipple onPress={onViewTickets} rippleColor="rgba(0,0,0,0.05)" borderless style={activeStyles.ripple}>
      <Surface style={activeStyles.card} elevation={3}>
        {/* Badge */}
        <View style={activeStyles.badgeRow}>
          <View style={activeStyles.badge}>
            <Text style={activeStyles.badgeText}>● ACTIVA</Text>
          </View>
          {session.sessionCode && (
            <Text style={activeStyles.code}>{session.sessionCode}</Text>
          )}
        </View>

        {/* Info */}
        <Text style={activeStyles.location}>{locationName}</Text>
        <View style={activeStyles.metaRow}>
          <View style={activeStyles.metaCol}>
            <Text style={activeStyles.metaLabel}>Apertura</Text>
            <Text style={activeStyles.metaValue}>{formatDate(openedAt)}</Text>
            <Text style={activeStyles.metaTime}>{formatTime(openedAt)}</Text>
          </View>
          <View style={activeStyles.metaCol}>
            <Text style={activeStyles.metaLabel}>Tickets</Text>
            <Text style={activeStyles.metaValue}>{summary.ticketCount}</Text>
          </View>
          <View style={activeStyles.metaCol}>
            <Text style={activeStyles.metaLabel}>Total</Text>
            <Text style={activeStyles.metaValue}>{formatPrice(summary.total)}</Text>
          </View>
        </View>

        {/* Auto-close notice */}
        <Text style={activeStyles.autoCloseNote}>
          La sesión se cierra automáticamente mañana a las 12:00
        </Text>

        {/* Actions */}
        <View style={activeStyles.actions}>
          <Button
            mode="contained"
            icon="ticket-outline"
            onPress={(e) => { e.stopPropagation?.(); onViewTickets(); }}
            contentStyle={activeStyles.btnContent}
            style={activeStyles.btn}
            buttonColor="#1565C0"
          >
            Ver tickets
          </Button>
          <Button
            mode="contained-tonal"
            icon="chart-bar"
            onPress={(e) => { e.stopPropagation?.(); onViewSummary(); }}
            contentStyle={activeStyles.btnContent}
            style={activeStyles.btn}
          >
            Ver resumen
          </Button>
          <Button
            mode="outlined"
            icon="stop-circle"
            onPress={(e) => { e.stopPropagation?.(); onCloseRequest(); }}
            contentStyle={activeStyles.btnContent}
            textColor="#E53935"
            style={[activeStyles.btn, activeStyles.closeBtn]}
          >
            Cerrar sesión
          </Button>
        </View>
      </Surface>
    </TouchableRipple>
  );
}

const activeStyles = StyleSheet.create({
  ripple: {
    borderRadius: 14,
    marginBottom: 24,
  },
  card: {
    borderRadius: 14,
    padding: 18,
    backgroundColor: '#fff',
    gap: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#43A047',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  badge: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#2E7D32',
    letterSpacing: 0.4,
  },
  code: {
    fontSize: 13,
    color: '#1565C0',
    fontWeight: '700',
  },
  location: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111',
  },
  metaRow: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap',
    marginTop: 4,
    alignItems: 'flex-start',
  },
  metaCol: {
    gap: 2,
    minWidth: 70,
  },
  autoCloseNote: {
    fontSize: 12,
    color: '#888',
    fontStyle: 'italic',
  },
  metaLabel: {
    fontSize: 11,
    color: '#888',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metaValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  metaTime: {
    fontSize: 12,
    color: '#555',
  },
  actions: {
    flexDirection: 'column',
    gap: 10,
    marginTop: 6,
  },
  btn: {
    flex: 1,
    borderRadius: 8,
  },
  btnContent: {
    height: 48,
  },
  closeBtn: {
    borderColor: '#E53935',
    flex: 1,
    borderRadius: 8,
  },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

const ALL_LOCATIONS = '__all__';

export default function SessionScreen(): React.JSX.Element {
  const router = useRouter();

  const activeSession      = useSessionStore((s) => s.activeSession);
  const activeLocation     = useSessionStore((s) => s.activeLocation);
  const setActiveSession    = useSessionStore((s) => s.setActiveSession);
  const setActiveLocation   = useSessionStore((s) => s.setActiveLocation);
  const setProducts         = useSessionStore((s) => s.setProducts);
  const closeCurrentSession = useSessionStore((s) => s.closeCurrentSession);
  const setLastTicketNumber = (n: number) => useSessionStore.setState({ lastTicketNumber: n });
  const products            = useSessionStore((s) => s.products);

  // ── local state ───────────────────────────────────────────────────────────
  const [locations, setLocations]               = useState<Location[]>([]);
  const [sessions, setSessions]                 = useState<Session[]>([]);
  const [loading, setLoading]                   = useState(true);
  const [opening, setOpening]                   = useState(false);
  const [closing, setClosing]                   = useState(false);
  const [closeDialogVisible, setCloseDialogVisible] = useState(false);
  const [activeSummary, setActiveSummary]       = useState<{ ticketCount: number; total: number }>({ ticketCount: 0, total: 0 });

  // Price dialog before opening session
  const [priceDialogVisible, setPriceDialogVisible] = useState(false);
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});

  // New session selector
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');

  // History filter
  const [filterLocationId, setFilterLocationId] = useState<string>(ALL_LOCATIONS);
  const [filterMenuVisible, setFilterMenuVisible] = useState(false);

  // ── load data ─────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [locs, allSessions] = await Promise.all([
        getLocations(),
        getSessions(),
      ]);
      setLocations(locs);

      const defaultLoc = activeLocation ?? locs.find((l) => l.isDefault) ?? locs[0] ?? null;
      if (defaultLoc && !activeLocation) setActiveLocation(defaultLoc);
      setSelectedLocationId(activeSession?.locationId ?? defaultLoc?.id ?? '');

      // Closed sessions only in history
      setSessions(allSessions.filter((s) => s.status === 'closed'));
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void loadData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh active session summary every time the tab comes into focus
  useFocusEffect(useCallback(() => {
    if (activeSession?.id) {
      getSessionSummary(activeSession.id).then(setActiveSummary).catch(() => {});
    }
  }, [activeSession?.id]));

  // ── open session ──────────────────────────────────────────────────────────
  function handleOpenSessionPress(): void {
    // Build draft from current product prices as defaults
    const editable = products.filter((p) => p.isActive && !p.isCustom);
    const draft: Record<string, string> = {};
    for (const p of editable) {
      draft[p.id] = String(p.basePrice);
    }
    setPriceDraft(draft);
    setPriceDialogVisible(true);
  }

  async function handleOpenSession(): Promise<void> {
    const loc = locations.find((l) => l.id === selectedLocationId);
    if (!loc) return;
    setPriceDialogVisible(false);
    setOpening(true);
    try {
      const existing = await getActiveSession();
      if (existing) {
        const lastNum = await getNextTicketNumber(existing.id) - 1;
        setLastTicketNumber(lastNum);
        setActiveSession(existing);
        setActiveLocation(loc);
        return;
      }
      // Build priceOverrides: only include products whose price differs from basePrice
      const overrides: Record<string, number> = {};
      for (const p of products.filter((pr) => pr.isActive && !pr.isCustom)) {
        const val = parseFloat(priceDraft[p.id]?.replace(',', '.') ?? '');
        if (!isNaN(val) && val !== p.basePrice) {
          overrides[p.id] = val;
        }
      }
      const session = await insertSession(loc.id, overrides);
      setLastTicketNumber(0);
      setActiveSession(session);
      setActiveLocation(loc);
    } finally {
      setOpening(false);
    }
  }

  // ── close session ─────────────────────────────────────────────────────────
  async function handleCloseSession(): Promise<void> {
    setClosing(true);
    try {
      await closeCurrentSession();
      await loadData(); // refresh history
    } finally {
      setClosing(false);
      setCloseDialogVisible(false);
    }
  }

  // ── derived ───────────────────────────────────────────────────────────────
  function locationName(id: string): string {
    return locations.find((l) => l.id === id)?.name ?? id;
  }

  const filteredSessions = filterLocationId === ALL_LOCATIONS
    ? sessions
    : sessions.filter((s) => s.locationId === filterLocationId);

  const filterLabel = filterLocationId === ALL_LOCATIONS
    ? 'Todas las ubicaciones'
    : locationName(filterLocationId);

  // ── render: loading ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <FlatList
        data={filteredSessions}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            {/* ── SECCIÓN 1: Sesión activa ─────────────────────────────────── */}
            {activeSession && activeSession.status === 'open' && (
              <>
                <Text style={styles.sectionLabel}>SESIÓN ACTIVA</Text>
                <ActiveSessionCard
                  session={activeSession}
                  locationName={locationName(activeSession.locationId)}
                  summary={activeSummary}
                  onViewTickets={() => router.push(`/session/${activeSession.id}`)}
                  onViewSummary={() => router.push(`/session/summary/${activeSession.id}`)}
                  onCloseRequest={() => setCloseDialogVisible(true)}
                />
              </>
            )}

            {/* ── SECCIÓN 2: Abrir nueva sesión ────────────────────────────── */}
            {(!activeSession || activeSession.status !== 'open') && (
              <>
                <Text style={styles.sectionLabel}>NUEVA SESIÓN</Text>
                <Surface style={styles.openCard} elevation={1}>
                  {locations.length > 1 ? (
                    <>
                      <Text style={styles.openCardHint}>Selecciona la ubicación</Text>
                      <SegmentedButtons
                        value={selectedLocationId}
                        onValueChange={setSelectedLocationId}
                        buttons={locations.map((l) => ({ value: l.id, label: l.name }))}
                      />
                    </>
                  ) : (
                    <Text style={styles.openCardLocation}>
                      {locations[0]?.name ?? '—'}
                    </Text>
                  )}
                  <Button
                    mode="contained"
                    icon="play-circle"
                    onPress={handleOpenSessionPress}
                    loading={opening}
                    disabled={opening || !selectedLocationId}
                    buttonColor="#43A047"
                    style={styles.openBtn}
                    contentStyle={styles.openBtnContent}
                    labelStyle={styles.openBtnLabel}
                  >
                    Abrir sesión
                  </Button>
                </Surface>
              </>
            )}

            {/* ── SECCIÓN 3: Historial — cabecera ──────────────────────────── */}
            <View style={styles.historyHeader}>
              <Text style={styles.sectionLabel}>HISTORIAL</Text>
              {locations.length > 1 && (
                <Menu
                  visible={filterMenuVisible}
                  onDismiss={() => setFilterMenuVisible(false)}
                  anchor={
                    <Button
                      mode="outlined"
                      icon="filter-variant"
                      onPress={() => setFilterMenuVisible(true)}
                      compact
                      style={styles.filterBtn}
                      contentStyle={styles.filterBtnContent}
                    >
                      {filterLabel}
                    </Button>
                  }
                >
                  <Menu.Item
                    onPress={() => { setFilterLocationId(ALL_LOCATIONS); setFilterMenuVisible(false); }}
                    title="Todas las ubicaciones"
                    leadingIcon={filterLocationId === ALL_LOCATIONS ? 'check' : undefined}
                  />
                  <Divider />
                  {locations.map((l) => (
                    <Menu.Item
                      key={l.id}
                      onPress={() => { setFilterLocationId(l.id); setFilterMenuVisible(false); }}
                      title={l.name}
                      leadingIcon={filterLocationId === l.id ? 'check' : undefined}
                    />
                  ))}
                </Menu>
              )}
            </View>

            {filteredSessions.length === 0 && (
              <Text style={styles.emptyText}>No hay sesiones cerradas</Text>
            )}
          </>
        }
        renderItem={({ item }) => (
          <Surface style={styles.historyCard} elevation={1}>
            <SessionCard
              session={item}
              locationName={locationName(item.locationId)}
              onPress={() => router.push(`/session/${item.id}`)}
              onViewSummary={() => router.push(`/session/summary/${item.id}`)}
            />
          </Surface>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      <Portal>
        {/* Price config dialog */}
        <Dialog visible={priceDialogVisible} onDismiss={() => setPriceDialogVisible(false)}>
          <Dialog.Title>Precios de la sesión</Dialog.Title>
          <Dialog.ScrollArea style={styles.priceDialogScroll}>
            <ScrollView>
              {products
                .filter((p) => p.isActive && !p.isCustom)
                .map((p, idx, arr) => (
                  <React.Fragment key={p.id}>
                    <View style={styles.priceRow}>
                      <Text style={styles.priceName}>{p.name}</Text>
                      <TextInput
                        value={priceDraft[p.id] ?? ''}
                        onChangeText={(v) => setPriceDraft((prev) => ({ ...prev, [p.id]: v }))}
                        mode="outlined"
                        keyboardType="decimal-pad"
                        style={styles.priceInput}
                        right={<TextInput.Affix text="€" />}
                      />
                    </View>
                    {idx < arr.length - 1 && <Divider />}
                  </React.Fragment>
                ))}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setPriceDialogVisible(false)}>Cancelar</Button>
            <Button
              mode="contained"
              buttonColor="#43A047"
              onPress={() => void handleOpenSession()}
              loading={opening}
              disabled={opening}
            >
              Abrir sesión
            </Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={closeDialogVisible} onDismiss={() => setCloseDialogVisible(false)}>
          <Dialog.Title>¿Cerrar sesión?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              Se cerrará la jornada en{' '}
              <Text style={styles.bold}>
                {activeSession ? locationName(activeSession.locationId) : ''}
              </Text>
              .{'\n'}Los tickets ya generados se conservan.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setCloseDialogVisible(false)}>Cancelar</Button>
            <Button
              mode="contained"
              onPress={() => void handleCloseSession()}
              loading={closing}
              disabled={closing}
              buttonColor="#E53935"
            >
              Cerrar sesión
            </Button>
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
  root: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 0,
  },

  // section labels
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: '#888',
    marginBottom: 10,
    marginTop: 4,
  },

  // open session card
  openCard: {
    borderRadius: 14,
    padding: 18,
    backgroundColor: '#fff',
    gap: 14,
    marginBottom: 28,
  },
  openCardHint: {
    fontSize: 14,
    color: '#555',
    fontWeight: '500',
  },
  openCardLocation: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
  },
  openBtn: {
    borderRadius: 10,
  },
  openBtnContent: {
    height: 52,
  },
  openBtnLabel: {
    fontSize: 16,
    fontWeight: '800',
  },

  // history header
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginTop: 4,
  },
  filterBtn: {
    borderRadius: 8,
  },
  filterBtnContent: {
    height: 36,
  },

  // history list
  historyCard: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  separator: {
    height: 10,
  },
  emptyText: {
    textAlign: 'center',
    color: '#bbb',
    fontStyle: 'italic',
    paddingVertical: 24,
    fontSize: 15,
  },

  // close dialog
  bold: {
    fontWeight: '700',
  },

  // price dialog
  priceDialogScroll: {
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
});
