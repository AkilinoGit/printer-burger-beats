// Fusión de sesiones — parte de la Fase 3 del CRUD de sesiones.
//
// La sesión que se abre aquí (por su id) es la que SOBREVIVE: absorbe los tickets
// de otra sesión cerrada que el usuario elige de la lista. La elegida se borra
// (soft delete) y sus tickets se renumeran dentro de la superviviente.
// Solo se ofrecen sesiones CERRADAS (decisión 2026-07-22) — así nunca se toca la
// jornada activa. Todo el trabajo pesado vive en db.mergeSessions(); aquí solo se
// elige, se confirma y se dispara el sync. Ver tpv-sessions-sync-plan.md §3.

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Dialog,
  Portal,
  Surface,
  Text,
  TouchableRipple,
} from 'react-native-paper';
import { useLocalSearchParams, useRouter } from 'expo-router';

import {
  getLocations,
  getSessionById,
  getSessionSummary,
  getSessions,
  mergeSessions,
} from '../../../services/db';
import { syncSessions } from '../../../services/sessionsApi';
import { formatPrice } from '../../../lib/utils';
import type { Location, Session } from '../../../lib/types';

/** Lanza un sync en segundo plano; los errores se ignoran (se reintenta luego). */
function fireSync(): void {
  void syncSessions().catch(() => {});
}

interface Summary {
  ticketCount: number;
  total: number;
}

