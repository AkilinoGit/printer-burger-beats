// Sincronización de ubicaciones (locales) con el backend TPV.
//
// Dos direcciones en una sola operación:
//   1. SUBE cada ubicación local al backend (POST /api/v1/tpv/locations).
//      El endpoint es idempotente por id: si ya existe, lo devuelve sin duplicar.
//   2. BAJA todas las ubicaciones del backend (GET) y las fusiona en SQLite,
//      actualizando nombre/predeterminado e insertando las que falten.
//
// Convención de services/: nunca lanza; devuelve { ok, ... } / { ok:false, error }.

import { apiGet, apiPost, ApiError } from './apiConfig';
import { getLocations, upsertLocationsFromBackend } from './db';
import type { ApiLocation } from '../lib/types';

const LOCATIONS_PATH = '/api/v1/tpv/locations';

interface LocationListResponse {
  locations: ApiLocation[];
}

interface LocationCreateResponse {
  location: ApiLocation;
}

export type SyncLocationsResult =
  | { ok: true; pushed: number; pulled: number }
  | { ok: false; error: string };

/**
 * Sincroniza las ubicaciones en ambas direcciones. Si la subida de alguna
 * ubicación concreta falla no se aborta el proceso (puede ser un conflicto
 * puntual); solo un fallo en la bajada (red/servidor) devuelve error.
 */
export async function syncLocations(): Promise<SyncLocationsResult> {
  try {
    // 1. Subir las ubicaciones locales (idempotente por id en el backend).
    const local = await getLocations();
    let pushed = 0;
    for (const loc of local) {
      try {
        await apiPost<LocationCreateResponse>(LOCATIONS_PATH, {
          id: loc.id,
          name: loc.name,
          isDefault: loc.isDefault,
        });
        pushed++;
      } catch {
        // Fallo puntual de una ubicación: seguimos con las demás y con la bajada.
      }
    }

    // 2. Bajar el estado del backend y fusionarlo en SQLite.
    const data = await apiGet<LocationListResponse>(LOCATIONS_PATH);
    const remote = data.locations ?? [];
    await upsertLocationsFromBackend(remote);

    return { ok: true, pushed, pulled: remote.length };
  } catch (e) {
    const error =
      e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Error desconocido';
    return { ok: false, error };
  }
}
