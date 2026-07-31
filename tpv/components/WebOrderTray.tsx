import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Surface, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { formatPrice } from '../lib/utils';
import type { Ticket } from '../lib/types';
import { reprintWebTicket } from '../services/webOrders';
import { useWebOrdersStore } from '../stores/useWebOrdersStore';

// ---------------------------------------------------------------------------
// WebOrderTray — comandas que entraron por la web y NO llegaron a imprimirse.
//
// El pedido nunca se pierde por un fallo de Bluetooth: la comanda ya está
// guardada en la jornada (cuenta para la caja) y aquí se reintenta la impresión.
// Ver tpv-web-orders-plan.md §3.3.
//
// Si no hay nada pendiente, no ocupa espacio en pantalla.
// ---------------------------------------------------------------------------

export default function WebOrderTray(): React.JSX.Element | null {
  const unprinted = useWebOrdersStore((s) => s.unprinted);
  const [reprintingId, setReprintingId] = useState<string | null>(null);

  if (unprinted.length === 0) return null;

  async function handleReprint(ticket: Ticket): Promise<void> {
    setReprintingId(ticket.id);
    try {
      await reprintWebTicket(ticket);
    } finally {
      setReprintingId(null);
    }
  }

  return (
    <Surface style={styles.card} elevation={2}>
      <View style={styles.header}>
        <MaterialCommunityIcons name="printer-alert" size={24} color="#C62828" />
        <Text style={styles.headerText}>
          PEDIDOS WEB SIN IMPRIMIR ({unprinted.length})
        </Text>
      </View>

      <Text style={styles.help}>
        Ya están guardados en la jornada. Solo falta sacarlos por la impresora.
      </Text>

      {unprinted.map((ticket) => {
        const order = ticket.orders[0];
        const total = ticket.orders.reduce((sum, o) => sum + o.total, 0);

        return (
          <View key={ticket.id} style={styles.row}>
            <View style={styles.info}>
              <Text style={styles.name}>
                #{ticket.ticketNumber} · {order?.clientName ?? 'Pedido web'}
              </Text>
              <Text style={styles.total}>{formatPrice(total)}</Text>
            </View>

            <Button
              mode="contained"
              icon="printer"
              onPress={() => void handleReprint(ticket)}
              loading={reprintingId === ticket.id}
              disabled={reprintingId !== null}
              buttonColor="#C62828"
              style={styles.button}
            >
              Imprimir
            </Button>
          </View>
        );
      })}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFEBEE',
    borderRadius: 12,
    marginBottom: 12,
    marginHorizontal: 12,
    padding: 14,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  headerText: {
    color: '#C62828',
    fontSize: 15,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  help: {
    color: '#7F3B3B',
    fontSize: 13,
    marginBottom: 10,
    marginTop: 4,
  },
  row: {
    alignItems: 'center',
    borderTopColor: '#F2C7C7',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 8,
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
  },
  total: {
    color: '#555555',
    fontSize: 14,
  },
  button: {
    borderRadius: 8,
  },
});
