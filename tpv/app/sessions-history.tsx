import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Divider,
  Menu,
  Surface,
  Text,
  TouchableRipple,
} from 'react-native-paper';
import { useRouter } from 'expo-router';

import { getLocations, getSessionSummary, getSessions } from '../services/db';
import { formatPrice } from '../lib/utils';
import type { Location, Session } from '../lib/types';

const ALL_LOCATIONS = '__all__';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES', {
    weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

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

export default function SessionsHistoryScreen(): React.JSX.Element {
  const router = useRouter();

  const [locations, setLocations] = useState<Location[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterLocationId, setFilterLocationId] = useState<string>(ALL_LOCATIONS);
  const [filterMenuVisible, setFilterMenuVisible] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [locs, allSessions] = await Promise.all([
        getLocations(),
        getSessions(),
      ]);
      setLocations(locs);
      setSessions(allSessions.filter((s) => s.status === 'closed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  function locationName(id: string): string {
    return locations.find((l) => l.id === id)?.name ?? id;
  }

  const filteredSessions = filterLocationId === ALL_LOCATIONS
    ? sessions
    : sessions.filter((s) => s.locationId === filterLocationId);

  const filterLabel = filterLocationId === ALL_LOCATIONS
    ? 'Todas las ubicaciones'
    : locationName(filterLocationId);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={filteredSessions}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
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
        ListEmptyComponent={
          <Text style={styles.emptyText}>No hay sesiones cerradas</Text>
        }
      />
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 16, paddingBottom: 40 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: '#888',
    marginBottom: 10,
    marginTop: 4,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginTop: 4,
  },
  filterBtn: { borderRadius: 8 },
  filterBtnContent: { height: 36 },
  historyCard: {
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
