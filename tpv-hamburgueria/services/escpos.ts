// ESC/POS format helpers — builds the text payload for react-native-thermal-printer.
// react-native-thermal-printer accepts a string where ESC/POS commands are embedded
// using special tags: [B] bold on, [/B] bold off, [C] center, [L] left.

import type { Order, OrderItem, Ticket } from '../lib/types';
import { currentTime } from '../lib/utils';

const SEP       = '================================';
const SEP_ORDER = '--------------------------------';

/**
 * Builds the full print payload for a ticket.
 *
 * @param ticket        Fully populated Ticket (all Orders + OrderItems).
 * @param isTest        Appends *** PRUEBA — NO VÁLIDO *** lines when true.
 * @param modifierLabels Map from Modifier.id → Modifier.label for readable printing.
 */
export function buildTicketCommands(
  ticket: Ticket,
  isTest: boolean,
  modifierLabels: Record<string, string>,
): string {
  const lines: string[] = [];

  // Header
  lines.push('[C]' + SEP);
  lines.push('[C][B]COMANDA #' + String(ticket.ticketNumber) + '[/B]');
  lines.push('[C]' + currentTime());
  lines.push('[C]' + SEP);
  lines.push('');

  // Test mode watermark (top)
  if (isTest) {
    lines.push('[C][B]*** PRUEBA — NO VALIDO ***[/B]');
    lines.push('');
  }

  // Orders
  for (let i = 0; i < ticket.orders.length; i++) {
    if (i > 0) {
      lines.push('[C]' + SEP_ORDER);
      lines.push('');
    }
    lines.push(...formatOrder(ticket.orders[i], modifierLabels));
  }

  // Footer
  lines.push('[C]' + SEP);

  // Test mode watermark (bottom)
  if (isTest) {
    lines.push('');
    lines.push('[C][B]*** PRUEBA — NO VALIDO ***[/B]');
    lines.push('[C]' + SEP);
  }

  // Paper feed before cut
  lines.push('');
  lines.push('');

  return lines.join('\n');
}

function formatOrder(order: Order, modifierLabels: Record<string, string>): string[] {
  const lines: string[] = [];

  // Client name in bold — displayed prominently in the kitchen
  lines.push('[L][B]--- ' + order.clientName.toUpperCase() + ' ---[/B]');
  lines.push('');

  for (const item of order.items) {
    lines.push(...formatItem(item, modifierLabels));
  }

  lines.push('');
  return lines;
}

function formatItem(item: OrderItem, modifierLabels: Record<string, string>): string[] {
  const lines: string[] = [];

  // "2x FAT & FURIOUS" or "1x [custom label]"
  const productLine = String(item.qty) + 'x ' + (item.customLabel ?? item.productName);
  lines.push('[L]' + productLine);

  // Modifiers — resolve IDs to human-readable labels, joined by ·
  if (item.selectedModifiers.length > 0) {
    const labelStr = item.selectedModifiers
      .map((id) => modifierLabels[id] ?? id)
      .join(' · ');
    lines.push('[L]   ' + labelStr);
  }

  return lines;
}
