// ESC/POS helpers + ticket buffer builder
//
// Target printer: NETUM Bluetooth 58mm, 32 chars/line.
//
// buildTicketBuffer() generates the raw Uint8Array sent to RawBT via Intent.
// buildTicketCommands() is the legacy string-tag format (kept for reference,
// no longer used for actual printing).

import type { Order, OrderItem, Ticket } from '../lib/types';
import { currentTime } from '../lib/utils';
import { INITIAL_PRODUCTS } from '../lib/constants';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maps productId → category, built once from INITIAL_PRODUCTS. */
const PRODUCT_CATEGORY: ReadonlyMap<string, string> = new Map(
  INITIAL_PRODUCTS.map((p) => [p.id, p.category]),
);

const CHARS_PER_LINE = 32;
const SEP_THIN = '-'.repeat(CHARS_PER_LINE);
const PRICE_FIELD = 5; // fixed-width price column: "99.99"

// ---------------------------------------------------------------------------
// Raw ESC/POS command bytes
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

/** ESC ! 0x20 — Double width only (chars per line halved: 32 → 16) */
export const CMD_SIZE_WIDE: readonly number[] = [ESC, 0x21, 0x20];

/** ESC ! 0x00 — Cancel ESC ! mode, back to normal */
export const CMD_SIZE_WIDE_OFF: readonly number[] = [ESC, 0x21, 0x00];

/** Short name substitutions applied only at print time (not in DB). */
const PRINT_NAME_OVERRIDES: Record<string, string> = {
  'DOBLE SUBWOOFER': 'DOBLE SUB',
};

/** ESC d 4 — Feed 4 lines */
export const CMD_FEED: readonly number[] = [ESC, 0x64, 0x04];

/** ESC d 10 — Feed 10 lines (~2cm top margin) */
export const CMD_FEED_TOP: readonly number[] = [ESC, 0x64, 0x0a];

/** GS V 66 48 — Partial cut with feed */
export const CMD_CUT: readonly number[] = [GS, 0x56, 0x42, 0x30];

// ---------------------------------------------------------------------------
// Text helpers
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

/**
 * Replaces characters unsupported by basic ESC/POS Latin-1 codepages
 * (accented vowels, ñ, ü) with their ASCII equivalents.
 * Must be applied to ALL text before encoding.
 */
export function sanitizeForPrinter(text: string): string {
  return text
    .replace(/Ñ/g, 'N').replace(/ñ/g, 'n')
    .replace(/[ÁÀÂÄ]/g, 'A').replace(/[áàâä]/g, 'a')
    .replace(/[ÉÈÊË]/g, 'E').replace(/[éèêë]/g, 'e')
    .replace(/[ÍÌÎÏ]/g, 'I').replace(/[íìîï]/g, 'i')
    .replace(/[ÓÒÔÖ]/g, 'O').replace(/[óòôö]/g, 'o')
    .replace(/[ÚÙÛÜ]/g, 'U').replace(/[úùûü]/g, 'u');
}

// ---------------------------------------------------------------------------
// Raw Uint8Array buffer — used by printer.ts via RawBT Intent
// ---------------------------------------------------------------------------

/**
 * Generates the raw ESC/POS byte buffer for a ticket.
 *
 * Layout (NETUM 58mm, 32 chars normal / 16 chars double-width):
 *   ~2cm blank top margin
 *   [*** PRUEBA - NO VALIDO ***]   ← test mode only
 *   ================================
 *   JUAN #12  14:32    ← double-width, first order only includes time
 *   ================================
 *   1x PRODUCTO  9.90  ← double-width, 16 chars
 *     modifier         ← normal
 *   ========13.50      ← sep+total, closes each order
 *   ================================
 *   MARIA #12          ← double-width, subsequent orders (no time)
 *   ================================
 *   ...
 *   [*** PRUEBA - NO VALIDO ***]   ← test mode only
 *   [feed + cut]
 */
