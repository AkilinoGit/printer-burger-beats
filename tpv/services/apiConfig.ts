// Cliente HTTP base para el backend Burger Beats.
//
// Centraliza la base URL (configurable desde Ajustes, persistida en AsyncStorage)
// y expone un único `apiGet` que parsea el envoltorio estándar { ok, data|error }
// y lanza `ApiError` tipado. Ver tpv-backend-integration-plan.md §1 y §2.
//
// Nota: el grupo /tpv/* del backend HOY no exige X-API-Key (middleware desactivado),
// pero enviamos el header si está configurado para que el día que se active no se
// rompa nada. La clave se guarda en AsyncStorage (TODO: almacenamiento seguro).

import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE_URL_KEY = 'tpv:apiBaseUrl';   // URL del servidor LOCAL (editable)
const SERVER_MODE_KEY = 'tpv:serverMode';    // 'production' | 'local'
const API_KEY_KEY = 'tpv:apiKey';

/** Servidor al que apunta la app. Se elige en Ajustes → Servidor. */
export type ServerMode = 'production' | 'local';

// URL de producción: fija, NO editable desde la app. Sobrescribible al compilar
// con EXPO_PUBLIC_PROD_API_BASE_URL en tpv/.env.
export const PRODUCTION_API_BASE_URL = normalizeBaseUrl(
  process.env.EXPO_PUBLIC_PROD_API_BASE_URL || 'https://burguerbeats.com',
);

// Valor inicial del servidor local (primer arranque, antes de editarlo en Ajustes).
// Definir en tpv/.env:  EXPO_PUBLIC_API_BASE_URL=http://192.168.1.50
// En emulador Android, la localhost del PC es http://10.0.2.2.
const DEFAULT_LOCAL_API_BASE_URL = normalizeBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL ?? '');

// Modo por defecto: si el .env trae una URL local, el build es de pruebas y
// arranca en 'local'; si no, en 'production'.
const DEFAULT_SERVER_MODE: ServerMode = DEFAULT_LOCAL_API_BASE_URL ? 'local' : 'production';

/** Modo activo (production/local). Nunca falla: ante error devuelve el defecto. */
export async function getServerMode(): Promise<ServerMode> {
  try {
    const stored = await AsyncStorage.getItem(SERVER_MODE_KEY);
    return stored === 'production' || stored === 'local' ? stored : DEFAULT_SERVER_MODE;
  } catch {
    return DEFAULT_SERVER_MODE;
  }
}

export async function setServerMode(mode: ServerMode): Promise<void> {
  await AsyncStorage.setItem(SERVER_MODE_KEY, mode);
}

/** URL del servidor local guardada (o la del .env si aún no se ha editado). */
export async function getLocalApiBaseUrl(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(API_BASE_URL_KEY);
    return normalizeBaseUrl(stored ?? DEFAULT_LOCAL_API_BASE_URL);
  } catch {
    return DEFAULT_LOCAL_API_BASE_URL;
  }
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ---------------------------------------------------------------------------
// Config persistida
// ---------------------------------------------------------------------------

/**
 * Base URL efectiva (sin barra final) según el modo activo, o '' si no hay ninguna.
 * Es la que usan todas las peticiones — nadie más resuelve el modo.
 */
export async function getApiBaseUrl(): Promise<string> {
  const mode = await getServerMode();
  if (mode === 'production') return PRODUCTION_API_BASE_URL;
  return getLocalApiBaseUrl();
}

/** Guarda la URL del servidor local (solo aplica en modo 'local'). */
export async function setApiBaseUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(API_BASE_URL_KEY, normalizeBaseUrl(url));
}

export async function getApiKey(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(API_KEY_KEY);
  } catch {
    return null;
  }
}

export async function setApiKey(key: string): Promise<void> {
  await AsyncStorage.setItem(API_KEY_KEY, key);
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// Petición con parseo del envoltorio { ok, data|error }
// ---------------------------------------------------------------------------

/**
 * Petición a `{baseUrl}{path}` (path debe empezar por '/', p.ej. '/api/v1/tpv/products').
 * Devuelve `data` ya desenvuelto. Lanza `ApiError` en cualquier fallo
 * (red, HTTP, envoltorio ok:false, 401 de api key con cuerpo no estándar).
 * Si `body` está definido se envía como JSON (POST/PUT).
 */
async function apiRequest<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const baseUrl = await getApiBaseUrl();
  if (!baseUrl) {
    throw new ApiError('NO_BASE_URL', 'No hay URL del servidor configurada.', 0);
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const apiKey = await getApiKey();
  if (apiKey) headers['X-API-Key'] = apiKey;

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError('NETWORK_ERROR', e instanceof Error ? e.message : 'Fallo de red', 0);
  }

  // 401 de API key: cuerpo NO estándar { error: 'invalid_api_key' }.
  if (res.status === 401) {
    throw new ApiError('invalid_api_key', 'Credencial de API inválida.', 401);
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    throw new ApiError('INVALID_JSON', `Respuesta no válida (HTTP ${res.status}).`, res.status);
  }

  const env = parsed as {
    ok?: boolean;
    data?: T;
    error?: { code?: string; message?: string; fields?: Record<string, string> };
  };

  if (env && env.ok === true) {
    return env.data as T;
  }

  const err = env?.error;
  throw new ApiError(
    err?.code ?? 'SERVER_ERROR',
    err?.message ?? `Error del servidor (HTTP ${res.status}).`,
    res.status,
    err?.fields,
  );
}

/** GET desenvuelto. Ver `apiRequest`. */
export function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>('GET', path);
}

/** POST con cuerpo JSON, respuesta desenvuelta. Ver `apiRequest`. */
export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>('POST', path, body);
}
