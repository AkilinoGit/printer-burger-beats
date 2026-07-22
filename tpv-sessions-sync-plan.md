# Paso 4 de backend — CRUD de sesiones sincronizado con el servidor

> **ESTADO (2026-07-21)**: Fases 0, 1, 2 y 3 implementadas y compilando
> (`tsc --noEmit` limpio salvo 4 errores preexistentes ajenos). Backend probado
> end-to-end con 18/18 asserts (script en scratchpad). **Pendiente**: Fase 4
> (verificación de la transición con 2 dispositivos reales) y desplegar la
> migración 031 a producción. La migración 031 (+ la 23 que faltaba) ya está
> aplicada en la BD LOCAL de Laragro `burger_beats_local`.


> **Objetivo**: que las **sesiones** (jornadas de trabajo) creadas en la TPV se puedan
> crear, editar, cerrar y borrar desde la app y queden **sincronizadas con la base de
> datos** del backend, sin perder **ni una sola sesión** de las que ya existen hoy en el
> SQLite de cada dispositivo.
>
> Se apoya en el contrato ya definido en `tpv-backend-integration-plan.md`
> (envoltorio `{ok, data|error}`, `X-API-Key`, base URL configurable, DECIMAL-como-string)
> y sigue el patrón de `services/locationsApi.ts` + registro de task en `services/syncAll.ts`.

---

## 0. Principio rector de este paso

A diferencia de **productos** (donde el backend manda y la app hace *replace* total),
en **sesiones la TPV es el productor del dato**. Por tanto:

> **La dirección primaria es PUSH (TPV → backend). El PULL nunca borra ni sobrescribe
> una sesión local propia.**

Todo el plan está construido alrededor de esa regla, porque es la única forma de
garantizar que la transición no pierde datos.

---

## 1. Estado actual (auditoría)

### 1.1 App (SQLite, `services/db.ts`, schema v25)

Tabla `sessions`: `id` (UUID v4 generado en el móvil), `location_id`, `date`, `status`,
`price_overrides` (JSON), `created_at`, `session_code`, `opened_at`, `auto_close_at`,
`closed_at`, `device_id`.

Operaciones existentes:

| Operación | Función | ¿Expuesta en UI? |
|---|---|---|
| Crear | `insertSession()` | Sí — "Abrir sesión" en `app/(tabs)/session.tsx` |
| Cerrar | `closeSession()` / `closeCurrentSession()` | Sí |
| Listar | `getSessions()` | Sí — historial + `sessions-history.tsx` |
| Editar precios | `updateSessionPriceOverrides()` | **No** — existe en db.ts, nadie la llama |
| Borrar | — | **No existe** |
| Notas | — | **No existe** (el backend sí tiene la columna) |

### 1.2 Backend (`burger-beats-backend`, MySQL)

Tabla `sessions`: `id`, `location_id` (NULL permitido desde mig. 005), `date`, `status`,
`price_overrides` (JSON), `notes` (mig. 023), `created_at`.

Endpoints (`/api/v1/tpv/*`, sin auth todavía):

- `POST /tpv/sessions` → `SessionController::createOrUpdate` — **ignora `priceOverrides`**
  al escribir (lo lee al devolver, pero nunca lo guarda).
- `GET /tpv/sessions/{id}` → `show`.
- No existe listado, ni update parcial, ni delete.

### 1.3 Hueco real

**Hoy la app NO llama nunca a `/tpv/sessions`.** No hay `sessionsApi.ts`, y
`services/sync.ts` sigue con `API_BASE_URL = null` (la cola de pedidos está inactiva).
Es decir: **el backend no tiene ninguna sesión de la TPV**. Partimos de cero en el
servidor y de N sesiones en cada móvil.

### 1.4 Campos que el backend no sabe representar

`session_code`, `opened_at`, `auto_close_at`, `closed_at`, `device_id` — y no hay
`updated_at` ni `deleted_at`, imprescindibles para resolver conflictos y borrado suave.

---

