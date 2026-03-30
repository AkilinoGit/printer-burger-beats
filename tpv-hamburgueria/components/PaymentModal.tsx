import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Dialog, Divider, Portal, Text, TextInput } from 'react-native-paper';
import { calcChange, formatPrice } from '../lib/utils';

interface Props {
  visible: boolean;
  total: number;
  onConfirm: (amountPaid: number, change: number) => void;
  onDismiss: () => void;
}

export default function PaymentModal({ visible, total, onConfirm, onDismiss }: Props): React.JSX.Element {
  const [amountStr, setAmountStr] = useState('');

  // Reset input each time the modal opens
  useEffect(() => {
    if (visible) setAmountStr('');
  }, [visible]);

  const amountNum = parseFloat(amountStr.replace(',', '.'));
  const isValidAmount = !isNaN(amountNum) && amountNum >= 0;
  const change = isValidAmount ? calcChange(total, amountNum) : null;
  const canConfirm = change !== null; // change === null means amountPaid < total

  function handleConfirm(): void {
    if (change === null || !isValidAmount) return;
    onConfirm(amountNum, change);
  }

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={styles.dialog}>
        <Dialog.Title style={styles.title}>Cobrar</Dialog.Title>

        <Dialog.Content>
          {/* Total a pagar */}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>TOTAL</Text>
            <Text style={styles.totalAmount}>{formatPrice(total)}</Text>
          </View>

          <Divider style={styles.divider} />

          {/* Importe entregado */}
          <TextInput
            label="Importe entregado (€)"
            value={amountStr}
            onChangeText={(v) => setAmountStr(v)}
            mode="outlined"
            keyboardType="decimal-pad"
            autoFocus
            style={styles.input}
            error={amountStr.length > 0 && !canConfirm}
          />

          {/* Cambio — se muestra en tiempo real */}
          <View style={styles.changeRow}>
            <Text style={styles.changeLabel}>Cambio</Text>
            {change !== null ? (
              <Text style={styles.changeAmount}>{formatPrice(change)}</Text>
            ) : amountStr.length > 0 && isValidAmount ? (
              <Text style={styles.changeInsufficient}>Importe insuficiente</Text>
            ) : (
              <Text style={styles.changePlaceholder}>—</Text>
            )}
          </View>
        </Dialog.Content>

        <Dialog.Actions style={styles.actions}>
          <Button
            onPress={onDismiss}
            style={styles.btnCancel}
            contentStyle={styles.btnContent}
            labelStyle={styles.btnLabel}
          >
            Cancelar
          </Button>
          <Button
            mode="contained"
            onPress={handleConfirm}
            disabled={!canConfirm}
            buttonColor="#43A047"
            style={styles.btnConfirm}
            contentStyle={styles.btnContent}
            labelStyle={styles.btnLabel}
          >
            Confirmar cobro
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  dialog: {
    borderRadius: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 16,
  },
  totalLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    color: '#888',
  },
  totalAmount: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1a1a1a',
  },
  divider: {
    marginBottom: 16,
  },
  input: {
    fontSize: 20,
    backgroundColor: '#fff',
  },
  changeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 16,
    paddingHorizontal: 4,
  },
  changeLabel: {
    fontSize: 15,
    color: '#555',
    fontWeight: '600',
  },
  changeAmount: {
    fontSize: 28,
    fontWeight: '800',
    color: '#43A047',
  },
  changeInsufficient: {
    fontSize: 15,
    color: '#E53935',
    fontWeight: '600',
  },
  changePlaceholder: {
    fontSize: 24,
    color: '#ccc',
  },
  actions: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  btnCancel: {
    flex: 1,
  },
  btnConfirm: {
    flex: 2,
  },
  btnContent: {
    height: 50,
  },
  btnLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
});
