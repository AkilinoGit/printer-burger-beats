import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Dialog,
  Divider,
  IconButton,
  Portal,
  RadioButton,
  SegmentedButtons,
  Surface,
  Switch,
  Text,
} from 'react-native-paper';

import StableTextInput from '../../components/StableTextInput';
import type { TextPreset, TextPresetKind, TicketSlot } from '../../lib/types';
import { useTextPresetsStore, type ModeTarget } from '../../stores/useTextPresetsStore';

interface SectionDef {
  target: ModeTarget;
  title: string;
  subtitle: string;
  kind: TextPresetKind;
  slot: TicketSlot | null;
  addLabel: string;
}

const SECTIONS: SectionDef[] = [
  {
    target: 'header',
    title: 'Cabecera del ticket',
    subtitle: 'Mensaje impreso arriba (bajo el logo) en la copia del cliente.',
    kind: 'ticket_message',
    slot: 'header',
    addLabel: 'Añadir mensaje',
  },
  {
    target: 'footer',
    title: 'Pie del ticket',
    subtitle: 'Mensaje impreso al final de la copia del cliente (despedida).',
    kind: 'ticket_message',
    slot: 'footer',
    addLabel: 'Añadir mensaje',
  },
  {
    target: 'orderName',
    title: 'Nombres de pedido',
    subtitle: 'Se usa uno cuando el pedido se deja sin nombre.',
    kind: 'order_name',
    slot: null,
    addLabel: 'Añadir nombre',
  },
];

// Estado del diálogo de alta/edición.
type EditorState =
  | { open: false }
  | { open: true; section: SectionDef; presetId: string | null; text: string };

export default function MensajesScreen(): React.JSX.Element {
  const presets = useTextPresetsStore((s) => s.presets);
  const modes = useTextPresetsStore((s) => s.modes);
  const addPreset = useTextPresetsStore((s) => s.addPreset);
  const updateText = useTextPresetsStore((s) => s.updateText);
  const toggleEnabled = useTextPresetsStore((s) => s.toggleEnabled);
  const removePreset = useTextPresetsStore((s) => s.removePreset);
  const setMode = useTextPresetsStore((s) => s.setMode);

  const [editor, setEditor] = useState<EditorState>({ open: false });
  const [confirmDelete, setConfirmDelete] = useState<TextPreset | null>(null);

  function openAdd(section: SectionDef): void {
    setEditor({ open: true, section, presetId: null, text: '' });
  }
  function openEdit(section: SectionDef, preset: TextPreset): void {
    setEditor({ open: true, section, presetId: preset.id, text: preset.text });
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
      await addPreset(editor.section.kind, editor.section.slot, text);
    }
    closeEditor();
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        {SECTIONS.map((section) => (
          <Section
            key={section.target}
            section={section}
            presets={presets}
            mode={modes[section.target].mode}
            fixedId={modes[section.target].fixedId}
            onSetMode={(m) => void setMode(section.target, m)}
            onToggleEnabled={(id, enabled) => void toggleEnabled(id, enabled)}
            onAdd={() => openAdd(section)}
            onEdit={(p) => openEdit(section, p)}
            onDelete={(p) => setConfirmDelete(p)}
          />
        ))}
      </ScrollView>

      {/* Diálogo de alta/edición */}
      <Portal>
        <Dialog visible={editor.open} onDismiss={closeEditor}>
          <Dialog.Title>
            {editor.open && editor.presetId ? 'Editar' : editor.open ? editor.section.addLabel : ''}
          </Dialog.Title>
          <Dialog.Content>
            <StableTextInput
              value={editor.open ? editor.text : ''}
              onChangeText={(t) => setEditor((prev) => (prev.open ? { ...prev, text: t } : prev))}
              mode="outlined"
              autoFocus
              multiline={editor.open && editor.section.kind === 'ticket_message'}
              autoCapitalize={editor.open && editor.section.kind === 'order_name' ? 'characters' : 'sentences'}
              placeholder={editor.open && editor.section.kind === 'order_name' ? 'NOMBRE' : 'Escribe el mensaje…'}
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
    </View>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

function Section({
  section,
  presets,
  mode,
  fixedId,
  onSetMode,
  onToggleEnabled,
  onAdd,
  onEdit,
  onDelete,
}: {
  section: SectionDef;
  presets: TextPreset[];
  mode: 'random' | 'fixed';
  fixedId: string | null;
  onSetMode: (m: { mode: 'random' | 'fixed'; fixedId: string | null }) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onAdd: () => void;
  onEdit: (p: TextPreset) => void;
  onDelete: (p: TextPreset) => void;
}): React.JSX.Element {
  const items = useMemo(
    () => presets.filter((p) => p.kind === section.kind && p.slot === section.slot),
    [presets, section.kind, section.slot],
  );

  return (
    <View style={styles.section}>
      <Text variant="labelLarge" style={styles.sectionLabel}>
        {section.title.toUpperCase()}
      </Text>
      <Surface style={styles.card} elevation={1}>
        <Text style={styles.subtitle}>{section.subtitle}</Text>

        <SegmentedButtons
          value={mode}
          onValueChange={(v) =>
            onSetMode({ mode: v as 'random' | 'fixed', fixedId: v === 'fixed' ? fixedId : null })
          }
          density="small"
          style={styles.modeButtons}
          buttons={[
            { value: 'random', label: 'Aleatorio', icon: 'shuffle-variant' },
            { value: 'fixed', label: 'Fijo', icon: 'pin' },
          ]}
        />
        {mode === 'fixed' && (
          <Text style={styles.modeHint}>
            {fixedId
              ? 'Se imprime siempre el marcado ●.'
              : 'Marca ● cuál se imprime siempre.'}
          </Text>
        )}
        {mode === 'random' && (
          <Text style={styles.modeHint}>Se sortea uno entre los activos.</Text>
        )}

        <Divider style={styles.divider} />

        {items.length === 0 ? (
          <Text style={styles.empty}>Nada todavía. Añade el primero.</Text>
        ) : (
          items.map((p) => (
            <View key={p.id} style={styles.row}>
              {mode === 'fixed' ? (
                <RadioButton
                  value={p.id}
                  status={fixedId === p.id ? 'checked' : 'unchecked'}
                  onPress={() => onSetMode({ mode: 'fixed', fixedId: p.id })}
                />
              ) : (
                <Switch value={p.enabled} onValueChange={(v) => onToggleEnabled(p.id, v)} />
              )}
              <Text
                style={[styles.rowText, mode === 'random' && !p.enabled && styles.rowTextDisabled]}
                numberOfLines={2}
              >
                {p.text}
              </Text>
              <IconButton icon="pencil" size={20} onPress={() => onEdit(p)} style={styles.rowBtn} />
              <IconButton icon="delete-outline" size={20} iconColor="#E53935" onPress={() => onDelete(p)} style={styles.rowBtn} />
            </View>
          ))
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
  subtitle: { fontSize: 13, color: '#777', marginBottom: 12, lineHeight: 18 },
  modeButtons: { marginBottom: 6 },
  modeHint: { fontSize: 12, color: '#888', fontStyle: 'italic' },
  divider: { marginVertical: 12 },
  empty: { fontSize: 14, color: '#bbb', fontStyle: 'italic', paddingVertical: 8, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 4,
  },
  rowText: { flex: 1, fontSize: 15, color: '#111', paddingHorizontal: 4 },
  rowTextDisabled: { color: '#bbb', textDecorationLine: 'line-through' },
  rowBtn: { margin: 0 },
  addBtn: { alignSelf: 'flex-start', marginTop: 6 },
  editorInput: { backgroundColor: '#fff' },
});
