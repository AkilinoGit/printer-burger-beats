// Identificador estable de este dispositivo.
//
// Necesario para el sync de sesiones: las sesiones viajan entre dispositivos y
// hay que poder distinguir "mis" sesiones de las que vienen de otro TPV. Sin
// esto, `getActiveSession()` podría adoptar como sesión activa una sesión
// abierta en OTRO móvil y numerar tickets dentro de ella.
//
// Se genera una sola vez (UUID v4) y se persiste en AsyncStorage. La caché en
// memoria evita ir a disco en cada consulta a la BD.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { generateId } from './utils';

const DEVICE_ID_KEY = 'tpv:deviceId';

let _cached: string | null = null;
let _pending: Promise<string> | null = null;

/**
 * Id de este dispositivo. Lo crea y persiste en la primera llamada.
 * Nunca lanza: si AsyncStorage falla, devuelve un id de sesión en memoria que
 * al menos mantiene la coherencia mientras la app siga viva.
 */
export function getDeviceId(): Promise<string> {
  if (_cached) return Promise.resolve(_cached);
  if (_pending) return _pending;

  _pending = (async () => {
    try {
      const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
      if (stored) {
        _cached = stored;
        return stored;
      }
      const created = generateId();
      await AsyncStorage.setItem(DEVICE_ID_KEY, created);
      _cached = created;
      return created;
    } catch {
      // Fallback en memoria: no se persiste, pero evita devolver ids distintos
      // dentro de la misma ejecución.
      _cached = _cached ?? generateId();
      return _cached;
    } finally {
      _pending = null;
    }
  })();

  return _pending;
}

/**
 * Id ya resuelto, o null si aún no se ha cargado. Para los sitios que no pueden
 * esperar (render síncrono); nunca dispara la carga.
 */
export function getCachedDeviceId(): string | null {
  return _cached;
}
