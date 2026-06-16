// ESC/POS helpers + ticket buffer builder
//
// Target printer: NETUM Bluetooth 58mm, 32 chars/line.
//
// buildTicketBuffer() generates the raw Uint8Array sent to RawBT via Intent.
// buildTicketCommands() is the legacy string-tag format (kept for reference,
// no longer used for actual printing).

import type { Order, OrderItem, Session, Ticket } from '../lib/types';
import { collapseVerduraModifiers, currentTime } from '../lib/utils';
import { LOGO_RASTER_BYTES, IG_LOGO_RASTER_BYTES, EMAIL_LOGO_RASTER_BYTES } from './logo-bytes';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------


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

/** ESC t 19 — Select codepage CP858 (Latin-1 + €). Required for ñ/á/é/í/ó/ú. */
export const CMD_CODEPAGE_CP858: readonly number[] = [ESC, 0x74, 0x13];

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

/** GS ! 0x33 — 4× width + 4× height */
export const CMD_SIZE_4X: readonly number[] = [GS, 0x21, 0x33];

/** ESC ! 0x20 — Double width only (chars per line halved: 32 → 16) */
export const CMD_SIZE_WIDE: readonly number[] = [ESC, 0x21, 0x20];

/** ESC ! 0x00 — Cancel ESC ! mode, back to normal */
export const CMD_SIZE_WIDE_OFF: readonly number[] = [ESC, 0x21, 0x00];

