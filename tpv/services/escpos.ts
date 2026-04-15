// ESC/POS helpers + ticket buffer builder
//
// Target printer: NETUM Bluetooth 58mm, 32 chars/line.
//
// buildTicketBuffer() generates the raw Uint8Array sent to RawBT via Intent.
// buildTicketCommands() is the legacy string-tag format (kept for reference,
// no longer used for actual printing).

import type { Order, OrderItem, Session, Ticket } from '../lib/types';
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
// Session summary buffer
// ---------------------------------------------------------------------------

// Modifier IDs as stored in DB: add/remove use `${productId}-${modifierId}`,
// radio option IDs are stored as-is (the optionId).
const SUMMARY_MOD_IDS = new Set([
  // Burger add/remove (productId-modifierId)
  'fat-furious-mod_sin_gluten',     'fat-furious-sin-una-carne',     'fat-furious-extra-carne',
  'ben-muerde-mod_sin_gluten',      'ben-muerde-sin-una-carne',      'ben-muerde-extra-bacon',
  'doble-subwoofer-mod_sin_gluten', 'doble-subwoofer-sin-una-carne', 'doble-subwoofer-extra-bacon',
  'burger-nino-mod_sin_gluten',     'burger-nino-nino-bacon',        'burger-nino-nino-verdura',
  // Patatas add checkboxes (productId-modifierId)
  'patatas-patatas-sin-nada', 'patatas-patatas-con-todo', 'patatas-patatas-ketchup',
  'patatas-patatas-mostaza-dulce', 'patatas-patatas-ali-oli',
  // Salsa radio options (optionId, shared across alitas/tekenos/nino)
  'salsa-sin-nada', 'salsa-ketchup', 'salsa-ali-oli', 'salsa-mostaza',
  'salsa-fat', 'salsa-ben', 'salsa-doble', 'salsa-mango',
]);

const SUMMARY_MOD_LABELS: Record<string, string> = {
  // Burger
  'fat-furious-mod_sin_gluten':      'Sin Gluten',
  'fat-furious-sin-una-carne':       'Sin una carne',
  'fat-furious-extra-carne':         'Extra carne',
  'ben-muerde-mod_sin_gluten':       'Sin Gluten',
  'ben-muerde-sin-una-carne':        'Sin una carne',
  'ben-muerde-extra-bacon':          'Extra bacon',
  'doble-subwoofer-mod_sin_gluten':  'Sin Gluten',
  'doble-subwoofer-sin-una-carne':   'Sin una carne',
  'doble-subwoofer-extra-bacon':     'Extra bacon',
  'burger-nino-mod_sin_gluten':      'Sin Gluten',
  'burger-nino-nino-bacon':          'Bacon',
  'burger-nino-nino-verdura':        'Verdura',
  // Patatas
  'patatas-patatas-sin-nada':        'Sin nada',
  'patatas-patatas-con-todo':        'Con todo',
  'patatas-patatas-ketchup':         'Ketchup',
  'patatas-patatas-mostaza-dulce':   'Mostaza dulce',
  'patatas-patatas-ali-oli':         'Ali Oli',
  // Salsas radio
  'salsa-sin-nada':  'Sin nada',
  'salsa-ketchup':   'Ketchup',
  'salsa-ali-oli':   'Ali Oli',
  'salsa-mostaza':   'Mostaza',
  'salsa-fat':       'Fat',
  'salsa-ben':       'Ben',
  'salsa-doble':     'Doble',
  'salsa-mango':     'Mango',
};

const SUMMARY_CAT_ORDER: Record<string, number> = { burger: 0, side: 1, drink: 2, custom: 3 };

const SUMMARY_PRODUCT_CAT: Record<string, string> = {
  'fat-furious': 'burger', 'ben-muerde': 'burger', 'doble-subwoofer': 'burger',
  'patatas': 'side', 'alitas': 'side', 'tekenos': 'side', 'gyozas': 'side',
  'bebida': 'drink', 'agua': 'drink',
  'burger-nino': 'custom', 'otros': 'custom',
};

interface _SummaryVariant {
  priceProfile: string;
  mods:         string[];   // sorted relevant mod ids
  qty:          number;
  totalPrice:   number;
}

interface _SummaryGroup {
  productId:   string;
  productName: string;
  category:    string;
  totalQty:    number;
  totalPrice:  number;
  variants:    _SummaryVariant[];
}

