// Chip compacto que muestra el estado de sincronización de una sesión y, si es
// de otro dispositivo, lo etiqueta. Se usa en las listas de historial.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import type { Session, SyncStatus } from '../lib/types';

const CONFIG: Record<SyncStatus, { color: string; bg: string; label: string }> = {
  pending:        { color: '#8A6D00', bg: '#FFF6D6', label: 'Pendiente' },
  synced:         { color: '#2E7D32', bg: '#E8F5E9', label: 'Sincronizada' },
  pending_update: { color: '#E65100', bg: '#FFF3E0', label: 'Pendiente' },
  error:          { color: '#C62828', bg: '#FFEBEE', label: 'Error' },
};

interface Props {
  session: Session;
}

export default function SessionSyncChip({ session }: Props): React.JSX.Element {
  const cfg = CONFIG[session.syncStatus] ?? CONFIG.pending;
  const isRemote = session.origin === 'remote';

  return (
    <View style={styles.wrap}>
      <View style={[styles.chip, { backgroundColor: cfg.bg }]}>
        <Text style={[styles.chipText, { color: cfg.color }]}>{cfg.label}</Text>
      </View>
      {isRemote && (
        <View style={[styles.chip, styles.remoteChip]}>
          <Text style={[styles.chipText, styles.remoteText]}>
            {session.deviceId ? `Disp. ${session.deviceId.slice(0, 4)}` : 'Otro disp.'}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 9,
  },
  chipText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  remoteChip: { backgroundColor: '#E3F2FD' },
  remoteText: { color: '#1565C0' },
});
