import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Divider, Surface, Text } from 'react-native-paper';
import { formatPrice } from '../lib/utils';
import type { OrderItem } from '../lib/types';

interface Props {
  items: OrderItem[];
  total: number;
  onViewOrder: () => void;
}

export default function CartSummary({ items, total, onViewOrder }: Props): React.JSX.Element {
  const itemCount = items.reduce((acc, i) => acc + i.qty, 0);
  const hasItems  = itemCount > 0;
  const canProceed = hasItems;

  return (
    <Surface style={styles.surface} elevation={8}>
      <Divider />
      <View style={styles.row}>
        <View style={styles.info}>
          {hasItems ? (
            <>
              <Text style={styles.count}>
                {itemCount} {itemCount === 1 ? 'producto' : 'productos'}
              </Text>
              <Text style={styles.total}>{formatPrice(total)}</Text>
            </>
          ) : (
            <Text style={styles.empty}>Carrito vacío</Text>
          )}
        </View>

        <Button
          mode="contained"
          onPress={onViewOrder}
          disabled={!canProceed}
          style={styles.btn}
          contentStyle={styles.btnContent}
          labelStyle={styles.btnLabel}
          buttonColor="#E53935"
        >
          Ver pedido
        </Button>
      </View>

    </Surface>
  );
}

const styles = StyleSheet.create({
  surface: {
    backgroundColor: '#fff',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  info: {
    flex: 1,
  },
  count: {
    fontSize: 13,
    color: '#666',
  },
  total: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1a1a1a',
  },
  empty: {
    fontSize: 15,
    color: '#bbb',
    fontStyle: 'italic',
  },
  btn: {
    minWidth: 140,
  },
  btnContent: {
    height: 52,
  },
  btnLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
  hint: {
    fontSize: 12,
    color: '#E53935',
    textAlign: 'center',
    paddingBottom: 8,
    paddingHorizontal: 16,
  },
});
