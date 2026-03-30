import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, TouchableWithoutFeedback, View } from 'react-native';
import { Button, Chip, Divider, Surface, Text, TouchableRipple } from 'react-native-paper';
import type { Product } from '../lib/types';

interface Props {
  product: Product | null;
  visible: boolean;
  onConfirm: (selectedModifiers: string[]) => void;
  onDismiss: () => void;
}

export default function ModifierSheet({ product, visible, onConfirm, onDismiss }: Props): React.JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reset selection every time a new product opens the sheet
  useEffect(() => {
    if (visible) setSelected(new Set());
  }, [visible, product?.id]);

  if (!product) return <></>;

  const removes = product.modifiers.filter((m) => m.type === 'remove');
  const adds    = product.modifiers.filter((m) => m.type === 'add');

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleConfirm(): void {
    onConfirm([...selected]);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      {/* Tap outside to dismiss */}
      <TouchableWithoutFeedback onPress={onDismiss}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      <Surface style={styles.sheet} elevation={4}>
        {/* Handle — tap to dismiss */}
        <TouchableRipple onPress={onDismiss} style={styles.handleArea} borderless>
          <View style={styles.handle} />
        </TouchableRipple>

        <Text style={styles.title}>{product.name}</Text>
        <Text style={styles.subtitle}>Selecciona las variantes</Text>
        <Divider style={styles.divider} />

        <ScrollView contentContainerStyle={styles.chipScroll}>
          {removes.length > 0 && (
            <>
              <Text style={styles.groupLabel}>QUITAR</Text>
              <View style={styles.chipRow}>
                {removes.map((m) => (
                  <Chip
                    key={m.id}
                    mode={selected.has(m.id) ? 'flat' : 'outlined'}
                    selected={selected.has(m.id)}
                    onPress={() => toggle(m.id)}
                    style={styles.chip}
                    selectedColor="#E53935"
                    showSelectedCheck={false}
                  >
                    {m.label}
                  </Chip>
                ))}
              </View>
            </>
          )}

          {adds.length > 0 && (
            <>
              <Text style={[styles.groupLabel, { marginTop: 16 }]}>AÑADIR</Text>
              <View style={styles.chipRow}>
                {adds.map((m) => (
                  <Chip
                    key={m.id}
                    mode={selected.has(m.id) ? 'flat' : 'outlined'}
                    selected={selected.has(m.id)}
                    onPress={() => toggle(m.id)}
                    style={styles.chip}
                    selectedColor="#43A047"
                    showSelectedCheck={false}
                  >
                    {m.label}
                  </Chip>
                ))}
              </View>
            </>
          )}
        </ScrollView>

        <Divider style={styles.divider} />

        <View style={styles.actions}>
          <Button
            mode="outlined"
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
            style={styles.btnConfirm}
            contentStyle={styles.btnContent}
            labelStyle={styles.btnLabel}
            buttonColor="#E53935"
          >
            Añadir al pedido
          </Button>
        </View>
      </Surface>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
    paddingHorizontal: 20,
    paddingTop: 4,
    backgroundColor: '#fff',
  },
  handleArea: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ccc',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1a1a1a',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    marginTop: 4,
  },
  divider: {
    marginVertical: 16,
  },
  chipScroll: {
    paddingBottom: 8,
  },
  groupLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: '#999',
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    height: 40,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  btnCancel: {
    flex: 1,
  },
  btnConfirm: {
    flex: 2,
  },
  btnContent: {
    height: 52,
  },
  btnLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
});