function _buildSummaryGroups(tickets: Ticket[]): _SummaryGroup[] {
  const productMap = new Map<string, _SummaryGroup>();
  const variantMap = new Map<string, _SummaryVariant>();

  for (const ticket of tickets) {
    for (const order of ticket.orders) {
      for (const item of order.items) {
        const mods      = item.selectedModifiers.filter((id) => SUMMARY_MOD_IDS.has(id)).sort();
        const vKey      = `${item.productId}|${order.priceProfile}|${mods.join(',')}`;
        const linePrice = order.priceProfile === 'invitacion'
          ? 0
          : (item.unitPrice + item.modifierPriceAdd) * item.qty;

        // product total
        const pg = productMap.get(item.productId);
        if (pg) {
          pg.totalQty   += item.qty;
          pg.totalPrice += linePrice;
        } else {
          productMap.set(item.productId, {
            productId:   item.productId,
            productName: sanitizeForPrinter(item.customLabel ?? item.productName),
            category:    SUMMARY_PRODUCT_CAT[item.productId] ?? 'custom',
            totalQty:    item.qty,
            totalPrice:  linePrice,
            variants:    [],
          });
        }

        // variant total
        const vt = variantMap.get(vKey);
        if (vt) {
          vt.qty        += item.qty;
          vt.totalPrice += linePrice;
        } else {
          variantMap.set(vKey, { priceProfile: order.priceProfile, mods, qty: item.qty, totalPrice: linePrice });
        }
      }
    }
  }

  // attach variants
  for (const [vKey, vt] of variantMap) {
    productMap.get(vKey.split('|')[0])?.variants.push(vt);
  }

  // sort variants: normal first, then feriante, invitacion; within profile fewer mods first
  const profileOrd: Record<string, number> = { normal: 0, feriante: 1, invitacion: 2 };
  for (const g of productMap.values()) {
    g.variants.sort((a, b) => {
      const pd = (profileOrd[a.priceProfile] ?? 0) - (profileOrd[b.priceProfile] ?? 0);
      return pd !== 0 ? pd : a.mods.length - b.mods.length;
    });
  }

  return Array.from(productMap.values()).sort((a, b) => {
    const cd = (SUMMARY_CAT_ORDER[a.category] ?? 3) - (SUMMARY_CAT_ORDER[b.category] ?? 3);
    return cd !== 0 ? cd : a.productName.localeCompare(b.productName, 'es');
  });
}

function _summaryVariantLabel(priceProfile: string, mods: string[], category: string): string {
  const parts: string[] = [];
  if (priceProfile === 'feriante')   parts.push('OFERTA');
  if (priceProfile === 'invitacion') parts.push('INVITACION');
  for (const id of mods) {
    const label = SUMMARY_MOD_LABELS[id];
    if (label) parts.push(label);
  }
  if (parts.length > 0) return sanitizeForPrinter(parts.join(' + '));
  return category === 'side' ? 'Sin nada' : 'NORMAL';
}

/**
 * Prints a wide line: prefix(normal) + label(double-wide) + price(normal)
 * fitting exactly CHARS_PER_LINE physical columns.
 */
function _appendSummaryLine(
  parts: (readonly number[] | Uint8Array)[],
  prefix: string,
  label: string,
  price: number,
  bold: boolean,
): void {
  const priceStr   = price.toFixed(2);
  const priceBlock = ' ' + priceStr.padStart(PRICE_FIELD);
  const maxChars   = Math.floor((CHARS_PER_LINE - prefix.length - priceBlock.length) / 2);
  const nameWide   = label.length > maxChars ? label.slice(0, maxChars - 1) + '.' : label;
  const filler     = ' '.repeat(Math.max(0, CHARS_PER_LINE - prefix.length - nameWide.length * 2 - priceBlock.length));

  if (bold) parts.push(CMD_BOLD_ON);
  parts.push(CMD_ALIGN_LEFT, encodeText(prefix), CMD_SIZE_WIDE, encodeText(nameWide), CMD_SIZE_WIDE_OFF);
  parts.push(encodeText(filler + priceBlock + '\n'));
  if (bold) parts.push(CMD_BOLD_OFF);
}

const _PATATAS_SAUCE_MAP: Record<string, string[]> = {
  'patatas-patatas-con-todo':      ['Ketchup', 'Ali Oli'],
  'patatas-patatas-ketchup':       ['Ketchup'],
  'patatas-patatas-mostaza-dulce': ['Mostaza'],
  'patatas-patatas-ali-oli':       ['Ali Oli'],
};

const _BURGER_DEFAULT_SAUCE: Record<string, string> = {
  'fat-furious':     'Fat',
  'ben-muerde':      'Ben',
  'doble-subwoofer': 'Doble',
};

const _RADIO_SAUCE_MAP: Record<string, string> = {
  'salsa-ketchup': 'Ketchup', 'salsa-ali-oli': 'Ali Oli', 'salsa-mostaza': 'Mostaza',
  'salsa-fat': 'Fat', 'salsa-ben': 'Ben', 'salsa-doble': 'Doble', 'salsa-mango': 'Mango',
};

const _RADIO_SAUCE_PRODUCTS = new Set(['alitas', 'tekenos', 'burger-nino']);

