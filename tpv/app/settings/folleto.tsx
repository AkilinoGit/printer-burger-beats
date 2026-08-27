import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Checkbox,
  Dialog,
  Divider,
  IconButton,
  Portal,
  RadioButton,
  Surface,
  Switch,
  Text,
} from 'react-native-paper';

import StableTextInput from '../../components/StableTextInput';
import type { PromoSlot, TextPreset } from '../../lib/types';
import { printPromo } from '../../services/printer';
import { useTextPresetsStore, type SinglePromoSlot } from '../../stores/useTextPresetsStore';

// ---------------------------------------------------------------------------
// Config de secciones
// ---------------------------------------------------------------------------

interface PromoSectionDef {
  slot: PromoSlot;
  title: string;
  subtitle: string;
  addLabel: string;
  allowNone: boolean; // validez/despedida se pueden omitir; el titular no
  /** true = selección múltiple (checkboxes, se imprimen todos los marcados). */
  multiple?: boolean;
}

const PROMO_SECTIONS: PromoSectionDef[] = [
  {
    slot: 'title',
    title: 'Titular',
    subtitle: 'El mensaje grande bajo el logo. Marca cuál se imprime.',
    addLabel: 'Añadir titular',
    allowNone: false,
  },
  {
    slot: 'validity',
    title: 'Validez',
    subtitle: 'Línea bajo el titular. Escribe {fecha} y se sustituye por la fecha de abajo.',
    addLabel: 'Añadir línea',
    allowNone: true,
  },
  {
    slot: 'other',
    title: 'Otros',
    subtitle: 'Líneas adicionales. Marca tantas como quieras — se imprimen todas las marcadas.',
    addLabel: 'Añadir línea',
    allowNone: false,
    multiple: true,
  },
  {
    slot: 'farewell',
    title: 'Despedida',
    subtitle: 'Línea final del folleto.',
    addLabel: 'Añadir despedida',
    allowNone: true,
  },
];

