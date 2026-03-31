import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, TouchableWithoutFeedback, View } from 'react-native';
import { Button, Chip, Divider, Surface, Text, TouchableRipple } from 'react-native-paper';
import { formatPrice } from '../lib/utils';
import type { Modifier, Product } from '../lib/types';

interface Props {
  product: Product | null;
  visible: boolean;
  onConfirm: (selectedModifiers: string[]) => void;
  onDismiss: () => void;
}

export default function ModifierSheet({ product, visible, onConfirm, onDismiss }: Props): React.JSX.Element {
  // toggle modifiers (remove / add)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // radio modifiers: modifierId → selected optionId (or null)
  const [radioSelected, setRadioSelected] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (visible && product) {
      setSelected(new Set());
      const initialRadio: Record<string, string | null> = {};
      product.modifiers.filter((m) => m.type === 'radio').forEach((m) => {
        initialRadio[m.id] = null;
      });
      setRadioSelected(initialRadio);
    }
  }, [visible, product?.id]);

  if (!product) return <></>;

  const removes = product.modifiers.filter((m) => m.type === 'remove');
  const adds    = product.modifiers.filter((m) => m.type === 'add');
  const radios  = product.modifiers.filter((m) => m.type === 'radio');

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectRadioOption(modifierId: string, optionId: string): void {
    setRadioSelected((prev) => ({
      ...prev,
      [modifierId]: prev[modifierId] === optionId ? null : optionId,
    }));
  }

  function handleConfirm(): void {
    // Collect toggle selections
    const result: string[] = [...selected];
    // Collect radio selections (optionId goes into selectedModifiers)
    for (const optionId of Object.values(radioSelected)) {
      if (optionId !== null) result.push(optionId);
    }
    onConfirm(result);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <TouchableWithoutFeedback onPress={onDismiss}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      <Surface style={styles.sheet} elevation={4}>
        <TouchableRipple onPress={onDismiss} style={styles.handleArea} borderless>
          <View style={styles.handle} />
        </TouchableRipple>

        <Text style={styles.title}>{product.name}</Text>
        <Text style={styles.subtitle}>Selecciona las variantes</Text>
        <Divider style={styles.divider} />

        <ScrollView contentContainerStyle={styles.chipScroll}>

          {/* RADIO modifiers — pick one option per group */}
          {radios.map((m: Modifier) => (
            <View key={m.id} style={styles.radioGroup}>
              <Text style={styles.groupLabel}>{m.label.toUpperCase()}</Text>
              <View style={styles.chipRow}>
                {(m.options ?? []).map((opt) => {
                  const isChosen = radioSelected[m.id] === opt.id;
                  return (
                    <Chip
                      key={opt.id}
                      mode={isChosen ? 'flat' : 'outlined'}
                      selected={isChosen}
                      onPress={() => selectRadioOption(m.id, opt.id)}
                      style={styles.chip}
                      selectedColor="#1E88E5"
                      showSelectedCheck={false}
                    >
                      {opt.label}
                    </Chip>
                  );
                })}
              </View>
            </View>
          ))}

          {/* REMOVE modifiers */}
          {removes.length > 0 && (
            <View style={radios.length > 0 ? styles.radioGroup : undefined}>
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
                    {m.label}{m.priceAdd ? `  ${m.priceAdd > 0 ? '+' : ''}${formatPrice(m.priceAdd)}` : ''}
                  </Chip>
                ))}
              </View>
            </View>
          )}

          {/* ADD modifiers (with optional price) */}
          {adds.length > 0 && (
            <View style={styles.radioGroup}>
              <Text style={styles.groupLabel}>AÑADIR</Text>
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
                    {m.label}{m.priceAdd ? `  +${formatPrice(m.priceAdd)}` : ''}
                  </Chip>
                ))}
              </View>
            </View>
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
  radioGroup: {
    marginTop: 16,
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
