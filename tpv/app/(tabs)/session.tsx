import React, { useCallback, useEffect, useState } from 'react';
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
}

function SessionCard({ session, locationName, onPress }: SessionCardProps): React.JSX.Element {
  const [summary, setSummary] = useState<{ ticketCount: number; total: number }>({ ticketCount: 0, total: 0 });

  useEffect(() => {
    getSessionSummary(session.id).then(setSummary).catch(() => {});
  }, [session.id]);

  return (
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
  );
}

const cardStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
    gap: 8,
  },
  left: { flex: 1, gap: 3 },
  right: { alignItems: 'flex-end', gap: 3 },
  date: { fontSize: 15, fontWeight: '700', color: '#111' },
  location: { fontSize: 13, color: '#666' },
  code: { fontSize: 12, color: '#1565C0', fontWeight: '600' },
  total: { fontSize: 16, fontWeight: '800', color: '#1a1a1a' },
  tickets: { fontSize: 12, color: '#888' },
});

// ---------------------------------------------------------------------------
// ActiveSessionCard
// ---------------------------------------------------------------------------

interface ActiveSessionCardProps {
  session: Session;
  locationName: string;
  onViewTickets: () => void;
  onCloseRequest: () => void;
}

function ActiveSessionCard({ session, locationName, onViewTickets, onCloseRequest }: ActiveSessionCardProps): React.JSX.Element {
  const [summary, setSummary] = useState<{ ticketCount: number; total: number }>({ ticketCount: 0, total: 0 });

  useEffect(() => {
    getSessionSummary(session.id).then(setSummary).catch(() => {});
  }, [session.id]);
  const openedAt = session.openedAt ?? session.createdAt;
  const autoCloseAt = session.autoCloseAt;

  return (
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
          <Text style={activeStyles.metaLabel}>Cierre automático</Text>
          <Text style={activeStyles.metaValue}>{formatDate(autoCloseAt)}</Text>
          <Text style={activeStyles.metaTime}>{formatTime(autoCloseAt)}</Text>
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

      {/* Actions */}
      <View style={activeStyles.actions}>
        <Button
          mode="contained"
          icon="receipt"
          onPress={onViewTickets}
          style={activeStyles.btn}
          contentStyle={activeStyles.btnContent}
          buttonColor="#1E88E5"
        >
          Ver tickets
        </Button>
        <Button
          mode="outlined"
          icon="stop-circle"
          onPress={onCloseRequest}
          contentStyle={activeStyles.btnContent}
          textColor="#E53935"
          style={[activeStyles.btn, activeStyles.closeBtn]}
        >
          Cerrar sesión
        </Button>
      </View>
    </Surface>
  );
}

const activeStyles = StyleSheet.create({
  card: {
    borderRadius: 14,
    padding: 18,
    backgroundColor: '#fff',
    gap: 10,
    marginBottom: 24,
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
  },
  metaCol: {
    gap: 2,
    minWidth: 70,
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
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
    flexWrap: 'wrap',
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

  // ── local state ───────────────────────────────────────────────────────────
  const [locations, setLocations]               = useState<Location[]>([]);
  const [sessions, setSessions]                 = useState<Session[]>([]);
  const [loading, setLoading]                   = useState(true);
  const [opening, setOpening]                   = useState(false);
  const [closing, setClosing]                   = useState(false);
  const [closeDialogVisible, setCloseDialogVisible] = useState(false);

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

  // ── open session ──────────────────────────────────────────────────────────
  async function handleOpenSession(): Promise<void> {
    const loc = locations.find((l) => l.id === selectedLocationId);
    if (!loc) return;
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
      const session = await insertSession(loc.id);
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
                  onViewTickets={() => router.push(`/session/${activeSession.id}`)}
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
                    onPress={() => void handleOpenSession()}
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
            />
          </Surface>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      <Portal>
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
});
