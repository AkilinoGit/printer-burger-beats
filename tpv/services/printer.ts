// Direct Bluetooth SPP printing via react-native-bluetooth-classic.
//
// The app pairs with a thermal printer through the Android system settings,
// then selects it from the in-app list (paired devices). The MAC address is
// persisted in AsyncStorage. To print, we open an SPP socket, write the raw
// ESC/POS bytes, and close it.
//
// Permissions are declared in app.json (BLUETOOTH, BLUETOOTH_ADMIN,
// BLUETOOTH_CONNECT, BLUETOOTH_SCAN). Runtime permissions are requested by
// the underlying library when needed (Android 12+).

import AsyncStorage from '@react-native-async-storage/async-storage';
import RNBluetoothClassic, {
  BluetoothDevice,
} from 'react-native-bluetooth-classic';
import { PermissionsAndroid, Platform } from 'react-native';

import type { Session, Ticket } from '../lib/types';
import { buildTicketBuffer, buildSessionSummaryBuffer, buildPromoBuffer } from './escpos';
import { log, perf } from './logger';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PrintResult {
  ok: boolean;
  error?: string;
}

export interface PrinterDevice {
  name: string;
  address: string;
}

export interface ScanResult {
  ok: boolean;
  devices: PrinterDevice[];
  error?: string;
  rawError?: string;
  blocked?: boolean;
}

export interface ConnectResult {
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const STORAGE_KEY_ADDRESS = 'printer.address';
const STORAGE_KEY_NAME    = 'printer.name';

let cachedAddress: string | null = null;
let cachedName:    string | null = null;
let cacheLoaded = false;

let connectedDevice: BluetoothDevice | null = null;

// SPP UUID for serial-over-Bluetooth (standard for ESC/POS thermal printers)
const SPP_UUID = '00001101-0000-1000-8000-00805F9B34FB';

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function loadCache(): Promise<void> {
  if (cacheLoaded) return;
  try {
    const [addr, name] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY_ADDRESS),
      AsyncStorage.getItem(STORAGE_KEY_NAME),
    ]);
    cachedAddress = addr;
    cachedName    = name;
  } catch {
    cachedAddress = null;
    cachedName    = null;
  }
  cacheLoaded = true;
}

export async function getPairedPrinter(): Promise<PrinterDevice | null> {
  await loadCache();
  if (!cachedAddress) return null;
  return { address: cachedAddress, name: cachedName ?? cachedAddress };
}

/** Legacy sync accessor — returns last cached value without loading. */
export function getPairedAddress(): string | null {
  return cachedAddress;
}

export async function setPairedPrinter(device: PrinterDevice): Promise<void> {
  cachedAddress = device.address;
  cachedName    = device.name;
  cacheLoaded   = true;
  await AsyncStorage.multiSet([
    [STORAGE_KEY_ADDRESS, device.address],
    [STORAGE_KEY_NAME,    device.name],
  ]);
  log.info('PRINT', `paired printer saved: ${device.name} (${device.address})`);
}

export async function clearPairedPrinter(): Promise<void> {
  cachedAddress = null;
  cachedName    = null;
  cacheLoaded   = true;
  await AsyncStorage.multiRemove([STORAGE_KEY_ADDRESS, STORAGE_KEY_NAME]);
  await disconnectPrinter();
}

// ---------------------------------------------------------------------------
// Permissions (Android runtime)
// ---------------------------------------------------------------------------

export interface PermissionResult {
  ok: boolean;
  error?: string;
  /** True if user selected "never ask again" — UI should offer Settings link. */
  blocked?: boolean;
}

