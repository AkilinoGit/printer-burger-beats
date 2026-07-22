import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Dialog,
  Divider,
  IconButton,
  Portal,
  Surface,
  Text,
  TouchableRipple,
} from 'react-native-paper';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { getLocations, getSessions, getTicketsBySession, markTicketPrinted } from '../../services/db';
import { printTicket } from '../../services/printer';
import { formatPrice } from '../../lib/utils';
import { useSessionStore } from '../../stores/useSessionStore';
import type { Location, Modifier, Session, SyncStatus, Ticket } from '../../lib/types';

// ---------------------------------------------------------------------------
// Modifier label map (same logic as ticket/[id].tsx)
// ---------------------------------------------------------------------------

function buildModifierMaps(modifiers: Modifier[]): {
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
// Helpers
// ---------------------------------------------------------------------------

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-ES', {
    weekday: 'short', day: '2-digit', month: '2-digit',
    year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function ticketTotal(ticket: Ticket): number {
  return ticket.orders.reduce((sum, o) => sum + o.total, 0);
}

// ---------------------------------------------------------------------------
// Sync badge
// ---------------------------------------------------------------------------

const SYNC_CONFIG: Record<SyncStatus, { color: string; bg: string; label: string }> = {
  pending:        { color: '#757575', bg: '#F5F5F5',  label: 'Pendiente' },
  synced:         { color: '#2E7D32', bg: '#E8F5E9',  label: 'Sincronizado' },
  pending_update: { color: '#E65100', bg: '#FFF3E0',  label: 'Actualización' },
  error:          { color: '#C62828', bg: '#FFEBEE',  label: 'Error sync' },
};

function SyncBadge({ status }: { status: SyncStatus }): React.JSX.Element {
  const cfg = SYNC_CONFIG[status] ?? SYNC_CONFIG.pending;
  return (
    <View style={[syncStyles.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[syncStyles.label, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

const syncStyles = StyleSheet.create({
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});

// ---------------------------------------------------------------------------
// TicketRow
// ---------------------------------------------------------------------------

interface TicketRowProps {
  ticket: Ticket;
  onPress: () => void;
  onReprint: () => void;
  reprinting: boolean;
}

function TicketRow({ ticket, onPress, onReprint, reprinting }: TicketRowProps): React.JSX.Element {
  const total      = ticketTotal(ticket);
  const orderNames = ticket.orders.map((o) => o.clientName).filter(Boolean).join(', ');
  const wasEdited  = ticket.editedAt !== null;
  const items      = ticket.orders.flatMap((o) => o.items);

  return (
    <TouchableRipple onPress={onPress} rippleColor="rgba(0,0,0,0.06)">
      <View style={rowStyles.row}>

        {/* Header line: number + client name + total + reprint */}
        <View style={rowStyles.headerLine}>
          <View style={rowStyles.headerLeft}>
            <Text style={rowStyles.number}>{`#${ticket.ticketNumber}`}</Text>
            {orderNames.length > 0 && (
              <Text style={rowStyles.names} numberOfLines={1}>{orderNames}</Text>
            )}
          </View>
          <View style={rowStyles.headerRight}>
            <Text style={rowStyles.total}>{formatPrice(total)}</Text>
            <IconButton
              icon="printer"
              size={22}
              mode="contained-tonal"
              onPress={onReprint}
              disabled={reprinting}
              style={rowStyles.printBtn}
            />
          </View>
        </View>

        {/* Created time */}
        <Text style={rowStyles.timeText}>{formatTime(ticket.createdAt)}</Text>

        {/* Items list */}
        {items.length > 0 && (
          <View style={rowStyles.itemsList}>
            {items.map((it) => (
              <View key={it.id} style={rowStyles.itemRow}>
                <Text style={rowStyles.itemQty}>x{it.qty}</Text>
                <Text style={rowStyles.itemName} numberOfLines={1}>
                  {it.customLabel ?? it.productName}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Badges */}
        <View style={rowStyles.badgeRow}>
          <SyncBadge status={ticket.syncStatus} />
          <Text style={rowStyles.ordersLabel}>
            {ticket.orders.length} pedido{ticket.orders.length !== 1 ? 's' : ''}
          </Text>
          {wasEdited && (
            <View style={rowStyles.editedBadge}>
              <Text style={rowStyles.editedText}>✏ Editado</Text>
            </View>
          )}
        </View>

      </View>
    </TouchableRipple>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 12,
    gap: 6,
  },
  headerLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    flexWrap: 'wrap',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  number: { fontSize: 17, fontWeight: '800', color: '#111' },
  names: { fontSize: 14, fontWeight: '600', color: '#1a1a1a', flexShrink: 1 },
  timeText: { fontSize: 12, color: '#888' },
  itemsList: {
    gap: 2,
    paddingLeft: 4,
    marginTop: 2,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemQty: {
    fontSize: 13,
    fontWeight: '700',
    color: '#555',
    minWidth: 28,
  },
  itemName: {
    flex: 1,
    fontSize: 13,
    color: '#333',
  },
  editedBadge: {
    backgroundColor: '#FFF8E1',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  editedText: { fontSize: 10, fontWeight: '700', color: '#F57F17' },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 2,
  },
  ordersLabel: { fontSize: 11, color: '#888' },
  total: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', textAlign: 'right' },
  printBtn: { margin: 0 },
});

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

interface SessionDetailProps {
  sessionId?: string;
}

export function SessionDetailView({ sessionId }: SessionDetailProps): React.JSX.Element {
  const params  = useLocalSearchParams<{ id: string }>();
  const id      = sessionId ?? params.id;
  const router  = useRouter();
  const storeProducts = useSessionStore((s) => s.products);
  const closeCurrentSession = useSessionStore((s) => s.closeCurrentSession);

  const [session,  setSession]  = useState<Session | null>(null);
  const [tickets,  setTickets]  = useState<Ticket[]>([]);
  const [location, setLocation] = useState<Location | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [closing,  setClosing]  = useState(false);
  const [closeDialogVisible, setCloseDialogVisible] = useState(false);
  const [reprintingId, setReprintingId] = useState<string | null>(null);

  // Modifier maps — built from store products (already loaded by _layout)
  const { labels: modifierLabels, radioNoSelection, radioOptionSets } = useMemo(
    () => buildModifierMaps(storeProducts.flatMap((p) => p.modifiers)),
    [storeProducts],
  );

  // ── load ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [allSessions, locs] = await Promise.all([getSessions(), getLocations()]);
      const found = allSessions.find((s) => s.id === id) ?? null;
      setSession(found);

      if (found) {
        const tix = await getTicketsBySession(found.id);
        // Most recent ticket first
        setTickets([...tix].sort((a, b) => b.ticketNumber - a.ticketNumber));
        setLocation(locs.find((l) => l.id === found.locationId) ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void loadData(); }, [loadData]);

  // Reload whenever the screen regains focus (needed when this view is
  // rendered inside a persistent tab and tickets are created elsewhere).
  useFocusEffect(useCallback(() => { void loadData(); }, [loadData]));

  // ── reprint ───────────────────────────────────────────────────────────────
  async function handleReprint(ticket: Ticket): Promise<void> {
    setReprintingId(ticket.id);
    try {
      const normalPrices: Record<string, number> = {};
      for (const p of storeProducts) normalPrices[p.id] = p.basePrice;
      // Desde el resumen de sesión (activa y cerrada) siempre se imprime doble:
      // una copia para cocina y otra para cliente, independientemente del ajuste
      // "Imprimir siempre 2 copias".
      const result = await printTicket(ticket, false, modifierLabels, radioNoSelection, radioOptionSets, true, normalPrices);
      if (!result.ok) {
        if (!result.cancelled) {
          Alert.alert('Error de impresión', result.error ?? 'No se pudo conectar con la impresora');
        }
        return;
      }
      await markTicketPrinted(ticket.id);
    } finally {
      setReprintingId(null);
    }
  }

  // ── close session ─────────────────────────────────────────────────────────
  async function handleCloseSession(): Promise<void> {
    setClosing(true);
    try {
      await closeCurrentSession();
      // Reload from DB so the view reflects the real persisted state.
      await loadData();
    } catch {
      Alert.alert('Error', 'No se pudo cerrar la sesión. Inténtalo de nuevo.');
    } finally {
      setClosing(false);
      setCloseDialogVisible(false);
    }
  }

  // ── render: loading ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!session) {
    return (
      <View style={styles.center}>
        <Text style={styles.notFound}>Sesión no encontrada</Text>
      </View>
    );
  }

  // ── derived ───────────────────────────────────────────────────────────────
  const isOpen     = session.status === 'open';
  const grandTotal = tickets.reduce((sum, t) => sum + ticketTotal(t), 0);
  const orderCount = tickets.reduce((s, t) => s + t.orders.length, 0);

  const ticketTimes = tickets
    .map((t) => new Date(t.createdAt).getTime())
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);
  const firstTicketAt = ticketTimes.length > 0 ? new Date(ticketTimes[0]).toISOString() : null;
  const lastTicketAt  = ticketTimes.length > 0 ? new Date(ticketTimes[ticketTimes.length - 1]).toISOString() : null;

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <FlatList
        data={tickets}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            {/* ── Summary card ───────────────────────────────────────────── */}
            <Surface style={[styles.summaryCard, isOpen && styles.summaryCardOpen]} elevation={2}>

              {/* Status badge + session code */}
              <View style={styles.badgeRow}>
                <View style={[styles.statusBadge, isOpen ? styles.statusBadgeOpen : styles.statusBadgeClosed]}>
                  <Text style={[styles.statusBadgeText, isOpen ? styles.statusTextOpen : styles.statusTextClosed]}>
                    {isOpen ? '● ACTIVA' : '◼ CERRADA'}
                  </Text>
                </View>
                {session.sessionCode != null && (
                  <Text style={styles.sessionCode}>{session.sessionCode}</Text>
                )}
              </View>

              {/* Location */}
              <Text style={styles.locationName}>{location?.name ?? '—'}</Text>

              {/* Apertura */}
              <View style={styles.metaCol}>
                <Text style={styles.metaLabel}>Apertura</Text>
                <Text style={styles.metaValue}>{formatDateTime(session.openedAt ?? session.createdAt)}</Text>
              </View>

              {/* Tickets + Total */}
              <View style={styles.metaRow}>
                <View style={styles.metaCol}>
                  <Text style={styles.metaLabel}>Tickets</Text>
                  <Text style={styles.metaValue}>{tickets.length}</Text>
                </View>
                <View style={styles.metaCol}>
                  <Text style={styles.metaLabel}>Total</Text>
                  {/* ============================================================
                      ===== TEMPORAL: TOTAL MULTIPLICADO POR 0.7 (REVERTIR) =====
                      ===== Quitar el * 0.7 para volver al total real        =====
                      ============================================================ */}
                  <Text style={[styles.metaValue, styles.grandTotal]}>{formatPrice(grandTotal)}</Text>
                </View>
              </View>

              {/* 1er pedido / Último pedido */}
              {tickets.length > 0 && (
                <View style={styles.metaRow}>
                  <View style={styles.metaCol}>
                    <Text style={styles.metaLabel}>1er pedido</Text>
                    <Text style={styles.metaValue}>{formatTime(firstTicketAt)}</Text>
                  </View>
                  <View style={styles.metaCol}>
                    <Text style={styles.metaLabel}>Último pedido</Text>
                    <Text style={styles.metaValue}>{formatTime(lastTicketAt)}</Text>
                  </View>
                </View>
              )}

              {/* Comentario de la jornada, si lo hay */}
              {session.notes != null && session.notes.trim() !== '' && (
                <View style={styles.notesBox}>
                  <Text style={styles.notesText}>{session.notes}</Text>
                </View>
              )}

              {/* Auto-close / closed notice */}
              {isOpen ? (
                <Text style={styles.autoCloseNote}>
                  La sesión se cierra automáticamente mañana a las 12:00
                </Text>
              ) : session.closedAt != null ? (
                <Text style={styles.closedNote}>
                  Cerrada el {formatDateTime(session.closedAt)}
                </Text>
              ) : null}

              {/* Ver resumen — always visible */}
              <Button
                mode="contained-tonal"
                icon="chart-bar"
                onPress={() => router.push(`/session/summary/${session.id}`)}
                style={styles.summaryBtn}
                contentStyle={styles.closeBtnContent}
              >
                Ver resumen
              </Button>

              {/* Editar sesión — notas, ubicación, precios y borrado */}
              <Button
                mode="outlined"
                icon="pencil"
                onPress={() => router.push(`/session/edit/${session.id}`)}
                style={styles.summaryBtn}
                contentStyle={styles.closeBtnContent}
              >
                Editar sesión
              </Button>

              {/* Fusionar con otra sesión — solo entre jornadas ya cerradas */}
              {!isOpen && (
                <Button
                  mode="outlined"
                  icon="call-merge"
                  onPress={() => router.push(`/session/merge/${session.id}`)}
                  style={styles.summaryBtn}
                  contentStyle={styles.closeBtnContent}
                >
                  Fusionar con otra sesión
                </Button>
              )}

              {/* Close button (only when active) */}
              {isOpen && (
                <Button
                  mode="outlined"
                  icon="stop-circle"
                  onPress={() => setCloseDialogVisible(true)}
                  textColor="#E53935"
                  style={styles.closeBtn}
                  contentStyle={styles.closeBtnContent}
                >
                  Cerrar sesión
                </Button>
              )}

              {/* History button — only when active, to reach closed sessions */}
              {isOpen && (
                <Button
                  mode="outlined"
                  icon="history"
                  onPress={() => router.push('/sessions-history')}
                  style={styles.summaryBtn}
                  contentStyle={styles.closeBtnContent}
                >
                  Ver historial de sesiones
                </Button>
              )}
            </Surface>

            {/* Tickets section header */}
            {tickets.length > 0 && (
              <Text style={styles.sectionLabel}>TICKETS</Text>
            )}
          </>
        }
        renderItem={({ item }) => (
          <Surface style={styles.ticketCard} elevation={1}>
            <TicketRow
              ticket={item}
              onPress={() => router.push(`/ticket/${item.id}`)}
              onReprint={() => void handleReprint(item)}
              reprinting={reprintingId === item.id}
            />
          </Surface>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <Text style={styles.emptyText}>Esta sesión no tiene tickets</Text>
        }
      />

      {/* Close confirmation dialog */}
      <Portal>
        <Dialog visible={closeDialogVisible} onDismiss={() => setCloseDialogVisible(false)}>
          <Dialog.Title>¿Cerrar sesión?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              Se cerrará la jornada en{' '}
              <Text style={styles.bold}>{location?.name ?? ''}</Text>
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

export default function SessionDetailScreen(): React.JSX.Element {
  return <SessionDetailView />;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notFound: { fontSize: 16, color: '#888' },

  listContent: {
    padding: 16,
    paddingBottom: 40,
  },

  // summary card
  summaryCard: {
    borderRadius: 14,
    padding: 18,
    backgroundColor: '#fff',
    gap: 12,
    marginBottom: 20,
  },
  summaryCardOpen: {
    borderLeftWidth: 4,
    borderLeftColor: '#43A047',
  },

  // status badge
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  statusBadgeOpen:   { backgroundColor: '#E8F5E9' },
  statusBadgeClosed: { backgroundColor: '#F5F5F5' },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  statusTextOpen:   { color: '#2E7D32' },
  statusTextClosed: { color: '#757575' },
  sessionCode: {
    fontSize: 13,
    color: '#1565C0',
    fontWeight: '700',
  },

  // location
  locationName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111',
  },

  // meta row (apertura + tickets + total)
  metaRow: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  metaCol: { gap: 2, minWidth: 70 },
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
  grandTotal: { color: '#1565C0' },

  autoCloseNote: {
    fontSize: 12,
    color: '#888',
    fontStyle: 'italic',
  },
  closedNote: {
    fontSize: 12,
    color: '#888',
    fontStyle: 'italic',
  },

  // notas de la jornada
  notesBox: {
    backgroundColor: '#FFF8E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  notesText: {
    fontSize: 14,
    color: '#5D4A00',
    lineHeight: 20,
  },

  // close button
  summaryBtn: {
    borderRadius: 8,
  },
  closeBtn: {
    borderColor: '#E53935',
    borderRadius: 8,
  },
  closeBtnContent: { height: 48 },

  // tickets list
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: '#888',
    marginBottom: 10,
  },
  ticketCard: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  separator: { height: 10 },
  emptyText: {
    textAlign: 'center',
    color: '#bbb',
    fontStyle: 'italic',
    paddingVertical: 24,
    fontSize: 15,
  },

  bold: { fontWeight: '700' },
});