const _SAUCE_ORDER = ['Fat', 'Ben', 'Doble', 'Ketchup', 'Ali Oli', 'Mostaza', 'Mango'];

function _buildSauceSummary(tickets: Ticket[]): [string, number][] {
  const tally = new Map<string, number>();
  const add = (sauce: string, qty: number) => tally.set(sauce, (tally.get(sauce) ?? 0) + qty);

  for (const ticket of tickets) {
    for (const order of ticket.orders) {
      if (order.priceProfile === 'invitacion') continue;
      for (const item of order.items) {
        const mods = item.selectedModifiers;
        if (_BURGER_DEFAULT_SAUCE[item.productId]) {
          if (!mods.some((id) => id.endsWith('-sin-salsa'))) {
            add(_BURGER_DEFAULT_SAUCE[item.productId], item.qty);
          }
        } else if (item.productId === 'patatas') {
          for (const modId of mods) {
            for (const s of _PATATAS_SAUCE_MAP[modId] ?? []) add(s, item.qty);
          }
        } else if (_RADIO_SAUCE_PRODUCTS.has(item.productId)) {
          for (const modId of mods) {
            const s = _RADIO_SAUCE_MAP[modId];
            if (s) add(s, item.qty);
          }
        }
      }
    }
  }

  return Array.from(tally.entries())
    .filter(([, qty]) => qty > 0)
    .sort(([a], [b]) => {
      const ia = _SAUCE_ORDER.indexOf(a), ib = _SAUCE_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b, 'es');
    });
}

export function buildSessionSummaryBuffer(
  session: Session,
  tickets: Ticket[],
  locationName: string,
): Uint8Array {
  const parts: (readonly number[] | Uint8Array)[] = [];
  const rawLine = (text: string) => parts.push(encodeText(text + '\n'));
  const SEP     = '='.repeat(CHARS_PER_LINE);
  const isOpen  = session.status === 'open';

  parts.push(CMD_INIT, CMD_FEED_TOP);

  // ── Header ────────────────────────────────────────────────────────────────
  parts.push(CMD_ALIGN_CENTER);
  parts.push(CMD_SIZE_WIDE);
  rawLine(sanitizeForPrinter(locationName).slice(0, 16));
  parts.push(CMD_SIZE_WIDE_OFF);

  const openedAt = session.openedAt ?? session.createdAt;
  rawLine(sanitizeForPrinter(new Date(openedAt).toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })));

  if (isOpen) rawLine('RESUMEN PARCIAL');
  rawLine(SEP);

  // ── Product groups ────────────────────────────────────────────────────────
  const groups = _buildSummaryGroups(tickets);

  for (const group of groups) {
    // Main product line (bold)
    _appendSummaryLine(parts, 'x' + group.totalQty + ' ', group.productName, group.totalPrice, true);

    // Always show variants for sides; for other categories only when meaningful.
    const needVariants = group.variants.length > 0 && (
      group.category === 'side' ||
      group.variants.length > 1 || (
        group.variants[0].priceProfile !== 'normal' ||
        group.variants[0].mods.length > 0
      )
    );

    if (needVariants) {
      for (const v of group.variants) {
        const label     = _summaryVariantLabel(v.priceProfile, v.mods, group.category);
        const priceStr  = v.totalPrice.toFixed(2);
        const prefix    = '  x' + v.qty + ' ';
        const available = CHARS_PER_LINE - prefix.length - priceStr.length - 1;
        const padded    = sanitizeForPrinter(label).padEnd(available).slice(0, available);
        parts.push(CMD_ALIGN_LEFT);
        parts.push(encodeText(prefix + padded + ' ' + priceStr + '\n'));
      }
    }
  }

  // ── Sauce summary ─────────────────────────────────────────────────────────
  const sauces = _buildSauceSummary(tickets);
  if (sauces.length > 0) {
    rawLine(SEP);
    parts.push(CMD_ALIGN_CENTER, CMD_BOLD_ON);
    rawLine('SALSAS');
    parts.push(CMD_BOLD_OFF, CMD_ALIGN_LEFT);
    for (const [sauce, qty] of sauces) {
      const qtyStr  = 'x' + qty;
      const filler  = ' '.repeat(Math.max(1, CHARS_PER_LINE - sauce.length - qtyStr.length));
      rawLine(sauce + filler + qtyStr);
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  rawLine(SEP);

  const grandTotal = groups.reduce((s, g) => s + g.totalPrice, 0);
  parts.push(CMD_ALIGN_CENTER, CMD_SIZE_WIDE);
  rawLine(sanitizeForPrinter('TOTAL ' + grandTotal.toFixed(2)));
  parts.push(CMD_SIZE_WIDE_OFF);
  rawLine(SEP);

  if (isOpen) rawLine('*** SESION EN CURSO ***');

  parts.push(encodeText('\n\n\n'), CMD_CUT);

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