async function ensurePermissions(): Promise<PermissionResult> {
  if (Platform.OS !== 'android') return { ok: true };

  const apiLevel = typeof Platform.Version === 'number'
    ? Platform.Version
    : parseInt(String(Platform.Version), 10);

  const perms: string[] = apiLevel >= 31
    ? [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]
    : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  try {
    const result = await PermissionsAndroid.requestMultiple(perms as any);
    let blocked = false;
    for (const p of perms) {
      const status = result[p as keyof typeof result];
      if (status !== PermissionsAndroid.RESULTS.GRANTED) {
        if (status === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) blocked = true;
        log.error('PRINT', `permission ${p} → ${status}`);
      }
    }
    const allGranted = perms.every(
      (p) => result[p as keyof typeof result] === PermissionsAndroid.RESULTS.GRANTED,
    );
    if (allGranted) return { ok: true };
    return {
      ok: false,
      blocked,
      error: blocked
        ? 'Permisos Bluetooth bloqueados. Ábrelos manualmente en Ajustes del sistema.'
        : 'Permisos Bluetooth denegados.',
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Returns the list of devices already paired with Android. Thermal printers
 * must be paired through Android Settings first; we don't run an active scan
 * because ESC/POS printers are typically Bluetooth Classic and already paired.
 */
export async function scanPrinters(): Promise<ScanResult> {
  log.info('PRINT', 'scanPrinters()');

  const perm = await ensurePermissions();
  if (!perm.ok) return { ok: false, devices: [], error: perm.error, blocked: perm.blocked };

  try {
    const enabled = await RNBluetoothClassic.isBluetoothEnabled();
    if (!enabled) {
      try {
        await RNBluetoothClassic.requestBluetoothEnabled();
      } catch {
        return { ok: false, devices: [], error: 'El Bluetooth está apagado.' };
      }
    }

    const devices = await RNBluetoothClassic.getBondedDevices();
    const mapped: PrinterDevice[] = devices.map((d) => ({
      name: d.name ?? d.address,
      address: d.address,
    }));
    log.info('PRINT', `found ${mapped.length} paired device(s)`);
    return { ok: true, devices: mapped };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('PRINT', `scanPrinters failed: ${msg}`);
    return { ok: false, devices: [], error: msg, rawError: msg };
  }
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

async function openConnection(address: string): Promise<BluetoothDevice> {
  // Reuse if already connected to the same device
  if (connectedDevice && connectedDevice.address === address) {
    try {
      const stillConnected = await connectedDevice.isConnected();
      if (stillConnected) return connectedDevice;
    } catch {
      // fallthrough — reconnect
    }
  }

  // Drop any stale connection
  await disconnectPrinter();

  const device = await RNBluetoothClassic.connectToDevice(address, {
    CONNECTOR_TYPE: 'rfcomm',
    DELIMITER: '',
    DEVICE_CHARSET: 'utf-8',
    SECURE_SOCKET: false,
    CONNECTION_TYPE: 'binary',
    UUID: SPP_UUID,
  } as any);

  connectedDevice = device;
  return device;
}

export async function connectPrinter(address: string): Promise<ConnectResult> {
  const perm = await ensurePermissions();
  if (!perm.ok) return { ok: false, error: perm.error };

  try {
    await openConnection(address);
    log.info('PRINT', `connected to ${address}`);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('PRINT', `connectPrinter failed: ${msg}`);
    return { ok: false, error: msg };
  }
}

export async function disconnectPrinter(): Promise<void> {
  if (!connectedDevice) return;
  try { await connectedDevice.disconnect(); } catch { /* ignore */ }
  connectedDevice = null;
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

async function writeBytes(bytes: Uint8Array): Promise<void> {
  await loadCache();
  if (!cachedAddress) {
    throw new Error('No hay impresora seleccionada. Configúrala en Ajustes → Impresora.');
  }

  const device = await openConnection(cachedAddress);
  const base64Data = _uint8ArrayToBase64(bytes);
  // The library accepts base64 when passed with the "base64:" prefix on some
  // versions, but the safer path is writing the raw bytes. The library's
  // write() accepts string | Buffer; we pass a base64 string and let the
  // native side decode it.
  const ok = await device.write(base64Data, 'base64' as any);
  if (!ok) throw new Error('La impresora rechazó los datos.');
}

export async function printTicket(
  ticket: Ticket,
  isTest: boolean,
  modifierLabels: Record<string, string>,
  _radioNoSelection: Record<string, string> = {},
  _radioOptionSets: Record<string, Set<string>> = {},
  repeatContent: boolean = false,
  normalPrices: Record<string, number> = {},
): Promise<PrintResult> {
  const orders = ticket.orders.length;
  const items  = ticket.orders.reduce((s, o) => s + o.items.length, 0);
  log.info('PRINT', `ticket #${ticket.ticketNumber} — ${orders} order(s) ${items} item(s)${repeatContent ? ' (x2)' : ''}`);

  try {
    const doneEscpos = perf.start('PRINT', 'buildTicketBuffer');
    const bytes      = buildTicketBuffer(ticket, isTest, modifierLabels, repeatContent, normalPrices);
    doneEscpos();

    const doneWrite = perf.start('PRINT', 'BT write');
    await writeBytes(bytes);
    doneWrite();

    log.info('PRINT', `sent ${bytes.length}b`);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('PRINT', msg);
    return { ok: false, error: msg };
  }
}

export async function printSessionSummary(
  session: Session,
  tickets: Ticket[],
  locationName: string,
): Promise<PrintResult> {
  log.info('PRINT', `session summary — ${tickets.length} ticket(s)`);
  try {
    const bytes = buildSessionSummaryBuffer(session, tickets, locationName);
    await writeBytes(bytes);
    log.info('PRINT', `session summary sent (${bytes.length}b)`);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('PRINT', msg);
    return { ok: false, error: msg };
  }
}

/**
 * Prints N copies of the company logo followed by a custom message, one copy
 * at a time so printing can be cancelled between copies.
 *
 * @param onProgress   Called after each successful copy: (printedSoFar, total).
 * @param shouldContinue  Return false to stop before the next copy.
 */
export async function printPromo(
  message: string,
  copies: number,
  validityDate?: string,
  onProgress?: (current: number, total: number) => void,
  shouldContinue?: () => boolean,
): Promise<PrintResult> {
  log.info('PRINT', `printPromo — ${copies} copia(s)`);
  try {
    for (let i = 1; i <= copies; i++) {
      if (shouldContinue && !shouldContinue()) {
        log.info('PRINT', `promo cancelado tras ${i - 1} copia(s)`);
        return { ok: true };
      }
      const bytes = buildPromoBuffer(message, 1, validityDate);
      await writeBytes(bytes);
      log.info('PRINT', `promo copia ${i}/${copies} (${bytes.length}b)`);
      onProgress?.(i, copies);
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('PRINT', msg);
    return { ok: false, error: msg };
  }
}

/**
 * Sends a small ESC/POS self-test (init + feed + cut). Useful for the
 * "test connection" button in the printer settings screen.
 */
export async function printTest(): Promise<PrintResult> {
  try {
    const bytes = new Uint8Array([
      0x1B, 0x40,             // ESC @  — init
      ...new TextEncoder().encode('TEST DE IMPRESION\nTPV by AKI SOFTWARE\n'),
      0x0A, 0x0A, 0x0A,
      0x1D, 0x56, 0x00,       // GS V 0 — full cut
    ]);
    await writeBytes(bytes);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK = 4096;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
