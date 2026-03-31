import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Divider,
  Surface,
  Text,
  TouchableRipple,
} from 'react-native-paper';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { getLocations, getSessionByCode, getSessions, getTicketsBySession } from '../../services/db';
import { formatPrice } from '../../lib/utils';
import type { Location, Session, Ticket } from '../../lib/types';

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

function ticketTotal(ticket: Ticket): number {
  return ticket.orders.reduce((sum, o) => sum + o.total, 0);
}

// ---------------------------------------------------------------------------
// TicketRow
// ---------------------------------------------------------------------------

function TicketRow({ ticket, onPress }: { ticket: Ticket; onPress: () => void }): React.JSX.Element {
  const total = ticketTotal(ticket);
  const orderNames = ticket.orders.map((o) => o.clientName).join(', ');

  return (
    <TouchableRipple onPress={onPress} rippleColor="rgba(0,0,0,0.06)">
      <View style={rowStyles.row}>
        <View style={rowStyles.left}>
          <Text style={rowStyles.number}>#{ticket.ticketNumber}</Text>
          {orderNames.length > 0 && (
            <Text style={rowStyles.names} numberOfLines={1}>{orderNames}</Text>
          )}
          <Text style={rowStyles.orders}>
            {ticket.orders.length} pedido{ticket.orders.length !== 1 ? 's' : ''}
            {ticket.printedAt ? '' : '  ·  Sin imprimir'}
          </Text>
        </View>
        <Text style={rowStyles.total}>{formatPrice(total)}</Text>
      </View>
    </TouchableRipple>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  left: { flex: 1, gap: 3 },
  number: { fontSize: 16, fontWeight: '800', color: '#111' },
  names: { fontSize: 13, color: '#555' },
  orders: { fontSize: 12, color: '#888' },
  total: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
});

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function SessionDetailScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [session, setSession]   = useState<Session | null>(null);
  const [tickets, setTickets]   = useState<Ticket[]>([]);
  const [location, setLocation] = useState<Location | null>(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        // getSessions returns all; find by id
        const all = await getSessions();
        const found = all.find((s) => s.id === id) ?? null;
        setSession(found);

        if (found) {
          const [locs, tix] = await Promise.all([
            getLocations(),
            getTicketsBySession(found.id),
          ]);
          setLocation(locs.find((l) => l.id === found.locationId) ?? null);
          setTickets(tix);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

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

  const grandTotal = tickets.reduce((sum, t) => sum + ticketTotal(t), 0);
  const isOpen = session.status === 'open';

  return (
    <FlatList
      data={tickets}
      keyExtractor={(t) => t.id}
      contentContainerStyle={styles.listContent}
      ListHeaderComponent={
        <>
          {/* Session summary card */}
          <Surface style={[styles.summaryCard, isOpen && styles.summaryCardOpen]} elevation={2}>
            <View style={styles.summaryBadgeRow}>
              <View style={[styles.badge, isOpen ? styles.badgeOpen : styles.badgeClosed]}>
                <Text style={[styles.badgeText, isOpen ? styles.badgeTextOpen : styles.badgeTextClosed]}>
                  {isOpen ? '● ACTIVA' : '◼ CERRADA'}
                </Text>
              </View>
              {session.sessionCode && (
                <Text style={styles.sessionCode}>{session.sessionCode}</Text>
              )}
            </View>

            <Text style={styles.locationName}>{location?.name ?? '—'}</Text>

            <View style={styles.metaGrid}>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Apertura</Text>
                <Text style={styles.metaValue}>{formatDateTime(session.openedAt ?? session.createdAt)}</Text>
              </View>
              {session.closedAt && (
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>Cierre</Text>
                  <Text style={styles.metaValue}>{formatDateTime(session.closedAt)}</Text>
                </View>
              )}
              {isOpen && session.autoCloseAt && (
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>Cierre automático</Text>
                  <Text style={styles.metaValue}>{formatDateTime(session.autoCloseAt)}</Text>
                </View>
              )}
            </View>

            <Divider style={styles.divider} />

            <View style={styles.totalsRow}>
              <View style={styles.totalItem}>
                <Text style={styles.totalLabel}>Tickets</Text>
                <Text style={styles.totalValue}>{tickets.length}</Text>
              </View>
              <View style={styles.totalItem}>
                <Text style={styles.totalLabel}>Pedidos</Text>
                <Text style={styles.totalValue}>
                  {tickets.reduce((s, t) => s + t.orders.length, 0)}
                </Text>
              </View>
              <View style={styles.totalItem}>
                <Text style={styles.totalLabel}>Total sesión</Text>
                <Text style={[styles.totalValue, styles.grandTotal]}>{formatPrice(grandTotal)}</Text>
              </View>
            </View>
          </Surface>

          {/* Tickets header */}
          {tickets.length > 0 && (
            <Text style={styles.ticketsLabel}>TICKETS</Text>
          )}
        </>
      }
      renderItem={({ item }) => (
        <Surface style={styles.ticketCard} elevation={1}>
          <TicketRow
            ticket={item}
            onPress={() => router.push(`/ticket/${item.id}`)}
          />
        </Surface>
      )}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListEmptyComponent={
        <Text style={styles.emptyText}>Esta sesión no tiene tickets</Text>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notFound: {
    fontSize: 16,
    color: '#888',
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 0,
  },

  // summary card
  summaryCard: {
    borderRadius: 14,
    padding: 18,
    backgroundColor: '#fff',
    gap: 10,
    marginBottom: 20,
  },
  summaryCardOpen: {
    borderLeftWidth: 4,
    borderLeftColor: '#43A047',
  },
  summaryBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  badgeOpen: { backgroundColor: '#E8F5E9' },
  badgeClosed: { backgroundColor: '#F5F5F5' },
  badgeText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  badgeTextOpen: { color: '#2E7D32' },
  badgeTextClosed: { color: '#757575' },
  sessionCode: {
    fontSize: 13,
    color: '#1565C0',
    fontWeight: '700',
  },
  locationName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111',
  },
  metaGrid: {
    gap: 8,
    marginTop: 4,
  },
  metaItem: { gap: 2 },
  metaLabel: {
    fontSize: 11,
    color: '#888',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metaValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  divider: { marginVertical: 4 },
  totalsRow: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap',
  },
  totalItem: { gap: 2 },
  totalLabel: {
    fontSize: 11,
    color: '#888',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  totalValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1a1a1a',
  },
  grandTotal: {
    color: '#1565C0',
  },

  // tickets list
  ticketsLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: '#888',
    marginBottom: 10,
    marginTop: 4,
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
});
