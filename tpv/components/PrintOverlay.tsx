import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Surface, Text } from 'react-native-paper';

import { usePrintJobStore } from '../stores/usePrintJobStore';

// ---------------------------------------------------------------------------
// PrintOverlay — global, mounted once in the root layout.
//
// Shows while any print is being sent to the printer: a live millisecond
// counter and a Cancel button. It disappears on its own as soon as the send
// completes; the Cancel button is there to abort a hung/failed connection.
// ---------------------------------------------------------------------------

export default function PrintOverlay(): React.JSX.Element {
  const visible         = usePrintJobStore((s) => s.visible);
  const startedAt       = usePrintJobStore((s) => s.startedAt);
  const cancelRequested = usePrintJobStore((s) => s.cancelRequested);
  const requestCancel   = usePrintJobStore((s) => s.requestCancel);

  // Live elapsed-ms counter while the overlay is visible.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const update = () => setElapsed(Date.now() - startedAt);
    update();
    const id = setInterval(update, 33);
    return () => clearInterval(id);
  }, [visible, startedAt]);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={requestCancel}>
      <View style={styles.backdrop}>
        <Surface style={styles.card} elevation={5}>
          <ActivityIndicator size="large" color="#1E88E5" />

          <Text style={styles.title}>
            {cancelRequested ? 'Cancelando…' : 'Enviando a la impresora…'}
          </Text>

          <Text style={styles.ms}>{elapsed} ms</Text>

          <Button
            mode="contained"
            onPress={requestCancel}
            disabled={cancelRequested}
            buttonColor="#E53935"
            icon="cancel"
            style={styles.cancelBtn}
            contentStyle={styles.cancelBtnContent}
            labelStyle={styles.cancelBtnLabel}
          >
            {cancelRequested ? 'Cancelando…' : 'Cancelar'}
          </Button>
        </Surface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 14,
  },
  title: { fontSize: 16, fontWeight: '700', color: '#111', textAlign: 'center' },
  ms: {
    fontSize: 34,
    fontWeight: '800',
    color: '#1E88E5',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.5,
  },
  cancelBtn: { borderRadius: 10, alignSelf: 'stretch', marginTop: 4 },
  cancelBtnContent: { height: 52 },
  cancelBtnLabel: { fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
});