/** Fecha de hoy en dd/mm/aaaa, valor por defecto del campo de validez. */
function todayDDMMYYYY(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// Estado del diálogo de alta/edición.
type EditorState =
  | { open: false }
  | { open: true; slot: PromoSlot; presetId: string | null; text: string };

export default function FolletoScreen(): React.JSX.Element {
  const presets = useTextPresetsStore((s) => s.presets);
  const promoSelection = useTextPresetsStore((s) => s.promoSelection);
  const addPreset = useTextPresetsStore((s) => s.addPreset);
  const updateText = useTextPresetsStore((s) => s.updateText);
  const removePreset = useTextPresetsStore((s) => s.removePreset);
  const setPromoSelection = useTextPresetsStore((s) => s.setPromoSelection);
  const toggleOtherSelection = useTextPresetsStore((s) => s.toggleOtherSelection);
  const resolvePromoLines = useTextPresetsStore((s) => s.resolvePromoLines);
  const promoNumbering = useTextPresetsStore((s) => s.promoNumbering);
  const setPromoNumberingEnabled = useTextPresetsStore((s) => s.setPromoNumberingEnabled);
  const setPromoNextNumber = useTextPresetsStore((s) => s.setPromoNextNumber);

  const [date, setDate] = useState(todayDDMMYYYY);
  const [copiesStr, setCopiesStr] = useState('1');

  // Campo del número de inicio, sincronizado con el store. El store avanza este
  // valor tras cada impresión real; el efecto refleja ese cambio en el input sin
  // pisar lo que el usuario está escribiendo (mismo valor numérico → no toca).
  const [startStr, setStartStr] = useState(String(promoNumbering.next));
  useEffect(() => {
    setStartStr((prev) => (parseInt(prev, 10) === promoNumbering.next ? prev : String(promoNumbering.next)));
  }, [promoNumbering.next]);

  const [editor, setEditor] = useState<EditorState>({ open: false });
  const [confirmDelete, setConfirmDelete] = useState<TextPreset | null>(null);

  // null = idle; { current, total } = imprimiendo
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const cancelledRef = useRef(false);

  // ── Editor de presets ──────────────────────────────────────────────────────
  function openAdd(slot: PromoSlot): void {
    setEditor({ open: true, slot, presetId: null, text: '' });
  }
  function openEdit(slot: PromoSlot, preset: TextPreset): void {
    setEditor({ open: true, slot, presetId: preset.id, text: preset.text });
  }
  function closeEditor(): void {
    setEditor({ open: false });
  }
  async function confirmEditor(): Promise<void> {
    if (!editor.open) return;
    const text = editor.text.trim();
    if (!text) return;
    if (editor.presetId) {
      await updateText(editor.presetId, text);
    } else {
      await addPreset('promo', editor.slot, text);
    }
    closeEditor();
  }

  // ── Impresión ──────────────────────────────────────────────────────────────

  /** Lee y valida el número de inicio del input. null = numeración desactivada. */
  function resolveStartNumber(): number | null | 'invalid' {
    if (!promoNumbering.enabled) return null;
    const n = parseInt(startStr, 10);
    if (isNaN(n) || n < 0) return 'invalid';
    return n;
  }

  function validate(): { copies: number; startNumber: number | null } | null {
    const lines = resolvePromoLines(date.trim() || todayDDMMYYYY());
    if (!lines.title) {
      Alert.alert('Sin titular', 'Elige un titular para imprimir el folleto.');
      return null;
    }
    const copies = parseInt(copiesStr, 10);
    if (isNaN(copies) || copies < 1) {
      Alert.alert('Número inválido', 'Introduce un número de copias mayor que 0.');
      return null;
    }
    const startNumber = resolveStartNumber();
    if (startNumber === 'invalid') {
      Alert.alert('Número inicial inválido', 'Introduce un número de inicio válido (0 o mayor).');
      return null;
    }
    return { copies, startNumber };
  }

  async function doPrint(copies: number, startNumber: number | null, advance: boolean): Promise<void> {
    const lines = resolvePromoLines(date.trim() || todayDDMMYYYY());
    if (!lines.title) return; // ya validado, pero TS necesita la guarda
    cancelledRef.current = false;
    setProgress({ current: 0, total: copies });
    let printed = 0;
    try {
      const result = await printPromo(
        lines.title,
        lines.validity,
        lines.farewell,
        lines.others,
        copies,
        startNumber,
        (current, total) => {
          printed = current;
          setProgress({ current, total });
        },
        () => !cancelledRef.current,
      );
      if (!result.ok && !result.cancelled) {
        Alert.alert('Error al imprimir', result.error ?? 'Fallo desconocido.');
      }
    } finally {
      setProgress(null);
    }
    // Avanza el contador por las copias realmente impresas (aunque se cancele a
    // medias), para que la próxima tanda continúe sin repetir números.
    if (advance && startNumber !== null && printed > 0) {
      void setPromoNextNumber(startNumber + printed);
    }
  }

  function handlePrint(): void {
    const v = validate();
    if (v) void doPrint(v.copies, v.startNumber, true);
  }
  function handleTest(): void {
    const lines = resolvePromoLines(date.trim() || todayDDMMYYYY());
    if (!lines.title) {
      Alert.alert('Sin titular', 'Elige un titular para imprimir el folleto.');
      return;
    }
    const startNumber = resolveStartNumber();
    if (startNumber === 'invalid') {
      Alert.alert('Número inicial inválido', 'Introduce un número de inicio válido (0 o mayor).');
      return;
    }
    // La prueba muestra el número (si está activo) pero NO avanza el contador.
    void doPrint(2, startNumber, false);
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        {PROMO_SECTIONS.map((section) =>
          section.multiple ? (
            <Section
              key={section.slot}
              section={section}
              presets={presets}
              selectedIds={promoSelection.other}
              onToggle={(id) => void toggleOtherSelection(id)}
              onAdd={() => openAdd(section.slot)}
              onEdit={(p) => openEdit(section.slot, p)}
              onDelete={(p) => setConfirmDelete(p)}
            />
          ) : (
            <Section
              key={section.slot}
              section={section}
              presets={presets}
              selectedId={promoSelection[section.slot as SinglePromoSlot]}
              onSelect={(id) => void setPromoSelection(section.slot as SinglePromoSlot, id)}
              onAdd={() => openAdd(section.slot)}
              onEdit={(p) => openEdit(section.slot, p)}
              onDelete={(p) => setConfirmDelete(p)}
            />
          ),
        )}

        {/* ── Opciones de impresión ────────────────────────────────────────── */}
        <Text variant="labelLarge" style={styles.sectionLabel}>IMPRESIÓN</Text>
        <Surface style={styles.card} elevation={1}>
          <StableTextInput
            label="Fecha para {fecha} (dd/mm/aaaa)"
            value={date}
            onChangeText={setDate}
            mode="outlined"
            keyboardType="numeric"
            style={styles.input}
          />
          <StableTextInput
            label="Número de copias"
            value={copiesStr}
            onChangeText={setCopiesStr}
            mode="outlined"
            keyboardType="number-pad"
            style={[styles.input, styles.copiesInput]}
          />

          <Divider style={styles.divider} />

          <View style={styles.numberingRow}>
            <View style={styles.numberingText}>
              <Text style={styles.numberingTitle}>Numerar cupones</Text>
              <Text style={styles.numberingSub}>
                Imprime un número correlativo justo debajo del logo. Cada copia lleva el siguiente.
              </Text>
            </View>
            <Switch
              value={promoNumbering.enabled}
              onValueChange={(v) => void setPromoNumberingEnabled(v)}
            />
          </View>

          {promoNumbering.enabled && (
            <StableTextInput
              label="Empezar en el número"
              value={startStr}
              onChangeText={(t) => {
                setStartStr(t);
                const n = parseInt(t, 10);
                if (!isNaN(n) && n >= 0) void setPromoNextNumber(n);
              }}
              mode="outlined"
              keyboardType="number-pad"
              style={[styles.input, styles.copiesInput]}
            />
          )}

          <View style={styles.printActions}>
            <Button
              mode="contained"
              buttonColor="#43A047"
              icon="printer-check"
              onPress={handleTest}
              style={styles.printBtn}
            >
              Prueba
            </Button>
            <Button
              mode="contained"
              buttonColor="#1565C0"
              icon="printer"
              onPress={handlePrint}
              style={styles.printBtn}
            >
              Imprimir
            </Button>
          </View>
        </Surface>
      </ScrollView>

      {/* Diálogo de alta/edición */}
      <Portal>
        <Dialog visible={editor.open} onDismiss={closeEditor}>
          <Dialog.Title>
            {editor.open && editor.presetId
              ? 'Editar'
              : editor.open
                ? PROMO_SECTIONS.find((s) => s.slot === editor.slot)?.addLabel ?? 'Añadir'
                : ''}
          </Dialog.Title>
          <Dialog.Content>
            <StableTextInput
              value={editor.open ? editor.text : ''}
              onChangeText={(t) => setEditor((prev) => (prev.open ? { ...prev, text: t } : prev))}
              mode="outlined"
              autoFocus
              multiline
              placeholder="Escribe el texto…"
              style={styles.editorInput}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={closeEditor}>Cancelar</Button>
            <Button
              mode="contained"
              onPress={() => void confirmEditor()}
              disabled={!(editor.open && editor.text.trim())}
              buttonColor="#1E88E5"
            >
              Guardar
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* Confirmación de borrado */}
      <Portal>
        <Dialog visible={confirmDelete !== null} onDismiss={() => setConfirmDelete(null)}>
          <Dialog.Title>¿Eliminar?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">«{confirmDelete?.text}» se eliminará de todos los dispositivos.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmDelete(null)}>Cancelar</Button>
            <Button
              mode="contained"
              buttonColor="#E53935"
              onPress={() => {
                if (confirmDelete) void removePreset(confirmDelete.id);
                setConfirmDelete(null);
              }}
            >
              Eliminar
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* Overlay de progreso de impresión */}
      <Portal>
        <Dialog visible={progress !== null} dismissable={false}>
          <Dialog.Content style={styles.progressBox}>
            <ActivityIndicator size="large" />
            <Text style={styles.progressText}>
              {progress && progress.current === 0
                ? 'Conectando con la impresora…'
                : `Imprimiendo copia ${progress?.current} de ${progress?.total}…`}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button
              mode="contained"
              buttonColor="#777"
              icon="cancel"
              onPress={() => { cancelledRef.current = true; }}
            >
              Cancelar impresión
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

/**
 * `selectedId`/`onSelect` se usan cuando `section.multiple` es false (radio);
 * `selectedIds`/`onToggle` cuando es true (checkboxes). El caller garantiza el
 * par correcto según `section.multiple` para cada uso.
 */
interface SectionProps {
  section: PromoSectionDef;
  presets: TextPreset[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  selectedIds?: string[];
  onToggle?: (id: string) => void;
  onAdd: () => void;
  onEdit: (p: TextPreset) => void;
  onDelete: (p: TextPreset) => void;
}

function Section({
  section,
  presets,
  selectedId = null,
  onSelect,
  selectedIds = [],
  onToggle,
  onAdd,
  onEdit,
  onDelete,
}: SectionProps): React.JSX.Element {
  const items = useMemo(
    () => presets.filter((p) => p.kind === 'promo' && p.slot === section.slot),
    [presets, section.slot],
  );

  return (
    <View style={styles.section}>
      <Text variant="labelLarge" style={styles.sectionLabel}>
        {section.title.toUpperCase()}
      </Text>
      <Surface style={styles.card} elevation={1}>
        <Text style={styles.subtitle}>{section.subtitle}</Text>

        <Divider style={styles.divider} />

        {section.allowNone && !section.multiple && (
          <View style={styles.row}>
            <RadioButton
              value="__none__"
              status={selectedId === null ? 'checked' : 'unchecked'}
              onPress={() => onSelect?.(null)}
            />
            <Text style={[styles.rowText, styles.rowTextNone]}>(ninguno — no imprimir esta línea)</Text>
          </View>
        )}

        {items.length === 0 ? (
          <Text style={styles.empty}>Nada todavía. Añade el primero.</Text>
        ) : (
          items.map((p) =>
            section.multiple ? (
              <View key={p.id} style={styles.row}>
                <Checkbox
                  status={selectedIds.includes(p.id) ? 'checked' : 'unchecked'}
                  onPress={() => onToggle?.(p.id)}
                />
                <Text style={styles.rowText} numberOfLines={2}>
                  {p.text}
                </Text>
                <IconButton icon="pencil" size={20} onPress={() => onEdit(p)} style={styles.rowBtn} />
                <IconButton icon="delete-outline" size={20} iconColor="#E53935" onPress={() => onDelete(p)} style={styles.rowBtn} />
              </View>
            ) : (
              <View key={p.id} style={styles.row}>
                <RadioButton
                  value={p.id}
                  status={selectedId === p.id ? 'checked' : 'unchecked'}
                  onPress={() => onSelect?.(p.id)}
                />
                <Text style={styles.rowText} numberOfLines={2}>
                  {p.text}
                </Text>
                <IconButton icon="pencil" size={20} onPress={() => onEdit(p)} style={styles.rowBtn} />
                <IconButton icon="delete-outline" size={20} iconColor="#E53935" onPress={() => onDelete(p)} style={styles.rowBtn} />
              </View>
            ),
          )
        )}

        <Button mode="text" icon="plus" onPress={onAdd} style={styles.addBtn} textColor="#1E88E5">
          {section.addLabel}
        </Button>
      </Surface>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 16, paddingBottom: 32 },
  section: { marginBottom: 20 },
  sectionLabel: { color: '#666', marginBottom: 8, letterSpacing: 0.5 },
  card: { borderRadius: 12, padding: 14, backgroundColor: '#fff' },
  subtitle: { fontSize: 13, color: '#777', marginBottom: 4, lineHeight: 18 },
  divider: { marginVertical: 12 },
  empty: { fontSize: 14, color: '#bbb', fontStyle: 'italic', paddingVertical: 8, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 4,
  },
  rowText: { flex: 1, fontSize: 15, color: '#111', paddingHorizontal: 4 },
  rowTextNone: { color: '#999', fontStyle: 'italic' },
  rowBtn: { margin: 0 },
  addBtn: { alignSelf: 'flex-start', marginTop: 6 },
  editorInput: { backgroundColor: '#fff' },
  input: { backgroundColor: '#fff', marginBottom: 12 },
  copiesInput: { width: 180 },
  numberingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },
  numberingText: { flex: 1 },
  numberingTitle: { fontSize: 15, color: '#111', fontWeight: '600' },
  numberingSub: { fontSize: 13, color: '#777', marginTop: 2, lineHeight: 18 },
  printActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  printBtn: { flex: 1, borderRadius: 8 },
  progressBox: { alignItems: 'center', paddingVertical: 16, gap: 16 },
  progressText: { fontSize: 15, color: '#333', textAlign: 'center' },
});
