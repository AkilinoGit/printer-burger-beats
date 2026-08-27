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
import { usePrintJobStore } from '../stores/usePrintJobStore';
import { useTextPresetsStore } from '../stores/useTextPresetsStore';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PrintResult {
  ok: boolean;
  error?: string;
  /** True if the caller cancelled before the bytes reached the printer. */
  cancelled?: boolean;
}

/** Thrown internally when the user cancels a send via the print overlay. */
class PrintCancelledError extends Error {
  constructor() {
    super('Impresión cancelada');
    this.name = 'PrintCancelledError';
  }
}

/** Maps a caught printing error to a PrintResult, distinguishing user cancel. */
function failResult(e: unknown): PrintResult {
  if (e instanceof PrintCancelledError) {
    log.info('PRINT', 'envío cancelado por el usuario');
    return { ok: false, cancelled: true };
  }
  const msg = e instanceof Error ? e.message : String(e);
  log.error('PRINT', msg);
  return { ok: false, error: msg };
}

export interface PrinterDevice {
  name: string;
  address: string;
  /** Nombre propio asignado por el usuario (persistido por MAC). */
  alias?: string;
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
const STORAGE_KEY_ALIASES = 'printer.aliases';   // JSON { [address]: alias }

let cachedAddress: string | null = null;
let cachedName:    string | null = null;
let cacheLoaded = false;

let cachedAliases: Record<string, string> | null = null;

let connectedDevice: BluetoothDevice | null = null;

// SPP UUID for serial-over-Bluetooth (standard for ESC/POS thermal printers)
const SPP_UUID = '00001101-0000-1000-8000-00805F9B34FB';

// Max time we wait for a Bluetooth connection before giving up. Without this,
// connecting to a powered-off printer hangs for a long time before the native
// layer surfaces a "printer null" error.
const CONNECT_TIMEOUT_MS = 8000;

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

async function loadAliases(): Promise<Record<string, string>> {
  if (cachedAliases) return cachedAliases;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_ALIASES);
    cachedAliases = raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    cachedAliases = {};
  }
  return cachedAliases;
}

/** Devuelve el alias guardado para una MAC, o null si no tiene. */
export async function getAlias(address: string): Promise<string | null> {
  const aliases = await loadAliases();
  return aliases[address] ?? null;
}

/** Guarda (o borra, si se pasa vacío) el alias de una MAC. */
export async function setAlias(address: string, alias: string): Promise<void> {
  const aliases = await loadAliases();
  const trimmed = alias.trim();
  if (trimmed) aliases[address] = trimmed;
  else delete aliases[address];
  cachedAliases = aliases;
  await AsyncStorage.setItem(STORAGE_KEY_ALIASES, JSON.stringify(aliases));
  log.info('PRINT', `alias ${trimmed ? 'set' : 'cleared'} for ${address}: ${trimmed || '(none)'}`);
}

export async function getPairedPrinter(): Promise<PrinterDevice | null> {
  await loadCache();
  if (!cachedAddress) return null;
  const alias = await getAlias(cachedAddress);
  return {
    address: cachedAddress,
    name: cachedName ?? cachedAddress,
    alias: alias ?? undefined,
  };
}

/** True si hay un socket abierto y vivo con la impresora actual. */
export async function isPrinterConnected(): Promise<boolean> {
  if (!connectedDevice) return false;
  try {
    return await connectedDevice.isConnected();
  } catch {
    return false;
  }
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
    const aliases = await loadAliases();
    const mapped: PrinterDevice[] = devices.map((d) => ({
      name: d.name ?? d.address,
      address: d.address,
      alias: aliases[d.address],
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

  // Bound the connect attempt: a powered-off / out-of-range printer otherwise
  // hangs for a long time before the native layer reports failure.
  const device = await new Promise<BluetoothDevice>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error(
        'No se pudo conectar (tiempo de espera agotado). ¿Está encendida y al alcance la impresora?',
      ));
    }, CONNECT_TIMEOUT_MS);

    RNBluetoothClassic.connectToDevice(address, {
      CONNECTOR_TYPE: 'rfcomm',
      DELIMITER: '',
      DEVICE_CHARSET: 'utf-8',
      SECURE_SOCKET: false,
      CONNECTION_TYPE: 'binary',
      UUID: SPP_UUID,
    } as any).then(
      (d) => {
        clearTimeout(timer);
        // If it arrives after the timeout already fired, drop the late socket.
        if (settled) { void d.disconnect().catch(() => {}); return; }
        resolve(d);
      },
      (e) => {
        clearTimeout(timer);
        if (!settled) reject(e);
      },
    );
  });

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

/**
 * Races a printer operation (connect / write) against the global cancel flag.
 * If the user taps Cancel while the operation is hung (e.g. a dead connection),
 * this rejects with PrintCancelledError so we stop waiting on it. The underlying
 * promise may still settle later in the background; we clean up the socket.
 */
function withCancel<T>(op: Promise<T>): Promise<T> {
  let poll: ReturnType<typeof setInterval> | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    poll = setInterval(() => {
      if (usePrintJobStore.getState().cancelRequested) reject(new PrintCancelledError());
    }, 80);
  });
  return Promise.race([op, cancelled]).finally(() => {
    if (poll) clearInterval(poll);
  });
}

