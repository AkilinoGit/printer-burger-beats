/**
 * TicketPreview — modal de sólo lectura que simula el ticket de cocina.
 *
 * Uso:
 *   <TicketPreview ticket={activeTicket} isTest={testMode} modifierLabels={...} />
 *
 * El componente gestiona su propio estado visible/oculto internamente y expone
 * un botón desencadenador pequeño y secundario (texto gris, sin relleno).
 * El modal NO realiza ninguna acción — es puramente visual.
 */

import React, { useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from 'react-native-paper';

import type { Ticket } from '../lib/types';
import { currentTime } from '../lib/utils';

// ---------------------------------------------------------------------------
// Constants — mirror the printer's 58 mm / 32-char layout
// ---------------------------------------------------------------------------

const CHARS   = 32;
const SEP      = '='.repeat(CHARS);
const SEP_THIN = '-'.repeat(CHARS);

// ---------------------------------------------------------------------------
// Ticket-text builder (pure strings, no ESC/POS bytes)
// ---------------------------------------------------------------------------

function buildPreviewLines(
  ticket: Ticket,
  isTest: boolean,
  modifierLabels: Record<string, string>,
): string[] {
  const lines: string[] = [];

  lines.push(SEP);
  lines.push(padCenter('COMANDA #' + String(ticket.ticketNumber)));
  lines.push(padCenter(currentTime()));
  lines.push(SEP);
  lines.push('');

  if (isTest) {
    lines.push(padCenter('*** PRUEBA — NO VÁLIDO ***'));
    lines.push('');
  }

  for (let i = 0; i < ticket.orders.length; i++) {
    if (i > 0) {
      lines.push(SEP_THIN);
      lines.push('');
    }

    const order = ticket.orders[i];
    lines.push('--- ' + order.clientName.toUpperCase() + ' ---');
    lines.push('');

    for (const item of order.items) {
      const label = item.customLabel ?? item.productName;
      lines.push(String(item.qty) + 'x ' + label);
      if (item.selectedModifiers.length > 0) {
        const mods = item.selectedModifiers
          .map((id) => modifierLabels[id] ?? id)
          .join(' · ');
        lines.push('   ' + mods);
      }
    }

    lines.push('');
  }

  lines.push(SEP);

  if (isTest) {
    lines.push('');
    lines.push(padCenter('*** PRUEBA — NO VÁLIDO ***'));
    lines.push(SEP);
  }

  return lines;
}

function padCenter(text: string): string {
  const pad = Math.max(0, Math.floor((CHARS - text.length) / 2));
  return ' '.repeat(pad) + text;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  ticket: Ticket | null;
  isTest: boolean;
  modifierLabels: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TicketPreview({
  ticket,
  isTest,
  modifierLabels,
}: Props): React.JSX.Element {
  const [visible, setVisible] = useState(false);

  const lines = useMemo(
    () => ticket ? buildPreviewLines(ticket, isTest, modifierLabels) : [],
    [ticket, isTest, modifierLabels],
  );

  return (
    <>
      {/* ── Trigger: small secondary link, no fill, aligned right ─────────── */}
      <Pressable
        onPress={() => setVisible(true)}
        disabled={!ticket}
        style={({ pressed }) => [
          styles.trigger,
          pressed && styles.triggerPressed,
          !ticket && styles.triggerDisabled,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Vista previa del ticket de cocina"
      >
        <Text style={[styles.triggerText, !ticket && styles.triggerTextDisabled]}>
          vista previa
        </Text>
      </Pressable>

      {/* ── Modal overlay ─────────────────────────────────────────────────── */}
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisible(false)}
        statusBarTranslucent={Platform.OS === 'android'}
      >
        <View style={styles.backdrop}>
          <View style={styles.card}>

            {/* Header row */}
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Vista previa</Text>
              <Pressable
                onPress={() => setVisible(false)}
                style={({ pressed }) => [
                  styles.closeBtn,
                  pressed && styles.closeBtnPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Cerrar vista previa"
                hitSlop={12}
              >
                <Text style={styles.closeBtnText}>Cerrar</Text>
              </Pressable>
            </View>

            {/* Test-mode badge inside modal */}
            {isTest && (
              <View style={styles.testBadge}>
                <Text style={styles.testBadgeText}>MODO PRUEBA</Text>
              </View>
            )}

            {/* Ticket body — monospace, fixed 32-char width */}
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.receipt}>
                {lines.map((line, idx) => (
                  <Text key={idx} style={styles.receiptLine}>
                    {/* Preserve leading spaces used for centering;
                        empty lines need a non-breaking space to keep height */}
                    {line === '' ? '\u00A0' : line}
                  </Text>
                ))}
              </View>
            </ScrollView>

          </View>
        </View>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const MONO = Platform.select({ ios: 'Courier New', android: 'monospace' }) ?? 'monospace';
const FONT_SIZE = 13;
// Approximate char width for the chosen monospace size (tuned for 58 mm printers)
const CHAR_WIDTH = FONT_SIZE * 0.62;
const RECEIPT_PADDING = 12;
const RECEIPT_WIDTH = Math.ceil(CHARS * CHAR_WIDTH) + RECEIPT_PADDING * 2;

const styles = StyleSheet.create({
  // ── trigger ──────────────────────────────────────────────────────────────
  trigger: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
    paddingHorizontal: 2,
    marginBottom: 2,
  },
  triggerPressed: {
    opacity: 0.45,
  },
  triggerDisabled: {
    opacity: 0.3,
  },
  triggerText: {
    fontSize: 13,
    color: '#aaa',
    // Deliberately unstyled — subordinate to the three main action buttons
  },
  triggerTextDisabled: {
    color: '#ccc',
  },

  // ── modal backdrop ────────────────────────────────────────────────────────
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },

  // ── card ──────────────────────────────────────────────────────────────────
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '82%',
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 12,
  },

  // ── card header ───────────────────────────────────────────────────────────
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  closeBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  closeBtnPressed: {
    backgroundColor: '#f0f0f0',
  },
  closeBtnText: {
    fontSize: 14,
    color: '#1565C0',
    fontWeight: '600',
  },

  // ── test mode badge ───────────────────────────────────────────────────────
  testBadge: {
    backgroundColor: '#FF6F00',
    paddingVertical: 5,
    alignItems: 'center',
  },
  testBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },

  // ── scroll / receipt ──────────────────────────────────────────────────────
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
  },

  // Paper-white receipt surface
  receipt: {
    backgroundColor: '#FAFAFA',
    borderRadius: 4,
    padding: RECEIPT_PADDING,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    width: RECEIPT_WIDTH,
    alignSelf: 'center',
  },
  receiptLine: {
    fontFamily: MONO,
    fontSize: FONT_SIZE,
    lineHeight: FONT_SIZE * 1.55,
    color: '#1a1a1a',
    // No wrapping — the ticket is designed for 32-char hard breaks
    flexShrink: 0,
  },
});