interface Candidate {
  session: Session;
  summary: Summary;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES', {
    weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

export default function SessionMergeScreen(): React.JSX.Element {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [target, setTarget] = useState<Session | null>(null);
  const [targetSummary, setTargetSummary] = useState<Summary>({ ticketCount: 0, total: 0 });
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<Candidate | null>(null);
  const [merging, setMerging] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [found, all, locs, tgtSum] = await Promise.all([
        getSessionById(id),
        getSessions(),
        getLocations(),
        getSessionSummary(id),
      ]);
      setTarget(found);
      setTargetSummary({ ticketCount: tgtSum.ticketCount, total: tgtSum.total });
      setLocations(locs);

      // Candidatas: cerradas, distintas de la destino (getSessions ya excluye borradas).
      const others = all.filter((s) => s.id !== id && s.status === 'closed');
      const withSummaries = await Promise.all(
        others.map(async (s) => ({ session: s, summary: await getSessionSummary(s.id) })),
      );
      setCandidates(withSummaries.map((c) => ({ session: c.session, summary: { ticketCount: c.summary.ticketCount, total: c.summary.total } })));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const locationName = (lid: string): string =>
    locations.find((l) => l.id === lid)?.name ?? lid;

  async function handleMerge(): Promise<void> {
    if (!target || !selected) return;
    setMerging(true);
    try {
      await mergeSessions(target.id, selected.session.id);
      fireSync();
      setSelected(null);
      // Volvemos al detalle de la superviviente, que recarga sus tickets al enfocar.
      router.back();
    } catch {
      Alert.alert('Error', 'No se pudo fusionar la sesión. Inténtalo de nuevo.');
    } finally {
      setMerging(false);
    }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" /></View>;
  }
  if (!target) {
    return <View style={styles.center}><Text style={styles.notFound}>Sesión no encontrada</Text></View>;
  }
  if (target.status === 'open') {
    return (
      <View style={styles.center}>
        <Text style={styles.notFound}>Cierra la sesión antes de fusionarla</Text>
      </View>
    );
  }

  const targetLabel = target.sessionCode ?? formatDate(target.openedAt ?? target.createdAt);

  return (
    <View style={styles.root}>
      <FlatList
        data={candidates}
        keyExtractor={(c) => c.session.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            <Surface style={styles.targetCard} elevation={1}>
              <Text style={styles.targetLabel}>SESIÓN QUE SE CONSERVA</Text>
              <Text style={styles.targetTitle}>{targetLabel}</Text>
              <Text style={styles.targetMeta}>
                {locationName(target.locationId)} · {targetSummary.ticketCount} ticket{targetSummary.ticketCount !== 1 ? 's' : ''} · {formatPrice(targetSummary.total)}
              </Text>
              <Text style={styles.targetHint}>
                Los tickets de la sesión que elijas se moverán aquí y se renumerarán a
                continuación. La sesión elegida se eliminará.
              </Text>
            </Surface>

            <Text style={styles.sectionLabel}>ELIGE LA SESIÓN A ABSORBER</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Surface style={styles.card} elevation={1}>
            <TouchableRipple onPress={() => setSelected(item)} rippleColor="rgba(0,0,0,0.06)">
              <View style={styles.cardRow}>
                <View style={styles.cardLeft}>
                  <Text style={styles.cardDate}>{formatDate(item.session.openedAt ?? item.session.createdAt)}</Text>
                  <Text style={styles.cardLocation}>{locationName(item.session.locationId)}</Text>
                  {item.session.sessionCode && (
                    <Text style={styles.cardCode}>{item.session.sessionCode}</Text>
                  )}
                </View>
                <View style={styles.cardRight}>
                  <Text style={styles.cardTotal}>{formatPrice(item.summary.total)}</Text>
                  <Text style={styles.cardTickets}>
                    {item.summary.ticketCount} ticket{item.summary.ticketCount !== 1 ? 's' : ''}
                  </Text>
                </View>
              </View>
            </TouchableRipple>
          </Surface>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No hay otras sesiones cerradas para fusionar</Text>
        }
      />

      {/* Confirmación */}
      <Portal>
        <Dialog visible={selected !== null} onDismiss={() => setSelected(null)}>
          <Dialog.Title>¿Fusionar estas sesiones?</Dialog.Title>
          <Dialog.Content>
            {selected && (
              <Text variant="bodyMedium">
                Se moverán{' '}
                <Text style={styles.bold}>
                  {selected.summary.ticketCount} ticket{selected.summary.ticketCount !== 1 ? 's' : ''}
                </Text>
                {' '}de{' '}
                <Text style={styles.bold}>
                  {selected.session.sessionCode ?? formatDate(selected.session.openedAt ?? selected.session.createdAt)}
                </Text>
                {' '}a{' '}
                <Text style={styles.bold}>{targetLabel}</Text>.
                {'\n\n'}La sesión origen se eliminará del historial. Esta acción se
                sincroniza con el resto de dispositivos.
              </Text>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setSelected(null)} disabled={merging}>Cancelar</Button>
            <Button
              mode="contained"
              onPress={() => void handleMerge()}
              loading={merging}
              disabled={merging}
            >
              Fusionar
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notFound: { fontSize: 16, color: '#888' },
  listContent: { padding: 16, paddingBottom: 40 },

  targetCard: {
    borderRadius: 12,
    backgroundColor: '#fff',
    padding: 16,
    gap: 4,
    borderLeftWidth: 4,
    borderLeftColor: '#43A047',
    marginBottom: 20,
  },
  targetLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: '#2E7D32',
  },
  targetTitle: { fontSize: 20, fontWeight: '800', color: '#111' },
  targetMeta: { fontSize: 13, color: '#555' },
  targetHint: { fontSize: 12, color: '#888', marginTop: 6, lineHeight: 17 },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: '#888',
    marginBottom: 10,
  },

  card: { borderRadius: 12, overflow: 'hidden', backgroundColor: '#fff' },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  cardLeft: { flex: 1, gap: 3 },
  cardRight: { alignItems: 'flex-end', gap: 3 },
  cardDate: { fontSize: 15, fontWeight: '700', color: '#111' },
  cardLocation: { fontSize: 13, color: '#666' },
  cardCode: { fontSize: 12, color: '#1565C0', fontWeight: '600' },
  cardTotal: { fontSize: 16, fontWeight: '800', color: '#1a1a1a' },
  cardTickets: { fontSize: 12, color: '#888' },

  separator: { height: 10 },
  emptyText: {
    textAlign: 'center',
    color: '#bbb',
    fontStyle: 'italic',
    paddingVertical: 24,
    fontSize: 15,
  },
  bold: { fontWeight: '800' },
});
