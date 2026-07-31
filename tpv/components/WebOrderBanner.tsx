import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Surface, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { formatPrice } from '../lib/utils';
import { useWebOrdersStore } from '../stores/useWebOrdersStore';

// ---------------------------------------------------------------------------
// WebOrderBanner — aviso de que ha entrado un pedido desde la web.
//
// El pedido ya está impreso cuando esto aparece (ver services/webOrders.ts): el
// banner NO es una confirmación, es un aviso para que nadie se pierda una
// comanda que ha salido sola por la impresora. Va acompañado de vibración desde
// el store.
//
// Si la impresión falló, cambia a rojo y avisa de que hay que reimprimir desde
// la bandeja de la pantalla de sesión.
// ---------------------------------------------------------------------------

export default function WebOrderBanner(): React.JSX.Element | null {
  const visible = useWebOrdersStore((s) => s.bannerVisible);
  const recent = useWebOrdersStore((s) => s.recent);
  const dismiss = useWebOrdersStore((s) => s.dismissBanner);

  const latest = recent[0] ?? null;

  if (!visible || !latest) return null;

  const failed = !latest.printed;

  return (
    <Surface style={[styles.card, failed && styles.cardFailed]} elevation={4}>
      <View style={styles.row}>
        <MaterialCommunityIcons
          name={failed ? 'printer-alert' : 'web'}
          size={32}
          color="#FFFFFF"
        />

        <View style={styles.texts}>
          <Text style={styles.title}>
            {failed ? 'PEDIDO WEB SIN IMPRIMIR' : 'PEDIDO WEB'}
          </Text>

          <Text style={styles.subtitle}>
            #{latest.ticketNumber} · {latest.customerName} · {formatPrice(latest.total)}
          </Text>

          {failed ? (
            <Text style={styles.warning}>
              Reimprime desde la bandeja en la pantalla de sesión.
            </Text>
          ) : null}
        </View>
      </View>

      <Button
        mode="contained"
        onPress={dismiss}
        buttonColor="#FFFFFF"
        textColor={failed ? '#C62828' : '#1565C0'}
        style={styles.button}
        labelStyle={styles.buttonLabel}
      >
        Vale
      </Button>
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1565C0',
    borderRadius: 12,
    marginHorizontal: 12,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  cardFailed: {
    backgroundColor: '#C62828',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
  },
  texts: {
    flex: 1,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  subtitle: {
    color: '#FFFFFF',
    fontSize: 16,
    marginTop: 2,
  },
  warning: {
    color: '#FFFFFF',
    fontSize: 14,
    fontStyle: 'italic',
    marginTop: 4,
  },
  button: {
    alignSelf: 'flex-end',
    marginTop: 10,
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: 'bold',
  },
});