/** Short name substitutions applied only at print time (not in DB). */
const PRINT_NAME_OVERRIDES: Record<string, string> = {
  'DOBLE SUBWOOFER': 'DOBLE SUB',
  'BURGER VEGETARIANA': 'BURG. VEGET.',
  'GYOZAS POLLO': 'GYOZ. POLLO',
  'GYOZAS VERDURA': 'GYOZ. VERDU',
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

/**
 * CP858 codepage mapping for the characters used in Spanish text.
 * CP858 is selected at print start via CMD_CODEPAGE_CP858. Any character
 * not in this map falls back to its raw char code (works for ASCII 0x20–0x7E).
 */
const CP858_MAP: Record<string, number> = {
  'á': 0xa0, 'é': 0x82, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3,
  'Á': 0xb5, 'É': 0x90, 'Í': 0xd6, 'Ó': 0xe0, 'Ú': 0xe9,
  'ñ': 0xa4, 'Ñ': 0xa5,
  'ü': 0x81, 'Ü': 0x9a,
  'à': 0x85, 'è': 0x8a, 'ì': 0x8d, 'ò': 0x95, 'ù': 0x97,
  'À': 0xb7, 'È': 0xd4, 'Ì': 0xde, 'Ò': 0xe3, 'Ù': 0xeb,
  'â': 0x83, 'ê': 0x88, 'î': 0x8c, 'ô': 0x93, 'û': 0x96,
  'ä': 0x84, 'ë': 0x89, 'ï': 0x8b, 'ö': 0x94,
  '¿': 0xa8, '¡': 0xad, '€': 0xd5, 'º': 0xa7, 'ª': 0xa6,
};

/** Encodes a string to CP858 bytes for the printer. */
export function encodeText(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const mapped = CP858_MAP[ch];
    bytes[i] = mapped !== undefined ? mapped : text.charCodeAt(i) & 0xff;
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
 * Pass-through. Accented characters are now handled by encodeText() via the
 * CP858 codepage (selected at print start with CMD_CODEPAGE_CP858).
 * Kept for backwards compatibility with existing call sites.
 */
export function sanitizeForPrinter(text: string): string {
  return text;
}

/** Word-wraps a string to the given column width, breaking on spaces. */
function _wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
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
 *   [GRACIAS POR VENIR :)]         ← double-print mode only
 *   [feed + cut]
 *
 * This always builds a SINGLE copy. In double-print mode (`repeatContent`),
 * the copy gains a promo header (logo + catering message) and a thank-you
 * footer; printer.ts sends the resulting buffer twice with a pause between.
 */
export function buildTicketBuffer(
  ticket: Ticket,
  isTest: boolean,
  modifierLabels: Record<string, string>,
  repeatContent: boolean = false,
  normalPrices: Record<string, number> = {},
): Uint8Array {
  const parts: (readonly number[] | Uint8Array)[] = [];

  const rawLine = (text: string) => parts.push(encodeText(text + '\n'));

  // Init + select CP858 for accented characters (á, é, í, ó, ú, ñ, ü…)
  parts.push(CMD_INIT, CMD_CODEPAGE_CP858);

  // Promotional header at the very top, only when printing twice:
  // logo + catering message + Instagram handle. The normal top margin is
  // skipped here because the logo already provides visual breathing room.
  if (repeatContent) {
    parts.push(CMD_ALIGN_CENTER);
    parts.push(LOGO_RASTER_BYTES);
    rawLine('');
    const promoLines = _wrapText(
      sanitizeForPrinter(
        'Escríbenos para reservar tu pedido o servicio de catering ' +
        'para eventos privados o comidas populares (paellas, ' +
        'almuerzo segador, bocadillos, etc ...)',
      ),
      CHARS_PER_LINE,
    );
    for (const line of promoLines) rawLine(line);
    rawLine('');
    // Email icon + address, then Instagram icon + @handle (each composed in
    // logo-bytes.ts as a single raster row).
    parts.push(EMAIL_LOGO_RASTER_BYTES);
    rawLine('');
    parts.push(IG_LOGO_RASTER_BYTES);
    parts.push(CMD_ALIGN_LEFT);
    rawLine('');
    rawLine('');
  } else {
    // Single-copy mode keeps the original ~2cm top margin.
    parts.push(CMD_FEED_TOP);
  }

  // ── Test-mode watermark (top) ─────────────────────────────────────────────
  if (isTest) {
    parts.push(CMD_ALIGN_CENTER, CMD_BOLD_ON);
    rawLine('*** PRUEBA - NO VALIDO ***');
    parts.push(CMD_BOLD_OFF);
  }

  // ── Orders ────────────────────────────────────────────────────────────────
  for (let i = 0; i < ticket.orders.length; i++) {
    _appendOrderBytes(parts, ticket.orders[i], modifierLabels, ticket.ticketNumber, i, normalPrices);
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  if (isTest) {
    parts.push(CMD_ALIGN_CENTER, CMD_BOLD_ON);
    rawLine('*** PRUEBA - NO VALIDO ***');
    parts.push(CMD_BOLD_OFF);
  }

  // Thank-you message at the bottom of each copy (only in double-print mode).
  if (repeatContent) {
    parts.push(CMD_ALIGN_CENTER, CMD_BOLD_ON);
    rawLine('GRACIAS POR VENIR :)');
    parts.push(CMD_BOLD_OFF, CMD_ALIGN_LEFT);
  }

  // Feed + cut at the very end of this copy.
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
  normalPrices: Record<string, number> = {},
): void {
  const rawLine = (text: string) => parts.push(encodeText(text + '\n'));

  const profile = order.priceProfile ?? 'normal';

  // Blank line between consecutive orders in the same ticket.
  if (orderIndex > 0) {
    parts.push(encodeText('\n'));
  }

  // ── Per-order header: NAME (double-width) + #num (double-width+height) ──
  const nameBase  = sanitizeForPrinter(order.clientName.toUpperCase());
  // Double-width gives 16 logical chars max for the name.
  const nameWide  = nameBase.slice(0, 16);
  // CMD_SIZE_DOUBLE (2× width + 2× height) → 8 logical chars per line.
  const numLabel  = '#' + String(ticketNumber);

  parts.push(CMD_ALIGN_CENTER);
  parts.push(CMD_SIZE_WIDE);
  rawLine(nameWide);
  parts.push(CMD_SIZE_WIDE_OFF);
  parts.push(CMD_SIZE_4X);
  rawLine(numLabel);
  parts.push(CMD_SIZE_NORMAL);
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

  const sorted = _sortAndGroupItems(order.items);
  const firstSideIdx = sorted.findIndex((it) => KITCHEN_ORDER[it.productId] >= KITCHEN_ORDER['patatas']);
  for (let i = 0; i < sorted.length; i++) {
    if (i === firstSideIdx) {
      parts.push(CMD_ALIGN_CENTER);
      parts.push(encodeText('---* COMPLEMENTOS *---\n'));
      parts.push(CMD_ALIGN_LEFT);
    }
    _appendItemBytes(parts, sorted[i], profile, modifierLabels, normalPrices);
  }

  // ── Closing separator with order total ──────────────────────────────────
  // For feriante orders, compute original total (normal prices) and discount.
  let originalTotal = 0;
  let totalDiscount = 0;
  for (const it of order.items) {
    const normalUnitPrice = (profile === 'feriante' ? normalPrices[it.productId] : undefined) ?? it.unitPrice;
    const hasDiscount = profile === 'feriante' && normalUnitPrice > it.unitPrice + 0.001;
    originalTotal += (normalUnitPrice + it.modifierPriceAdd) * it.qty;
    if (hasDiscount) totalDiscount += (normalUnitPrice - it.unitPrice) * it.qty;
  }
  const ferianteTotal = originalTotal - totalDiscount;

  const _sepLabel = (label: string, amount: string): string => {
    const dashes = Math.max(1, CHARS_PER_LINE - label.length - amount.length);
    return label + '-'.repeat(dashes) + amount;
  };

  parts.push(CMD_ALIGN_LEFT);

  if (profile === 'invitacion') {
    rawLine(_sepLabel('TOTAL', '0.00'));
  } else if (profile === 'feriante' && totalDiscount > 0.001) {
    rawLine(_sepLabel('TOTAL', originalTotal.toFixed(2)));
    const dtoStr = '-' + totalDiscount.toFixed(2);
    rawLine('DESCUENTO' + '.'.repeat(Math.max(1, CHARS_PER_LINE - 9 - dtoStr.length)) + dtoStr);
    parts.push(CMD_BOLD_ON);
    rawLine(_sepLabel('TOTAL CON DTO', ferianteTotal.toFixed(2)));
    parts.push(CMD_BOLD_OFF);
  } else {
    rawLine(_sepLabel('TOTAL', (profile === 'feriante' ? ferianteTotal : originalTotal).toFixed(2)));
  }
}

/**
 * Sort and group OrderItems for printing.
 *
 * Fixed kitchen order (by productId):
 *   doble-subwoofer → ben-muerde → fat-furious → burger-nino →
 *   patatas → alitas → tekenos → gyozas-pollo → gyozas-verdura → bebida → agua → otros (catch-all last)
 *
 * Grouping:
 *   Items with the same productId AND same selectedModifiers (sorted) are merged
 *   into a single line with qty summed.
 */
const KITCHEN_ORDER: Record<string, number> = {
  'doble-subwoofer': 0,
  'ben-muerde':      1,
  'fat-furious':     2,
  'burger-nino':     3,
  'burger-veget':    3,
  'patatas':         4,
  'alitas':          5,
  'tekenos':         6,
  'gyozas-pollo':    7,
  'gyozas-verdura':  7,
  'bebida':          8,
  'agua':            9,
};

function _sortAndGroupItems(items: readonly OrderItem[]): OrderItem[] {
  // Merge items with identical productId + modifiers
  const mergeMap = new Map<string, OrderItem>();
  for (const item of items) {
    const key = item.productId + '|' + [...item.selectedModifiers].sort().join(',');
    const existing = mergeMap.get(key);
    if (existing) {
      mergeMap.set(key, { ...existing, qty: existing.qty + item.qty });
    } else {
      mergeMap.set(key, { ...item });
    }
  }

  return Array.from(mergeMap.values()).sort((a, b) => {
    const oa = KITCHEN_ORDER[a.productId] ?? 99;
    const ob = KITCHEN_ORDER[b.productId] ?? 99;
    return oa !== ob ? oa - ob : 0;
  });
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
  normalPrices: Record<string, number> = {},
): void {
  const rawLine = (text: string) => parts.push(encodeText(text + '\n'));

  const baseLabel = sanitizeForPrinter(item.customLabel ?? item.productName);
  const rawLabel  = PRINT_NAME_OVERRIDES[baseLabel.toUpperCase()] ?? baseLabel;

  // For feriante items with a known normal price, show the original (pre-discount) price on the line.
  const normalUnitPrice = (priceProfile === 'feriante' ? normalPrices[item.productId] : undefined) ?? item.unitPrice;
  const displayUnitPrice = (priceProfile === 'feriante' && normalUnitPrice > item.unitPrice + 0.001)
    ? normalUnitPrice
    : item.unitPrice;
  const unitTotal  = (displayUnitPrice + item.modifierPriceAdd) * item.qty;
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

  const { ids: collapsedIds, extraLabels } = collapseVerduraModifiers(item.selectedModifiers);
  const sortedModifiers = collapsedIds.sort((a, b) => {
    if (a === 'mod_sin_gluten') return -1;
    if (b === 'mod_sin_gluten') return  1;
    return 0;
  });
  for (const id of sortedModifiers) {
    const modLabel = sanitizeForPrinter(extraLabels[id] ?? modifierLabels[id] ?? id);
    rawLine('  ' + modLabel);
  }

  // Feriante discount line: shown when the normal price is higher than the feriante unit price.
  if (priceProfile === 'feriante' && normalUnitPrice > item.unitPrice + 0.001) {
    const discountTotal = (normalUnitPrice - item.unitPrice) * item.qty;
    const dStr   = '-' + discountTotal.toFixed(2);
    const dBlock = ' ' + dStr.padStart(PRICE_FIELD + 1); // +1 for the minus sign
    const dLabel = '  DTO. FERIANTE';
    const dotsLen = CHARS_PER_LINE - dLabel.length - dBlock.length;
    const dots = dotsLen > 0 ? '.'.repeat(dotsLen) : '';
    rawLine(dLabel + dots + dBlock);
  }
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
  'patatas': 'side', 'alitas': 'side', 'tekenos': 'side', 'gyozas-pollo': 'side', 'gyozas-verdura': 'side',
  'bebida': 'drink', 'agua': 'drink',
  'burger-nino': 'custom', 'burger-veget': 'custom', 'otros': 'custom',
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

function _summaryVariantLabel(priceProfile: string, mods: string[]): string {
  const parts: string[] = [];
  if (priceProfile === 'feriante')   parts.push('OFERTA');
  if (priceProfile === 'invitacion') parts.push('INVITACION');
  for (const id of mods) {
    const label = SUMMARY_MOD_LABELS[id];
    if (label) parts.push(label);
  }
  return sanitizeForPrinter(parts.length > 0 ? parts.join(' + ') : 'Normal');
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

const _DEFAULT_SAUCE_WHEN_NORMAL: Record<string, string> = {
  'alitas':  'Salsa Alitas',
  'tekenos': 'Mango',
  'gyozas':  'Soja',
};

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
          const radioSauce = mods.map((id) => _RADIO_SAUCE_MAP[id]).find(Boolean);
          if (radioSauce) {
            add(radioSauce, item.qty);
          } else if (!mods.includes('salsa-sin-nada')) {
            const def = _DEFAULT_SAUCE_WHEN_NORMAL[item.productId];
            if (def) add(def, item.qty);
          }
        } else if (item.productId === 'gyozas-pollo' || item.productId === 'gyozas-verdura') {
          add(_DEFAULT_SAUCE_WHEN_NORMAL['gyozas'], item.qty);
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

  parts.push(CMD_INIT, CMD_CODEPAGE_CP858, CMD_FEED_TOP);

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
        const label     = _summaryVariantLabel(v.priceProfile, v.mods);
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
// Promotional flyer buffer — logo + custom message, N copies
// ---------------------------------------------------------------------------

/**
 * Builds an ESC/POS buffer that prints N copies of the company logo followed
 * by a centred custom message. Each copy ends with a full cut.
 *
 * @param message  Free-text message to print below the logo (word-wrapped).
 * @param copies   Number of copies (clamped to 1–20).
 */
/** ESC d 5 — Feed 5 lines (~half of CMD_FEED_TOP), used between promo copies */
const CMD_FEED_PROMO: readonly number[] = [ESC, 0x64, 0x05];

function _todayDDMMYYYY(): string {
  const d = new Date();
  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

export function buildPromoBuffer(
  message: string,
  copies: number,
  validityDate?: string,
): Uint8Array {
  const n    = Math.max(1, Math.floor(copies));
  const date = validityDate?.trim() || _todayDDMMYYYY();
  const parts: (readonly number[] | Uint8Array)[] = [];
  const rawLine = (text: string) => parts.push(encodeText(text + '\n'));

  parts.push(CMD_INIT, CMD_CODEPAGE_CP858);

  for (let i = 0; i < n; i++) {
    parts.push(CMD_FEED_PROMO);
    parts.push(CMD_ALIGN_CENTER);
    parts.push(LOGO_RASTER_BYTES);
    rawLine('');
    const wrapped = _wrapText(sanitizeForPrinter(message), CHARS_PER_LINE);
    for (const line of wrapped) rawLine(line);
    rawLine('');
    const validity = _wrapText(`Válido únicamente el día ${date}`, CHARS_PER_LINE);
    for (const line of validity) rawLine(line);
    rawLine('Gracias por su visita');
    parts.push(CMD_FEED);
    parts.push(CMD_CUT);
  }

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