## 2. Riesgos de la transición y cómo se neutralizan

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | **Pérdida de sesiones históricas** al introducir el sync | El PULL nunca hace DELETE físico, y solo hace UPDATE de una fila local si está `sync_status='synced'` **y** el `updated_at` remoto es posterior. Una fila con cambios locales pendientes jamás se pisa. |
| 2 | **Colisión de ids entre dispositivos** | Los ids son UUID v4 generados en el móvil → colisión estadísticamente imposible. El upsert es idempotente por `id` (mismo patrón que locations). |
| 3 | **Secuestro de la sesión activa** — `getActiveSession()` coge *cualquier* fila con `status='open'` sin filtrar dispositivo. Si bajamos la sesión abierta de otro móvil, este móvil empezaría a numerar tickets dentro de ella | Nueva columna local `origin` (`'local'` \| `'remote'`) + filtro por `device_id`. `getActiveSession()` solo mira `origin='local' AND device_id = <este dispositivo>`. **Esto se implementa ANTES de activar el pull.** |
| 4 | **`device_id` está siempre a NULL** — `insertSession()` acepta el parámetro pero ningún llamador lo pasa | Se genera un `deviceId` estable (AsyncStorage, UUID v4 la primera vez). Migración local v26: todas las sesiones existentes con `device_id IS NULL` reciben el deviceId de **este** dispositivo (por definición son suyas). |
| 5 | **Colisión de `session_code`** — cada móvil genera "LUN-2806" de forma local; dos dispositivos generan el mismo código el mismo día | En el backend `session_code` **NO** lleva índice único global. Unicidad opcional por `(device_id, session_code)`. El identificador real es siempre el `id`. |
| 6 | **Reapertura accidental de una sesión cerrada** por un push tardío | Regla de negocio en el backend: `closed` es terminal. Un upsert que traiga `status='open'` sobre una sesión ya `closed` **no la reabre** (se ignora ese campo y se responde `conflict_ignored`). |
| 7 | **Sesión sin location en el servidor** (FK) | La task de `Locales` ya se ejecuta antes en `syncAll`. Además, si el `locationId` no existe, se sube la location bajo demanda antes de la sesión. Nunca se descarta la sesión. |
| 8 | **Sync a medias deja datos inconsistentes** | Cola local: cada escritura marca `sync_status='pending'`. El push es reintentable e idempotente; hasta que el servidor confirma, la fila sigue `pending`. Nada se pierde por un corte de red. |
| 9 | **Rollback**: si el sync sale mal, poder volver atrás | Ninguna fase borra datos locales. Desactivar la task de `Sesiones` en `TASKS` deja la app funcionando exactamente como hoy. |

---

## 3. Fases de ejecución

Cada fase es entregable y verificable por separado. **Ninguna fase anterior a la 3
toca la red**, así que el riesgo se concentra al final y siempre con datos ya respaldados.

### Fase 0 — Blindaje local (sin red, sin cambios visibles)

1. `lib/device.ts`: `getDeviceId()` — UUID v4 persistido en AsyncStorage (`tpv:deviceId`).
2. Migración SQLite **v26** en `services/db.ts`:
   - `ALTER TABLE sessions ADD COLUMN updated_at TEXT` (backfill = `created_at`).
   - `ALTER TABLE sessions ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending'`.
   - `ALTER TABLE sessions ADD COLUMN deleted_at TEXT`.
   - `ALTER TABLE sessions ADD COLUMN origin TEXT NOT NULL DEFAULT 'local'`.
   - `ALTER TABLE sessions ADD COLUMN notes TEXT`.
   - `UPDATE sessions SET device_id = <deviceId> WHERE device_id IS NULL`.
   - Con el mismo patrón *self-heal* que ya usa el proyecto para columnas que fallaron
     silenciosamente (ver `products.profile` en `initDb`).
3. `insertSession()` pasa a rellenar `device_id`, `updated_at`, `origin='local'`,
   `sync_status='pending'`.
4. `getActiveSession()` filtra `origin='local' AND device_id = ?` **y** excluye
   `deleted_at IS NOT NULL`.
5. `getSessions()` excluye borradas; nueva `getUnsyncedSessions()`.

**Verificación**: abrir la app, comprobar que el historial muestra exactamente las mismas
sesiones que antes y que la sesión activa se recupera igual.

### Fase 1 — Backend: esquema + endpoints

1. **Migración 031** (`migrations/031_sessions_tpv_fields.sql`):
   `session_code VARCHAR(32) NULL`, `opened_at DATETIME NULL`, `auto_close_at DATETIME NULL`,
   `closed_at DATETIME NULL`, `device_id CHAR(36) NULL`, `updated_at DATETIME NULL`,
   `deleted_at DATETIME NULL`; índices `(device_id)`, `(date)`, `(status)`.
2. **`SessionRepository`**: `createOrUpdate` amplíado (incluye por fin `price_overrides`),
   `findAll(filtros)`, `softDelete`, `hasOrders`, `upsertBatch`.
3. **`SessionController`** (`/api/v1/tpv/sessions`):

   | Método | Ruta | Uso |
   |---|---|---|
   | `GET` | `/tpv/sessions?locationId&from&to&since&limit` | listado con filtros |
   | `GET` | `/tpv/sessions/{id}` | ya existe |
   | `POST` | `/tpv/sessions` | upsert de una (ya existe, ampliado) |
   | `POST` | `/tpv/sessions/batch` | **upsert por lotes** — clave para el backfill |
   | `PUT` | `/tpv/sessions/{id}` | update parcial: `status`, `notes`, `priceOverrides` |
   | `DELETE` | `/tpv/sessions/{id}` | soft delete (`deleted_at`) |

   Reglas: `closed` es terminal (riesgo 6); respuesta por elemento en el batch
   (`created` / `updated` / `duplicate` / `conflict_ignored` / `error`) igual que
   `SyncController::sync` para reutilizar el patrón.