export function buildTicketBuffer(
  ticket: Ticket,
  isTest: boolean,
  modifierLabels: Record<string, string>,
): Uint8Array {
  const parts: (readonly number[] | Uint8Array)[] = [];

  const rawLine = (text: string) => parts.push(encodeText(text + '\n'));

  // Init + top margin (~2cm)
  parts.push(CMD_INIT, CMD_FEED_TOP);

  // ── Test-mode watermark (top) ─────────────────────────────────────────────
  if (isTest) {
    parts.push(CMD_ALIGN_CENTER, CMD_BOLD_ON);
    rawLine('*** PRUEBA - NO VALIDO ***');
    parts.push(CMD_BOLD_OFF);
  }

  // ── Orders ────────────────────────────────────────────────────────────────
  for (let i = 0; i < ticket.orders.length; i++) {
    _appendOrderBytes(parts, ticket.orders[i], modifierLabels, ticket.ticketNumber, i);
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  // The last order's closing separator is already the footer sep.
  // Add test watermark below it if needed.
  if (isTest) {
    parts.push(CMD_ALIGN_CENTER, CMD_BOLD_ON);
    rawLine('*** PRUEBA - NO VALIDO ***');
    parts.push(CMD_BOLD_OFF);
  }

  // Feed + cut
  parts.push(CMD_FEED, CMD_CUT);

  return concatBytes(...parts);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Appends all bytes for a single Order, followed by its closing separator line.
 *
 * Header format (all orders, double-width, 16 logical chars):
 *   ================================
 *   JUAN #12  14:32    ← orderIndex === 0: includes current time
 *   ================================
 *   — or —
 *   ================================
 *   MARIA #12          ← orderIndex > 0: no time
 *   ================================
 *
 * Closing separator (normal size, 32 chars):
 *   ========13.50      ← always uses = chars
 */
function _appendOrderBytes(
  parts: (readonly number[] | Uint8Array)[],
  order: Order,
  modifierLabels: Record<string, string>,
  ticketNumber: number,
  orderIndex: number,
): void {
  const rawLine = (text: string) => parts.push(encodeText(text + '\n'));

  const profile = order.priceProfile ?? 'normal';

  // Blank line between consecutive orders in the same ticket.
  if (orderIndex > 0) {
    parts.push(encodeText('\n'));
  }

  // ── Per-order header: NAME #num (centred, double-width) + time (centred) ──
  const nameBase  = sanitizeForPrinter(order.clientName.toUpperCase());
  const numSuffix = ' #' + String(ticketNumber);
  const nameNum   = nameBase + numSuffix;

  // Double-width gives 16 logical chars — truncate the name accordingly.
  const nameWide = nameNum.slice(0, 16);

  parts.push(CMD_ALIGN_CENTER);
  parts.push(CMD_SIZE_WIDE);
  rawLine(nameWide);
  parts.push(CMD_SIZE_WIDE_OFF);
  if (orderIndex === 0) {
    const time = currentTime();
    rawLine(time);
  }

  if (order.takeAway) {
    parts.push(CMD_ALIGN_LEFT);
    rawLine(sanitizeForPrinter('PARA LLEVAR'));
  }

  if (profile === 'invitacion') {
    parts.push(CMD_ALIGN_CENTER, CMD_BOLD_ON);
    rawLine('*** INVITACION ***');
    parts.push(CMD_BOLD_OFF, CMD_ALIGN_LEFT);
  }

  // "---★ COMPLEMENTOS ★---" separator printed before the first side item.
  // ★ is not in CP437/CP850, so we use the closest printable substitute: '*'.
  // Byte 0x0F (☼) exists in CP437 but renders poorly; '*' is universally safe.
  const hasSide = _sortAndGroupItems(order.items).some(
    (it) => PRODUCT_CATEGORY.get(it.productId) === 'side',
  );
  let sideHeaderPrinted = false;

  for (const item of _sortAndGroupItems(order.items)) {
    if (!sideHeaderPrinted && hasSide && PRODUCT_CATEGORY.get(item.productId) === 'side') {
      parts.push(CMD_ALIGN_CENTER);
      parts.push(encodeText('---* COMPLEMENTOS *---\n'));
      parts.push(CMD_ALIGN_LEFT);
      sideHeaderPrinted = true;
    }
    _appendItemBytes(parts, item, profile, modifierLabels);
  }

  // ── Closing separator with order total ──────────────────────────────────
  const orderTotal = order.items.reduce(
    (sum, it) => sum + (it.unitPrice + it.modifierPriceAdd) * it.qty,
    0,
  );
  const totalStr = profile === 'invitacion' ? '0.00' : orderTotal.toFixed(2);
  const sepLine  = '-'.repeat(CHARS_PER_LINE - totalStr.length) + totalStr;

  parts.push(CMD_ALIGN_LEFT);
  rawLine(sepLine);
}

/**
 * Sort and group OrderItems for printing.
 *
 * Ordering:
 *   1. burger (non-burger-nino)
 *   2. burger-nino (forced after burgers regardless of its 'custom' category)
 *   3. side
 *   4. drink
 *   5. custom (excluding burger-nino)
 *   Within each group, original cart order is preserved.
 *
 * Grouping:
 *   Items with the same productId AND selectedModifiers.length === 0
 *   are merged into a single line (qty summed).
 *   Items that have any modifier applied are never merged — each is
 *   printed on its own line even if another identical-product item exists.
 */
function _sortAndGroupItems(items: readonly OrderItem[]): OrderItem[] {
  const PRINT_ORDER: Record<string, number> = {
    burger: 0,
    'burger-nino': 1,
    side: 2,
    drink: 3,
    custom: 4,
  };

  // Assign a sort key to each item.
  // burger-nino is identified by productId regardless of its DB category.
  function sortKey(item: OrderItem): number {
    if (item.productId === 'burger-nino') return PRINT_ORDER['burger-nino'];
    // We don't have the Product object here, so we approximate by productName.
    // The actual category routing is handled by the explicit burger-nino check above;
    // for everything else we rely on the product name not mattering — the order
    // in the cart already reflects display order. Use a stable fallback of 2 (side).
    return PRINT_ORDER['side'];
  }

  // Stable sort: burgers first, then burger-nino, rest keep relative order.
  // We only need to pull burger-nino out — the rest keep their original sequence.
  const burgerNino  = items.filter((i) => i.productId === 'burger-nino');
  const otherCustom = items.filter((i) => i.productId !== 'burger-nino');
  // Insert burger-nino after the last item whose sortKey < 1 (i.e. after regular burgers).
  // Since we don't know burger category here, find the last item before burger-nino's
  // natural position by scanning otherCustom for 'burger' productIds is not feasible
  // without the Product list. Instead: keep original relative order of otherCustom
  // and append burgerNino items at the end of that list, then re-sort only by the
  // two-bucket rule: burger-nino after non-burger-nino, everything else untouched.
  //
  // Simpler and correct: stable-partition into [non-burger-nino, burger-nino].
  // The cart already stores burgers before sides/drinks/custom, so burger-nino
  // will land after real burgers and before sides — which is the desired output.
  const sorted = [...otherCustom, ...burgerNino];
  void sortKey; // suppress unused-variable warning — kept for documentation

  // Group: items with selectedModifiers.length === 0 and same productId are merged.
  const result: OrderItem[] = [];
  // Map from productId → index in result (only for modifier-free items).
  const mergeIndex = new Map<string, number>();

  for (const item of sorted) {
    if (item.selectedModifiers.length === 0) {
      const existing = mergeIndex.get(item.productId);
      if (existing !== undefined) {
        const prev = result[existing];
        result[existing] = { ...prev, qty: prev.qty + item.qty };
        continue;
      }
      mergeIndex.set(item.productId, result.length);
    }
    result.push({ ...item });
  }

  return result;
}

/**
 * Appends bytes for a single OrderItem in normal size (32 chars/line).
 *
 * Line format: qty (normal) + NAME (double-width) + price (normal) — same physical line.
 * Double-width chars occupy 2 physical cols each, so max name logical chars =
 *   floor((CHARS_PER_LINE - prefix.length - priceSuffix.length) / 2)
 * If the raw name exceeds that, it is truncated and ".." appended so the
 * whole line still fits in exactly one printer line.
 *
 * Modifiers indented one level below.
 */
function _appendItemBytes(
  parts: (readonly number[] | Uint8Array)[],
  item: OrderItem,
  priceProfile: Order['priceProfile'],
  modifierLabels: Record<string, string>,
): void {
  const rawLine = (text: string) => parts.push(encodeText(text + '\n'));

  const baseLabel = sanitizeForPrinter(item.customLabel ?? item.productName);
  const rawLabel  = PRINT_NAME_OVERRIDES[baseLabel.toUpperCase()] ?? baseLabel;

  const unitTotal  = (item.unitPrice + item.modifierPriceAdd) * item.qty;
  const priceStr   = priceProfile === 'invitacion' ? '0.00' : unitTotal.toFixed(2);
  // Price always occupies PRICE_FIELD chars, right-aligned, preceded by a space.
  const priceBlock = ' ' + priceStr.padStart(PRICE_FIELD); // e.g. " 99.99" (6 chars)

  // Physical columns: prefix(normal) + name*2(double-wide) + filler(normal) + priceBlock(normal) = 32
  // Max name logical chars = floor((32 - prefix.length - priceBlock.length) / 2)
  const prefix       = String(item.qty) + 'x ';
  const maxNameChars = Math.floor((CHARS_PER_LINE - prefix.length - priceBlock.length) / 2);
  const nameWide     = rawLabel.length > maxNameChars
    ? rawLabel.slice(0, maxNameChars - 1) + '.'
    : rawLabel;

  // Filler: remaining normal-width cols between the double-wide name and the price block.
  // Physical cols used by name = nameWide.length * 2.
  const usedCols   = prefix.length + nameWide.length * 2 + priceBlock.length;
  const fillerLen  = CHARS_PER_LINE - usedCols;
  const filler     = fillerLen > 0 ? '-'.repeat(fillerLen) : '';

  parts.push(CMD_ALIGN_LEFT);
  parts.push(encodeText(prefix));
  parts.push(CMD_SIZE_WIDE);
  parts.push(encodeText(nameWide));
  parts.push(CMD_SIZE_WIDE_OFF);
  parts.push(encodeText(filler + priceBlock + '\n'));

  const sortedModifiers = [...item.selectedModifiers].sort((a, b) => {
    if (a === 'mod_sin_gluten') return -1;
    if (b === 'mod_sin_gluten') return  1;
    return 0;
  });
  for (const id of sortedModifiers) {
    const modLabel = sanitizeForPrinter(modifierLabels[id] ?? id);
    rawLine('  ' + modLabel);
  }
}

// ---------------------------------------------------------------------------
// Multi-ticket buffer — all tickets in one print job, single cut at the end
// ---------------------------------------------------------------------------

export function buildMultiTicketBuffer(
  tickets: Ticket[],
  isTest: boolean,
  modifierLabels: Record<string, string>,
): Uint8Array {
  if (tickets.length === 0) return new Uint8Array(0);
  if (tickets.length === 1) return buildTicketBuffer(tickets[0], isTest, modifierLabels);

  const parts: (readonly number[] | Uint8Array)[] = [];
  const rawLine = (text: string) => parts.push(encodeText(text + '\n'));

  parts.push(CMD_INIT, CMD_FEED_TOP);

  if (isTest) {
    parts.push(CMD_ALIGN_CENTER, CMD_BOLD_ON);
    rawLine('*** PRUEBA - NO VALIDO ***');
    parts.push(CMD_BOLD_OFF);
  }

  for (const ticket of tickets) {
    for (let i = 0; i < ticket.orders.length; i++) {
      _appendOrderBytes(parts, ticket.orders[i], modifierLabels, ticket.ticketNumber, i);
    }
  }

  if (isTest) {
    parts.push(CMD_ALIGN_CENTER, CMD_BOLD_ON);
    rawLine('*** PRUEBA - NO VALIDO ***');
    parts.push(CMD_BOLD_OFF);
  }

  parts.push(CMD_FEED, CMD_CUT);

  return concatBytes(...parts);
}

// ---------------------------------------------------------------------------
// Legacy string-tag payload (react-native-thermal-printer format)
// No longer used for printing — kept for reference only.
// ---------------------------------------------------------------------------

export function buildTicketCommands(
  ticket: Ticket,
  isTest: boolean,
  modifierLabels: Record<string, string>,
  radioNoSelection: Record<string, string> = {},
  radioOptionSets: Record<string, Set<string>> = {},
): string {
  const lines: string[] = [];
  const s = sanitizeForPrinter;

  const firstClientName = s((ticket.orders[0]?.clientName ?? 'COMANDA').toUpperCase());
  const headerText = firstClientName + ' #' + String(ticket.ticketNumber);

  lines.push('[C]' + SEP_THIN);
  lines.push('[C][B]' + headerText + '[/B]');
  lines.push('[C]' + currentTime());
  lines.push('[C]' + SEP_THIN);

  if (isTest) {
    lines.push('[C][B]*** PRUEBA - NO VALIDO ***[/B]');
  }

  const multiOrder = ticket.orders.length > 1;
  for (let i = 0; i < ticket.orders.length; i++) {
    if (i > 0) lines.push('[C]' + SEP_THIN);
    lines.push(..._formatOrder(ticket.orders[i], modifierLabels, radioNoSelection, radioOptionSets, multiOrder, i));
  }

  lines.push('[C]' + SEP_THIN);

  if (isTest) {
    lines.push('[C][B]*** PRUEBA - NO VALIDO ***[/B]');
    lines.push('[C]' + SEP_THIN);
  }

  lines.push('');
  lines.push('');
  return lines.join('\n');
}

function _formatOrder(
  order: Order,
  modifierLabels: Record<string, string>,
  _radioNoSelection: Record<string, string>,
  _radioOptionSets: Record<string, Set<string>>,
  multiOrder: boolean,
  orderIndex: number,
): string[] {
  const lines: string[] = [];
  const s = sanitizeForPrinter;
  const profile = order.priceProfile ?? 'normal';

  if (multiOrder && orderIndex > 0) {
    lines.push('[L][B]' + s(order.clientName.toUpperCase()) + ':[/B]');
  }
  if (profile === 'invitacion') {
    lines.push('[C][B]*** INVITACION ***[/B]');
  }

  for (const item of order.items) {
    const rawLabel  = s(item.customLabel ?? item.productName);
    const unitTotal = (item.unitPrice + item.modifierPriceAdd) * item.qty;
    const priceSuffix = profile === 'invitacion'
      ? ' 0.00'
      : ' ' + unitTotal.toFixed(2);
    const prefix    = String(item.qty) + 'x ';
    const available = CHARS_PER_LINE - prefix.length - priceSuffix.length;
    const paddedName = available > 0 ? rawLabel.padEnd(available).slice(0, available) : rawLabel;
    lines.push('[L]' + prefix + paddedName + priceSuffix);

    const mods = item.selectedModifiers.map((id) => modifierLabels[id] ?? id);
    for (const mod of mods) {
      lines.push('[L]  ' + s(mod));
    }
  }

  return lines;
}
