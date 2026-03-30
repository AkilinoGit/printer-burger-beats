// ESC/POS Bluetooth SPP: connection, formatting, printing
// react-native-thermal-printer drives the Android BT SPP stack.
// All public functions return a PrintResult — never throw — so the UI
// can handle failures silently (offline-first rule: print is fire-and-forget).

import ThermalPrinter from 'react-native-thermal-printer';
import type { Ticket } from '../lib/types';
import { buildTicketCommands } from './escpos';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrintResult {
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Print a ticket to the paired Bluetooth ESC/POS printer.
 *
 * @param ticket          Fully populated Ticket (all Orders + OrderItems).
 * @param isTest          When true, adds *** PRUEBA — NO VÁLIDO *** watermark.
 * @param modifierLabels  Map from Modifier.id → Modifier.label for readable output.
 */
export async function printTicket(
  ticket: Ticket,
  isTest: boolean,
  modifierLabels: Record<string, string>,
): Promise<PrintResult> {
  try {
    const payload = buildTicketCommands(ticket, isTest, modifierLabels);
    await ThermalPrinter.printBluetooth({
      payload,
      printerNbrCharactersPerLine: 32,
    });
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, error };
  }
}
