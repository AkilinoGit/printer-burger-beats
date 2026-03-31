// ESC/POS helpers + ticket buffer builder
//
// react-native-thermal-printer accepts a string payload with inline tags:
//   [B]…[/B]  bold on/off
//   [C]        align center
//   [L]        align left
//   [BIG]…[/BIG]  double-height text (where supported)
//
// buildTicketCommands() returns the string payload for printBluetooth().
// buildTicketBuffer()  is provided for callers that need the raw Uint8Array
// (future use: direct BT socket write without the library).

import type { Order, OrderItem, Ticket } from '../lib/types';
import { currentTime } from '../lib/utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHARS_PER_LINE = 32;
const SEP       = '='.repeat(CHARS_PER_LINE);   // full-width separator
const SEP_THIN  = '-'.repeat(CHARS_PER_LINE);   // thin separator between orders

// ---------------------------------------------------------------------------
// Raw ESC/POS command bytes
// These are used by buildTicketBuffer() for direct byte-level printing.
// ---------------------------------------------------------------------------

const ESC = 0x1b;
const GS  = 0x1d;

/** ESC @ — Initialize printer */
export const CMD_INIT: readonly number[] = [ESC, 0x40];

/** ESC E 1 — Bold on */
export const CMD_BOLD_ON: readonly number[] = [ESC, 0x45, 0x01];

/** ESC E 0 — Bold off */
export const CMD_BOLD_OFF: readonly number[] = [ESC, 0x45, 0x00];

/** ESC a 1 — Align center */
export const CMD_ALIGN_CENTER: readonly number[] = [ESC, 0x61, 0x01];

/** ESC a 0 — Align left */
export const CMD_ALIGN_LEFT: readonly number[] = [ESC, 0x61, 0x00];

/** GS ! 0x11 — Double width + double height */
export const CMD_SIZE_DOUBLE: readonly number[] = [GS, 0x21, 0x11];

/** GS ! 0x00 — Normal size */
export const CMD_SIZE_NORMAL: readonly number[] = [GS, 0x21, 0x00];

/** ESC d 4 — Feed 4 lines */
export const CMD_FEED: readonly number[] = [ESC, 0x64, 0x04];

/** GS V 66 48 — Partial cut with feed */
export const CMD_CUT: readonly number[] = [GS, 0x56, 0x42, 0x30];

// ---------------------------------------------------------------------------
// Low-level byte helpers
// ---------------------------------------------------------------------------

