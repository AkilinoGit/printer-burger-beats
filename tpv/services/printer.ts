// ESC/POS printing via RawBT Android app using Intents.
//
// RawBT receives raw ESC/POS bytes encoded as Base64 via an Android Intent.
// No Bluetooth pairing or socket management needed — RawBT handles the
// printer connection entirely. The app just fires the Intent and RawBT
// delivers the job.
//
// Install requirement: RawBT must be installed on the device.
//   Play Store: https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter
//
// Intent API (android.intent.action.VIEW with rawbt:base64, scheme):
//   Action  : android.intent.action.VIEW
//   Data    : rawbt:base64,<base64-encoded ESC/POS bytes>
//   Package : ru.a402d.rawbtprinter

import * as IntentLauncher from 'expo-intent-launcher';
import type { Ticket } from '../lib/types';
import { buildTicketBuffer, buildMultiTicketBuffer } from './escpos';
import { log, perf } from './logger';

// ---------------------------------------------------------------------------
// Public types  (kept compatible with existing callers)
// ---------------------------------------------------------------------------

export interface PrintResult {
  ok: boolean;
  error?: string;
}

// The BT-scanning types are kept so existing imports in settings.tsx compile.
export interface PrinterDevice {
  name: string;
  address: string;
}

export interface ScanResult {
  ok: boolean;
  devices: PrinterDevice[];
  error?: string;
  rawError?: string;
}

export interface ConnectResult {
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// RawBT Intent constants
// ---------------------------------------------------------------------------

const RAWBT_PACKAGE = 'ru.a402d.rawbtprinter';
const RAWBT_NOT_INSTALLED =
  'No se pudo abrir RawBT. ¿Está instalado?\n' +
  'Descárgalo en Play Store: ru.a402d.rawbtprinter';

// ---------------------------------------------------------------------------
// Diagnostic result — exposed for the settings debug panel
// ---------------------------------------------------------------------------

export interface DiagResult {
  method: string;
  ok: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Prints a ticket by sending raw ESC/POS bytes to RawBT via Android Intent.
 *
 * @param ticket         Fully populated Ticket (all Orders + OrderItems).
 * @param isTest         Adds *** PRUEBA — NO VÁLIDO *** watermark when true.
 * @param modifierLabels Map from Modifier.id → Modifier.label for readable output.
 */
export async function printTicket(
  ticket: Ticket,
  isTest: boolean,
  modifierLabels: Record<string, string>,
  _radioNoSelection: Record<string, string> = {},
  _radioOptionSets: Record<string, Set<string>> = {},
): Promise<PrintResult> {
  const orders = ticket.orders.length;
  const items  = ticket.orders.reduce((s, o) => s + o.items.length, 0);
  log.info('PRINT', `ticket #${ticket.ticketNumber} — ${orders} order(s) ${items} item(s)`);

  try {
    const doneEscpos = perf.start('PRINT', 'buildTicketBuffer');
    const bytes      = buildTicketBuffer(ticket, isTest, modifierLabels);
    doneEscpos();

    const doneB64 = perf.start('PRINT', 'base64 encode');
    const base64Data = _uint8ArrayToBase64(bytes);
    doneB64();

    log.info('PRINT', `payload ${bytes.length}b → ${base64Data.length}ch b64`);

    IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: 'rawbt:base64,' + base64Data,
      packageName: RAWBT_PACKAGE,
    }).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('PRINT', _isNotFoundError(msg) ? RAWBT_NOT_INSTALLED : msg);
    });

    log.info('PRINT', 'intent fired');
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('PRINT', msg);
    return {
      ok: false,
      error: _isNotFoundError(msg) ? RAWBT_NOT_INSTALLED : msg,
    };
  }
}

/**
 * Opens the RawBT app for printer configuration.
 * Returns an error result if RawBT is not installed.
 */
export async function openRawBT(): Promise<PrintResult> {
  try {
    await IntentLauncher.startActivityAsync('android.intent.action.MAIN', {
      packageName: RAWBT_PACKAGE,
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[printer] openRawBT error:', msg);
    return {
      ok: false,
      error: _isNotFoundError(msg) ? RAWBT_NOT_INSTALLED : msg,
    };
  }
}

/**
 * Prints multiple tickets in a single print job (one Intent, one cut).
 * Used when several tickets have been queued via "Añadir otro".
 */
export async function printTickets(
  tickets: Ticket[],
  isTest: boolean,
  modifierLabels: Record<string, string>,
): Promise<PrintResult> {
  if (tickets.length === 0) return { ok: true };

  const totalOrders = tickets.reduce((s, t) => s + t.orders.length, 0);
  log.info('PRINT', `multi-ticket: ${tickets.length} ticket(s) ${totalOrders} order(s)`);

  try {
    const bytes = buildMultiTicketBuffer(tickets, isTest, modifierLabels);
    const base64Data = _uint8ArrayToBase64(bytes);

    IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: 'rawbt:base64,' + base64Data,
      packageName: RAWBT_PACKAGE,
    }).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('PRINT', _isNotFoundError(msg) ? RAWBT_NOT_INSTALLED : msg);
    });

    log.info('PRINT', 'multi-ticket intent fired');
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('PRINT', msg);
    return { ok: false, error: _isNotFoundError(msg) ? RAWBT_NOT_INSTALLED : msg };
  }
}

// ---------------------------------------------------------------------------
// Diagnostic helpers — probe each Intent method and report results
// ---------------------------------------------------------------------------

/**
 * Tests method 1: VIEW with rawbt:base64, scheme (primary — used by printTicket).
 */
export async function diagMethod1(base64Data: string): Promise<DiagResult> {
  try {
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: 'rawbt:base64,' + base64Data,
      packageName: RAWBT_PACKAGE,
    });
    return { method: 'VIEW / rawbt:base64,', ok: true, error: null };
  } catch (e) {
    return {
      method: 'VIEW / rawbt:base64,',
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Tests method 2: VIEW with intent: URI fallback scheme.
 */
export async function diagMethod2(base64Data: string): Promise<DiagResult> {
  const uri =
    'intent:' + base64Data +
    '#Intent;scheme=rawbt;package=' + RAWBT_PACKAGE + ';end;';
  try {
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: uri,
      packageName: RAWBT_PACKAGE,
    });
    return { method: 'VIEW / intent: URI', ok: true, error: null };
  } catch (e) {
    return {
      method: 'VIEW / intent: URI',
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---------------------------------------------------------------------------
// Legacy stubs — kept so existing imports compile without changes.
// RawBT manages the printer connection; the app no longer needs these.
// ---------------------------------------------------------------------------

export async function scanPrinters(): Promise<ScanResult> {
  return { ok: true, devices: [] };
}

export async function connectPrinter(_address: string): Promise<ConnectResult> {
  return { ok: true };
}

export async function disconnectPrinter(): Promise<void> {
  // no-op
}

export function getPairedAddress(): string | null {
  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _uint8ArrayToBase64(bytes: Uint8Array): string {
  // Process in chunks to avoid stack overflow on large buffers while still
  // building the string in one fromCharCode call per chunk (no += loop).
  const CHUNK = 4096;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Detects Android "activity not found" errors that indicate the target app
 * is not installed on the device.
 */
function _isNotFoundError(msg: string): boolean {
  return /no activity found|ActivityNotFoundException|unable to find/i.test(msg);
}
