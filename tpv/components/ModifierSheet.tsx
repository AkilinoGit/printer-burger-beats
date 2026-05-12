import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TouchableWithoutFeedback, View } from 'react-native';
import { Button, Divider, Surface, Text, TouchableRipple } from 'react-native-paper';
import { formatPrice } from '../lib/utils';
import type { Modifier, ModifierSection, Product } from '../lib/types';

interface Props {
  product: Product | null;
  visible: boolean;
  onConfirm: (selectedModifiers: string[]) => void;
  onDismiss: () => void;
}

interface SectionSpec {
  key: ModifierSection;
  title: string;
  color: string;     // dark / primary
  light: string;     // light fill for unselected chip background
}

// Fixed display order — sections always appear in this sequence
const SECTION_SPECS: SectionSpec[] = [
  { key: 'verdura',     title: 'VERDURA',       color: '#2E7D32', light: '#E8F5E9' }, // verde
  { key: 'queso-salsa', title: 'QUESO Y SALSA', color: '#EF6C00', light: '#FFE0B2' }, // naranja
  { key: 'carne',       title: 'CARNE',         color: '#C62828', light: '#FFCDD2' }, // rojo
  { key: 'extra',       title: 'EXTRA',         color: '#6A1B9A', light: '#E1BEE7' }, // morado
  { key: 'otros',       title: 'OTROS',         color: '#455A64', light: '#CFD8DC' }, // gris
];

function sortBySectionOrder(mods: Modifier[]): Modifier[] {
  return [...mods].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

export default function ModifierSheet({ product, visible, onConfirm, onDismiss }: Props): React.JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
    const result: string[] = [...selected];
    for (const optionId of Object.values(radioSelected)) {
      if (optionId !== null) result.push(optionId);
    }
    onConfirm(result);
  }

  // Group modifiers by section
  const bySection = new Map<ModifierSection, Modifier[]>();
  const unsectioned: Modifier[] = [];
  for (const m of product.modifiers) {
    if (m.section) {
      const arr = bySection.get(m.section) ?? [];
      arr.push(m);
      bySection.set(m.section, arr);
    } else {
      unsectioned.push(m);
    }
  }

  function ChipButton({
    label, isSelected, color, light, onPress,
  }: {
    label: string;
    isSelected: boolean;
    color: string;
    light: string;
    onPress: () => void;
  }): React.JSX.Element {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.chipBtn,
          {
            backgroundColor: isSelected ? color : light,
            borderColor: color,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Text style={[styles.chipText, { color: isSelected ? '#fff' : color }]}>
          {label}
        </Text>
      </Pressable>
    );
  }

  function renderToggle(m: Modifier, color: string, light: string): React.JSX.Element {
    const isSelected = selected.has(m.id);
    const priceStr = m.priceAdd ? `  ${m.priceAdd > 0 ? '+' : ''}${formatPrice(m.priceAdd)}` : '';
    return (
      <ChipButton
        key={m.id}
        label={`${m.label}${priceStr}`}
        isSelected={isSelected}
        color={color}
        light={light}
        onPress={() => toggle(m.id)}
      />
    );
  }

  function renderRadio(m: Modifier, color: string, light: string): React.JSX.Element {
    return (
      <View key={m.id} style={styles.radioInline}>
        <Text style={[styles.radioLabel, { color }]}>{m.label.toUpperCase()}</Text>
        <View style={styles.chipRow}>
          {(m.options ?? []).map((opt) => {
            const isChosen = radioSelected[m.id] === opt.id;
            return (
              <ChipButton
                key={opt.id}
                label={opt.label}
                isSelected={isChosen}
                color={color}
                light={light}
                onPress={() => selectRadioOption(m.id, opt.id)}
              />
            );
          })}
        </View>
      </View>
    );
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

          {SECTION_SPECS.map((spec) => {
            const mods = sortBySectionOrder(bySection.get(spec.key) ?? []);
            if (mods.length === 0) return null;
            return (
              <View key={spec.key} style={[styles.sectionCard, { borderColor: spec.color }]}>
                <View style={[styles.sectionHeader, { backgroundColor: spec.color }]}>
                  <Text style={styles.sectionHeaderText}>{spec.title}</Text>
                </View>
                <View style={styles.sectionBody}>
                  <View style={styles.chipRow}>
                    {mods.filter((m) => m.type !== 'radio').map((m) => renderToggle(m, spec.color, spec.light))}
                  </View>
                  {mods.filter((m) => m.type === 'radio').map((m) => renderRadio(m, spec.color, spec.light))}
                </View>
              </View>
            );
          })}

          {/* Fallback for modifiers without a section */}
          {unsectioned.length > 0 && (
            <View style={[styles.sectionCard, { borderColor: '#9E9E9E' }]}>
              <View style={[styles.sectionHeader, { backgroundColor: '#616161' }]}>
                <Text style={styles.sectionHeaderText}>OTROS</Text>
              </View>
              <View style={styles.sectionBody}>
                <View style={styles.chipRow}>
                  {unsectioned.filter((m) => m.type !== 'radio').map((m) => renderToggle(m, '#616161', '#ECEFF1'))}
                </View>
                {unsectioned.filter((m) => m.type === 'radio').map((m) => renderRadio(m, '#616161', '#ECEFF1'))}
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
    paddingHorizontal: 16,
    paddingTop: 4,
    backgroundColor: '#fff',
    maxHeight: '92%',
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
    marginVertical: 10,
  },
  chipScroll: {
    paddingBottom: 8,
  },
  sectionCard: {
    borderWidth: 2,
    borderRadius: 12,
    marginBottom: 14,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  sectionHeader: {
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  sectionHeaderText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  sectionBody: {
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chipBtn: {
    minHeight: 42,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 22,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 14,
    fontWeight: '700',
  },
  radioInline: {
    marginTop: 12,
  },
  radioLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.0,
    marginBottom: 8,
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