/** Encodes an ASCII/Latin-1 string to a Uint8Array. */
export function encodeText(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/** Concatenates multiple byte arrays into a single Uint8Array. */
export function concatBytes(...parts: (readonly number[] | Uint8Array)[]): Uint8Array {
  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    out.set(part instanceof Uint8Array ? part : new Uint8Array(part), offset);
    offset += part.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// High-level string payload (for react-native-thermal-printer)
// ---------------------------------------------------------------------------

/**
 * Builds the full print payload for a ticket using the tagged-string format
 * accepted by react-native-thermal-printer's printBluetooth().
 *
 * @param ticket         Fully populated Ticket (all Orders + OrderItems).
 * @param isTest         Appends *** PRUEBA — NO VÁLIDO *** lines when true.
 * @param modifierLabels Map from Modifier.id → Modifier.label for readable printing.
 */
export function buildTicketCommands(
  ticket: Ticket,
  isTest: boolean,
  modifierLabels: Record<string, string>,
  radioNoSelection: Record<string, string> = {},
  radioOptionSets: Record<string, Set<string>> = {},
): string {
  const lines: string[] = [];

  // ── Header ──────────────────────────────────────────────────────────────
  lines.push('[C]' + SEP);
  lines.push('[C][B]COMANDA #' + String(ticket.ticketNumber) + '[/B]');
  lines.push('[C]' + currentTime());
  lines.push('[C]' + SEP);
  lines.push('');

  // ── Test-mode watermark (top) ────────────────────────────────────────────
  if (isTest) {
    lines.push('[C][B]*** PRUEBA - NO VALIDO ***[/B]');
    lines.push('');
  }

  // ── Orders ───────────────────────────────────────────────────────────────
  for (let i = 0; i < ticket.orders.length; i++) {
    if (i > 0) {
      lines.push('[C]' + SEP_THIN);
      lines.push('');
    }
    lines.push(..._formatOrder(ticket.orders[i], modifierLabels, radioNoSelection, radioOptionSets));
  }

  // ── Footer ───────────────────────────────────────────────────────────────
  lines.push('[C]' + SEP);

  // ── Test-mode watermark (bottom) ─────────────────────────────────────────
  if (isTest) {
    lines.push('');
    lines.push('[C][B]*** PRUEBA - NO VALIDO ***[/B]');
    lines.push('[C]' + SEP);
  }

  // Paper feed before cut
  lines.push('');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Raw Uint8Array buffer (for direct BT socket writes, future use)
// ---------------------------------------------------------------------------

/**
 * Generates the raw ESC/POS byte buffer for a ticket.
 * Produces the same visual output as buildTicketCommands() but as binary data
 * suitable for writing directly to a BluetoothSocket output stream.
 *
 * @param ticket         Fully populated Ticket.
 * @param isTest         Adds *** PRUEBA — NO VÁLIDO *** marker when true.
 * @param modifierLabels Map from Modifier.id → Modifier.label.
 */
export function buildTicketBuffer(
  ticket: Ticket,
  isTest: boolean,
  modifierLabels: Record<string, string>,
): Uint8Array {
  const parts: (readonly number[] | Uint8Array)[] = [];

  const line = (text: string) => parts.push(encodeText(text + '\n'));

  // Init
  parts.push(CMD_INIT);

  // ── Header ──────────────────────────────────────────────────────────────
  parts.push(CMD_ALIGN_CENTER);
  line(SEP);

  parts.push(CMD_BOLD_ON, CMD_SIZE_DOUBLE);
  line('COMANDA #' + String(ticket.ticketNumber));
  parts.push(CMD_SIZE_NORMAL, CMD_BOLD_OFF);

  line(currentTime());
  line(SEP);
  line('');

  // ── Test-mode watermark (top) ────────────────────────────────────────────
  if (isTest) {
    parts.push(CMD_BOLD_ON);
    line('*** PRUEBA - NO VALIDO ***');
    parts.push(CMD_BOLD_OFF);
    line('');
  }

  // ── Orders ───────────────────────────────────────────────────────────────
  for (let i = 0; i < ticket.orders.length; i++) {
    if (i > 0) {
      parts.push(CMD_ALIGN_CENTER);
      line(SEP_THIN);
      line('');
    }
    _appendOrderBytes(parts, ticket.orders[i], modifierLabels);
  }

  // ── Footer ───────────────────────────────────────────────────────────────
  parts.push(CMD_ALIGN_CENTER);
  line(SEP);

  // ── Test-mode watermark (bottom) ─────────────────────────────────────────
  if (isTest) {
    line('');
    parts.push(CMD_BOLD_ON);
    line('*** PRUEBA - NO VALIDO ***');
    parts.push(CMD_BOLD_OFF);
    line(SEP);
  }

  // Feed + cut
  parts.push(CMD_FEED, CMD_CUT);

  return concatBytes(...parts);
}

// ---------------------------------------------------------------------------
// Internal formatters
// ---------------------------------------------------------------------------

function _formatOrder(
  order: Order,
  modifierLabels: Record<string, string>,
  radioNoSelection: Record<string, string>,
  radioOptionSets: Record<string, Set<string>>,
): string[] {
  const lines: string[] = [];

  lines.push('[L][B]--- ' + order.clientName.toUpperCase() + ' ---[/B]');
  lines.push('');

  for (const item of order.items) {
    lines.push(..._formatItem(item, modifierLabels, radioNoSelection, radioOptionSets));
  }

  lines.push('');
  return lines;
}

function _formatItem(
  item: OrderItem,
  modifierLabels: Record<string, string>,
  radioNoSelection: Record<string, string>,
  radioOptionSets: Record<string, Set<string>>,
): string[] {
  const lines: string[] = [];

  const label = item.customLabel ?? item.productName;
  lines.push('[L]' + String(item.qty) + 'x ' + label);

  const modParts: string[] = [];

  // For each radio group, check if any of its options was selected;
  // if not, print the noSelectionLabel (e.g. "Sin salsa")
  for (const [modId, optionSet] of Object.entries(radioOptionSets)) {
    const chosen = item.selectedModifiers.find((id) => optionSet.has(id));
    if (chosen) {
      modParts.push(modifierLabels[chosen] ?? chosen);
    } else if (radioNoSelection[modId]) {
      modParts.push(radioNoSelection[modId]);
    }
  }

  // Toggle modifiers (remove / add) — skip any radio option ids
  const allRadioOptions = new Set(
    Object.values(radioOptionSets).flatMap((s) => [...s]),
  );
  for (const id of item.selectedModifiers) {
    if (!allRadioOptions.has(id)) {
      modParts.push(modifierLabels[id] ?? id);
    }
  }

  if (modParts.length > 0) {
    lines.push('[L]   ' + modParts.join(' · '));
  }

  return lines;
}

function _appendOrderBytes(
  parts: (readonly number[] | Uint8Array)[],
  order: Order,
  modifierLabels: Record<string, string>,
): void {
  const line = (text: string) => parts.push(encodeText(text + '\n'));

  // Client name — bold, left-aligned
  parts.push(CMD_ALIGN_LEFT, CMD_BOLD_ON);
  line('--- ' + order.clientName.toUpperCase() + ' ---');
  parts.push(CMD_BOLD_OFF);
  line('');

  for (const item of order.items) {
    parts.push(CMD_ALIGN_LEFT);
    const label = item.customLabel ?? item.productName;
    line(String(item.qty) + 'x ' + label);

    if (item.selectedModifiers.length > 0) {
      const modStr = item.selectedModifiers
        .map((id) => modifierLabels[id] ?? id)
        .join(' · ');
      line('   ' + modStr);
    }
  }

  line('');
}
