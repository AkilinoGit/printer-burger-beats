// ESC/POS Bluetooth SPP: scanning, connection, reconnection, and printing.
//
// react-native-thermal-printer drives the Android BT SPP stack.
// All public functions return a typed result — never throw — so the UI
// can handle failures gracefully (offline-first: print is fire-and-forget).
//
// Connection lifecycle:
//   1. Call scanPrinters() to list paired BT devices.
//   2. Call connectPrinter(address) to open the SPP channel.
//   3. Call printTicket(...) — reconnects automatically if the link dropped.
//   4. Call disconnectPrinter() to release the socket when done.

import ThermalPrinter from 'react-native-thermal-printer';
import type { Ticket } from '../lib/types';
import { buildTicketCommands } from './escpos';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PrinterDevice {
  name: string;
  address: string; // MAC address, e.g. "AA:BB:CC:DD:EE:FF"
}

export interface ScanResult {
  ok: boolean;
  devices: PrinterDevice[];
  error?: string;
}

export interface ConnectResult {
  ok: boolean;
  error?: string;
}

export interface PrintResult {
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** MAC address of the currently paired printer. Persisted only in memory. */
let _pairedAddress: string | null = null;

/** How many times to retry a failed print before giving up. */
const MAX_RETRIES = 2;

/** Delay (ms) between retry attempts. */
const RETRY_DELAY_MS = 800;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns all Bluetooth devices paired with the Android device.
 * The user picks one from the list to configure the printer.
 */
export async function scanPrinters(): Promise<ScanResult> {
  try {
    const raw = await ThermalPrinter.getBluetoothDeviceList();
    const devices: PrinterDevice[] = raw.map((d) => ({
      name: d.deviceName ?? 'Unknown',
      address: d.macAddress,
    }));
    return { ok: true, devices };
  } catch (e) {
    return {
      ok: false,
      devices: [],
      error: _describe(e, 'No se pudo obtener la lista de dispositivos Bluetooth.'),
    };
  }
}

/**
 * Opens an SPP connection to the printer at the given MAC address.
 * Call this once after the user selects a printer from the scan list.
 */
export async function connectPrinter(address: string): Promise<ConnectResult> {
  try {
    await ThermalPrinter.connectBluetooth(address);
    _pairedAddress = address;
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: _describe(e, `No se pudo conectar con la impresora (${address}).`),
    };
  }
}

/**
 * Closes the current SPP connection.
 * Safe to call even if no printer is connected.
 */
export async function disconnectPrinter(): Promise<void> {
  try {
    await ThermalPrinter.disconnectBluetooth();
  } catch {
    // Ignore — socket may already be closed.
  } finally {
    _pairedAddress = null;
  }
}

/**
 * Returns the MAC address of the currently paired printer, or null if none.
 */
export function getPairedAddress(): string | null {
  return _pairedAddress;
}

/**
 * Prints a ticket to the paired Bluetooth ESC/POS printer.
 *
 * Reconnects automatically if the link was lost.
 * Retries up to MAX_RETRIES times before returning a failure result.
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
  if (!_pairedAddress) {
    return {
      ok: false,
      error:
        'No hay impresora configurada. Ve a Ajustes > Impresora y selecciona un dispositivo.',
    };
  }

  const payload = buildTicketCommands(ticket, isTest, modifierLabels);

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    const result = await _attemptPrint(payload);

    if (result.ok) return result;

    const isLastAttempt = attempt === MAX_RETRIES + 1;
    if (isLastAttempt) return result;

    // Connection likely dropped — try to reconnect before next attempt.
    await _reconnect();
    await _delay(RETRY_DELAY_MS);
  }

  // TypeScript: unreachable, but keeps the return type happy.
  return { ok: false, error: 'Error de impresión desconocido.' };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function _attemptPrint(payload: string): Promise<PrintResult> {
  try {
    await ThermalPrinter.printBluetooth({
      payload,
      printerNbrCharactersPerLine: 32,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: _describe(e, 'Error al enviar datos a la impresora.') };
  }
}

async function _reconnect(): Promise<void> {
  if (!_pairedAddress) return;
  try {
    // Attempt to close cleanly first, then reopen.
    await ThermalPrinter.disconnectBluetooth();
  } catch {
    // Ignore — socket may already be dead.
  }
  try {
    await ThermalPrinter.connectBluetooth(_pairedAddress);
  } catch {
    // If reconnect also fails, the next _attemptPrint will surface the error.
  }
}

function _delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Produces a human-readable error message.
 * Maps common BT stack messages to Spanish-language UI strings.
 */
function _describe(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : String(e);

  if (/not connected|socket.*closed|connection.*reset/i.test(raw)) {
    return 'La impresora se desconectó. Intentando reconectar…';
  }
  if (/bonded|paired|discovery/i.test(raw)) {
    return 'La impresora no está emparejada con este dispositivo. Emparéjala primero en Ajustes de Android.';
  }
  if (/bluetooth.*off|bt.*disabled/i.test(raw)) {
    return 'El Bluetooth está desactivado. Actívalo e inténtalo de nuevo.';
  }
  if (/permission|denied/i.test(raw)) {
    return 'La app no tiene permiso para usar Bluetooth. Revisa los permisos en Ajustes de Android.';
  }
  if (/timeout/i.test(raw)) {
    return 'La impresora tardó demasiado en responder. Comprueba que está encendida y cerca.';
  }

  // Return the original message in dev, fallback in production-like errors.
  return raw.length > 0 ? raw : fallback;
}