async function writeBytes(bytes: Uint8Array): Promise<void> {
  await loadCache();
  if (!cachedAddress) {
    throw new Error('No hay impresora seleccionada. Configúrala en Ajustes → Impresora.');
  }

  // Every physical send funnels through here, so this is the single point where
  // we drive the global print overlay (elapsed-ms counter + Cancel button). The
  // overlay exists so a hung/failed connection can be aborted; on success it
  // simply disappears.
  usePrintJobStore.getState().beginSend();

  try {
    if (usePrintJobStore.getState().cancelRequested) throw new PrintCancelledError();

    const device = await withCancel(openConnection(cachedAddress));

    if (usePrintJobStore.getState().cancelRequested) throw new PrintCancelledError();

    const base64Data = _uint8ArrayToBase64(bytes);
    // The library accepts base64 when passed with the "base64:" prefix on some
    // versions, but the safer path is writing the raw bytes. The library's
    // write() accepts string | Buffer; we pass a base64 string and let the
    // native side decode it.
    const ok = await withCancel(device.write(base64Data, 'base64' as any));
    if (!ok) throw new Error('La impresora rechazó los datos.');
  } catch (e) {
    // On cancel, drop any socket that may still have opened in the background.
    if (e instanceof PrintCancelledError) void disconnectPrinter().catch(() => {});
    throw e;
  } finally {
    usePrintJobStore.getState().finishSend();
  }
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
    // Header/footer messages come from the text-preset pool, resolved here once
    // (random/fixed per device config). Solo se imprimen en la copia completa
    // (copia del cliente); si no hay candidatos activos, salen null y no imprimen.
    const headerMessage = useTextPresetsStore.getState().resolveHeaderMessage();
    const footerMessage = useTextPresetsStore.getState().resolveFooterMessage();
    // Double-print sends two DIFFERENT buffers as independent writes:
    //  - Copy 1: full ticket (promo header + orders + footer message).
    //  - Copy 2: plain ticket only (name/order, number, items with price) —
    //    built with repeatContent=false so it has no promo header nor footer.
    // A 3.5s pause between writes lets the printer flush the first copy before
    // receiving the second.
    const buffers: Uint8Array[] = repeatContent
      ? [
          buildTicketBuffer(ticket, isTest, modifierLabels, true, normalPrices, headerMessage, footerMessage),
          buildTicketBuffer(ticket, isTest, modifierLabels, false, normalPrices),
        ]
      : [buildTicketBuffer(ticket, isTest, modifierLabels, false, normalPrices)];
    doneEscpos();

    let totalBytes = 0;
    for (let c = 0; c < buffers.length; c++) {
      if (c > 0) await new Promise((resolve) => setTimeout(resolve, 3500));
      const doneWrite = perf.start('PRINT', 'BT write');
      await writeBytes(buffers[c]);
      doneWrite();
      totalBytes += buffers[c].length;
    }

    log.info('PRINT', `sent ${totalBytes}b${buffers.length > 1 ? ` x${buffers.length}` : ''}`);
    return { ok: true };
  } catch (e) {
    return failResult(e);
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
    return failResult(e);
  }
}

/**
 * Prints N copies of the flyer/coupon (logo + big headline + optional validity
 * and farewell lines), one copy at a time so printing can be cancelled between
 * copies. The caller resolves the texts (from the promo preset pool) and fills
 * the `{fecha}` placeholder beforehand.
 *
 * @param title        Headline printed big under the logo.
 * @param validity     Optional validity line; null/empty skips it.
 * @param farewell     Optional farewell line; null/empty skips it.
 * @param others       Extra promotional lines (the "Otros" checkbox pool) — ALL of
 *                     these are printed, one per entry, in the given order.
 * @param startNumber  If not null, each copy is numbered under the logo starting
 *                     at this value (copy 1 → startNumber, copy 2 → +1, …).
 * @param onProgress   Called after each successful copy: (printedSoFar, total).
 * @param shouldContinue  Return false to stop before the next copy.
 */
export async function printPromo(
  title: string,
  validity: string | null,
  farewell: string | null,
  others: string[],
  copies: number,
  startNumber: number | null,
  onProgress?: (current: number, total: number) => void,
  shouldContinue?: () => boolean,
): Promise<PrintResult> {
  log.info('PRINT', `printPromo — ${copies} copia(s)${startNumber !== null ? ` desde Nº ${startNumber}` : ''}`);
  try {
    for (let i = 1; i <= copies; i++) {
      if (shouldContinue && !shouldContinue()) {
        log.info('PRINT', `promo cancelado tras ${i - 1} copia(s)`);
        return { ok: true };
      }
      const couponNumber = startNumber !== null ? startNumber + (i - 1) : null;
      const bytes = buildPromoBuffer(title, validity, farewell, others, couponNumber);
      await writeBytes(bytes);
      log.info('PRINT', `promo copia ${i}/${copies} (${bytes.length}b)`);
      onProgress?.(i, copies);
    }
    return { ok: true };
  } catch (e) {
    return failResult(e);
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
    return failResult(e);
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