4. Rutas registradas en `src/Bootstrap/Routes.php`, grupo `/tpv`, **antes** de las rutas
   `/sessions/{id}/expenses` ya existentes (orden de matching de Slim).

**Verificación**: pruebas con `curl` contra Laragon; el batch de 50 sesiones ficticias
crea 50 filas, y reenviarlo devuelve 50 `duplicate` sin duplicar nada.

### Fase 2 — App: cliente + sync

1. `services/sessionsApi.ts` (convención `services/`: nunca lanza, devuelve `{ok,...}`):
   - `pushPendingSessions()` — envía en lotes las `sync_status != 'synced'`; marca
     `synced` solo lo que el servidor confirma.
   - `pullSessions(since)` — descarga y hace **merge no destructivo**: inserta las
     desconocidas con `origin='remote'`; actualiza una fila existente **solo si** está
     `sync_status='synced'` y el `updated_at` remoto es posterior al local. Una fila
     `pending` se deja intacta (ya se subió en el push previo de esta misma pasada).
   - `syncSessions()` = push **y luego** pull, resultado `{ok, pushed, pulled}`.
2. Registrar la task en `services/syncAll.ts`:
   `{ label: 'Sesiones', run: syncSessionsTask }` **después de 'Locales'** (FK) y después
   de 'Productos' (los `priceOverrides` referencian productos).
3. Resolución de conflictos: **last-write-wins por `updated_at`**, con dos excepciones —
   `closed` es terminal, y `notes` editada en el admin gana sobre la app si su
   `updated_at` es posterior.

**Verificación**: primer sync de un dispositivo real → el backend acaba con exactamente
el mismo número de sesiones que tiene el móvil; segundo sync → 0 cambios.

### Fase 3 — CRUD completo en la UI

1. **Editar sesión** (nueva pantalla/diálogo desde el historial y desde la sesión activa):
   notas/comentario, ubicación, precios de sesión (`updateSessionPriceOverrides`, que hoy
   está huérfana). Editable también en sesiones de otros dispositivos. Cada guardado →
   `updated_at` nuevo + `sync_status='pending'` + push silencioso.
2. **Borrar sesión**: soft delete siempre. Si tiene tickets, diálogo de confirmación
   reforzado que muestra nº de tickets y total; los tickets no se borran, quedan ocultos
   con la sesión.
3. **Indicador de sync por sesión** en el historial: chip `Pendiente` / `Sincronizada`
   / `Error`, y etiqueta del dispositivo de origen en las sesiones `remote`.
4. Botón "Sincronizar" de Ajustes ya cubre todo sin tocar la UI (viene gratis por el
   registro en `TASKS`).

### Fase 4 — Verificación de la transición (obligatoria antes de producción)

Checklist a ejecutar **con el build de pruebas apuntando a Laragon**, no a producción:

1. Anotar en cada dispositivo: nº de sesiones, nº de tickets, id de la sesión activa.
2. Instalar la nueva versión (sin desinstalar — la migración v26 debe correr sobre los
   datos existentes).
3. Comprobar: mismo nº de sesiones, mismo historial, misma sesión activa, tickets intactos.
4. Sincronizar dispositivo A → contar sesiones en MySQL. Sincronizar B → el total debe ser
   la **suma**, sin solapes.
5. Sincronizar A de nuevo → `duplicate` en todo, 0 filas nuevas.
6. Cerrar sesión en A, sincronizar, comprobar que B no la reabre ni la adopta como activa.
7. Solo entonces: cambiar a modo producción y repetir 4-6.

---

## 4. Decisiones tomadas (2026-07-21)

1. **Sesiones compartidas y editables entre dispositivos.** Cualquier TPV ve y puede
   editar las sesiones de los demás. Consecuencias, todas ya incorporadas arriba:
   - La resolución de conflictos LWW por `updated_at` deja de ser un caso raro y pasa a
     ser el mecanismo central (§3 Fase 2.3).
   - `origin` **no** limita la edición: sirve solo para que una sesión de otro dispositivo
     **nunca** se convierta en la sesión activa de este (riesgo 3). Es la única frontera
     entre dispositivos que se mantiene.
   - El pull solo sobrescribe una fila local si está `synced` y el `updated_at` remoto es
     posterior. Una fila `pending` nunca se pisa: primero se sube (push va antes que pull
     en la misma pasada) y después se reconcilia.
2. **Borrado: soft delete siempre.** Se puede borrar cualquier sesión; si tiene tickets se
   exige confirmación reforzada (diálogo con el nº de tickets y el total). Nunca se borra
   la fila ni los tickets: solo se marca `deleted_at` en local y en el backend, y deja de
   listarse.
3. **Alcance: solo sesiones.** Los pedidos/tickets van en el paso siguiente reutilizando
   `POST /tpv/sync/orders`, que ya existe en el backend. `services/sync.ts` sigue en stub.
