# Plan de integración TPV ↔ Backend — Burger Beats

> **Para quién es este documento**: para el **Claude Code del repositorio de la app TPV**
> (React Native). Es la especificación COMPLETA y FIEL AL CÓDIGO del backend para
> implementar la capa de conexión total con la API.
>
> **Origen**: auditado directamente sobre el código del backend (no solo sobre la
> documentación). Cuando este documento y `docs/api-endpoints.md` discrepan, **manda
> este documento** porque refleja lo que el controlador realmente hace hoy.
>
> **Fecha de auditoría**: 2026-06-17.

---

## 0. TL;DR — qué hay que construir

La TPV debe poder, contra este backend:

1. **Comprobar conectividad** (`GET /health`).
2. **Sincronizar localizaciones** (crear/listar puntos de venta).
3. **Abrir/cerrar jornadas** (`sessions`, upsert por UUID del TPV).
4. **Sincronizar pedidos** offline-first, idempotente, en lote (`sync/orders`).
5. **Registrar y consultar gastos del día** (gasolina, gas, peajes…) con su forma de pago.

Todo con UUIDs generados en el TPV, fechas en UTC, y tolerancia a reintentos.

---

## 1. Configuración base del cliente HTTP

### 1.1 Base URL

| Entorno | Base URL | Prefijo API |
|---|---|---|
| Local (Laragon) | `http://burger-beats-backend.test` | `/api/v1` |
| Producción | (dominio del hosting, HTTPS obligatorio) | `/api/v1` |

→ El cliente debe tener la base URL como **configurable** (variable de entorno /
constante de build), nunca hardcodeada. Todas las rutas TPV cuelgan de
`{baseUrl}/api/v1/tpv/...`.

> En local, si pruebas desde un emulador Android, `localhost` apunta al propio
> emulador. Usa `http://10.0.2.2` (AVD) o la IP LAN del PC con Laragon. Documenta
> esto en el README del TPV.

### 1.2 Headers obligatorios

```
Content-Type: application/json
Accept: application/json
X-API-Key: <clave del dispositivo>      ← ver 1.3
```

### 1.3 Autenticación por API Key — IMPORTANTE (estado actual)

- El backend define `ApiKeyMiddleware` que valida el header **`X-API-Key`** comparándolo
  (con `hash_equals`, comparación exacta) contra `config['tpv']['api_key']`.
- **HOY el grupo `/api/v1/tpv/*` NO tiene ese middleware aplicado** (ver
  [Routes.php:158-160](../src/Bootstrap/Routes.php#L158-L160): _"TPV móvil — sin auth por
  ahora"_). Es decir, ahora mismo las llamadas funcionan **sin** API key.
- **Decisión de diseño para el cliente TPV**: enviar **siempre** el header `X-API-Key`
  desde el primer día, leyéndolo de configuración segura del dispositivo. Cuando el
  backend active el middleware, el TPV no se romperá. Enviar el header de más no molesta
  (el backend lo ignora hoy).
- Cuando se active, una clave inválida/ausente devuelve **HTTP 401** con un cuerpo
  **NO estándar**: `{ "error": "invalid_api_key" }` (no lleva el envoltorio `ok/error`).
  El cliente debe tratar el 401 como "credencial inválida → no reintentar, avisar".
- Formato de la clave (según `docs/sync-protocol.md`): `bb_` + 40 hex. Almacenarla en
  almacenamiento seguro (Keychain / Keystore / SecureStore), nunca en el bundle.

### 1.4 CORS

`CorsMiddleware` aplica CORS global con orígenes en `config['cors']['allowed_origins']`
y ya permite el header `X-API-Key`. **Para una app React Native nativa esto es
irrelevante** (no hay navegador → no hay preflight CORS). Solo importa si la TPV corre
como web (Expo web): en ese caso hay que añadir el origin web a `allowed_origins` del
backend.

---

## 2. Contrato común de respuestas

### 2.1 Envoltorio estándar (todas las rutas TPV salvo el 401 de API key)

**Éxito:**
```json
{ "ok": true, "data": { /* payload */ } }
```

**Error:**
```json
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "Datos inválidos", "fields": { "campo": "motivo" } } }
```

`fields` solo aparece en errores de validación. El cliente debe:
- Leer `ok` primero.
- Si `ok === false`, usar `error.code` para lógica y `error.message` para UI.
- Mapear `error.fields` a errores por campo en formularios.

### 2.2 Códigos HTTP usados

| HTTP | Cuándo | `error.code` típico |
|---|---|---|
| 200 | OK (incluido sync con errores por-pedido dentro de `results`) | — |
| 201 | Creado (locations, sessions, expenses, categoría nueva) | — |
| 401 | API key inválida (cuerpo NO estándar) | `invalid_api_key` |
| 404 | Recurso no existe (sesión/gasto) | `NOT_FOUND` |
| 422 | Validación | `VALIDATION_ERROR` |
| 500 | Error de servidor | `SERVER_ERROR` |

→ El cliente HTTP debe construir el resultado a partir del **cuerpo** (`ok`), no solo del
status. Un único helper `request()` que parsee el envoltorio y lance un error tipado
(`ApiError { code, message, fields, httpStatus }`) es la base de toda la integración.

---

## 3. Convenciones de datos (gotchas que rompen integraciones)

Estas son las trampas reales del backend. Respetarlas evita el 90% de los bugs.

### 3.1 camelCase en el JSON

Entrada y salida de la API en **camelCase** (`locationId`, `priceProfile`,
`paymentMethod`…). En BD es snake_case, pero el backend traduce. El cliente trabaja
siempre en camelCase.

### 3.2 ⚠️ Los DECIMAL llegan como STRING

El backend usa PDO con `EMULATE_PREPARES=false`. Los campos `DECIMAL` de MySQL se
serializan a JSON como **string**, no como número:

- `order.total`, `orderItem.unitPrice`, `orderItem.modifierPriceAdd`
- `expense.amount`, `expense.vatRate`, `expense.vatAmount`, `expense.totalAmount`
- `totals.total`, `totals.totalCard`, `totals.totalCash` → strings (`"0"`, `"12.50"`)

→ El cliente debe **parsear** (`parseFloat` / librería decimal) al leer, y enviar números
o strings al escribir (el backend castea con `(float)`, así que ambos valen al **enviar**;
el problema es solo al **leer**). Recomendado: tipar estos campos como `string` en los
modelos de respuesta y convertir en una capa de mapeo.

Campos **enteros** (`orderNumber`, `editCount`, `qty`, `totals.count`) sí llegan como
número JSON. `isDefault` llega como boolean.

### 3.3 Fechas

- **`date`**: formato **`YYYY-MM-DD`** (validación estricta `Y-m-d`). Es la fecha de
  jornada / del gasto. Sin hora.
- **`printedAt` / `editedAt`** (orders): **ISO 8601**. El backend los interpreta y
  almacena en **UTC**. **Enviar siempre en UTC con sufijo `Z`** (ej.
  `2026-06-17T14:32:00Z`). Si envías hora local sin zona, el backend la tratará como UTC
  y desfasará.
- Todos los timestamps que devuelve el backend (`createdAt`, etc.) están en **UTC**
  (formato `YYYY-MM-DD HH:MM:SS`, sin `Z` ni `T`). El cliente debe tratarlos como UTC.

### 3.4 UUIDs generados en el TPV (cliente)

El TPV **genera los UUID v4** de `locations`, `sessions`, `orders` y `order_items`. Esto
es lo que hace la sincronización idempotente. Reglas de validación del backend:

- `orders[].id` y nada más en el batch: regex **UUID v4 estricto** (`8-4-4-4-12` hex). Un
  UUID mal formado → ese pedido vuelve con `status: "error"`.
- `locations.id`, `sessions.id`, `expense.*`: solo se valida **longitud ≤ 36** (no el
  formato). Aun así, **usa siempre UUID v4 canónico** para todo.

→ El TPV debe persistir el UUID localmente en el momento de crear la entidad y reutilizarlo
en cada reintento de sync (NO regenerar).

---

## 4. Catálogo de endpoints (contrato detallado)

> Todas las rutas con prefijo `{baseUrl}/api/v1`. Enviar `X-API-Key` en todas (ver 1.3).

### 4.0 `GET /health` — smoke test (público, fuera de /tpv)

- **Uso**: comprobar conectividad/al arrancar y antes de un sync grande.
- **Respuesta 200**:
```json
{ "ok": true, "data": { "status": "healthy", "time": "2026-06-17T12:00:00+00:00" } }
```

---

### 4.1 `GET /tpv/locations` — listar localizaciones

- **Respuesta 200**:
```json
{ "ok": true, "data": { "locations": [
  { "id": "uuid", "name": "Local principal", "isDefault": true, "createdAt": "2026-06-17 10:00:00" }
] } }
```
- Orden: `is_default DESC, name ASC`.

---

### 4.2 `POST /tpv/locations` — crear localización (idempotente)

- **Body**:
```json
{ "id": "uuid-generado-en-tpv", "name": "Terraza" }
```
- **Validación**: `id` requerido (string ≤36), `name` requerido (string ≤100).
- **Idempotente**: si el `id` ya existe, devuelve **201** con el registro existente
  (NO error). Por tanto **201 no implica "creado nuevo"**.
- **Respuesta 201**:
```json
{ "ok": true, "data": { "location": { "id": "...", "name": "Terraza", "isDefault": false, "createdAt": "..." } } }
```
- **Nota**: el campo `isDefault` se puede mandar en el body (`"isDefault": true`) y el
  repo lo respeta (desmarca las demás), aunque el validador no lo exige. La doc de
  endpoints no lo menciona; el código sí lo soporta.

---

### 4.3 `POST /tpv/sessions` — crear/actualizar jornada (upsert)

- **Body**:
```json
{
  "id": "uuid-sesion",
  "locationId": "uuid-location",
  "date": "2026-06-17",
  "status": "open",
  "notes": "Feria del pueblo"
}
```
- **Validación**:
  - `id` requerido (≤36), `locationId` requerido (≤36), `date` requerido (`YYYY-MM-DD`).
  - `status` opcional, enum `open|closed` (si se omite, en creación queda `open`).
  - `notes` opcional (≤2000).
  - ⚠️ **`locationId` debe existir** o devuelve **422** `{ fields: { locationId: "La localización no existe" } }`.
    → **Crear la location ANTES de la session** (ver flujo §5).
- **Upsert**: si el `id` existe, **actualiza** `location_id`, `status`, `notes`.
  Devuelve **201 siempre** (tanto al crear como al actualizar).
- **Respuesta 201**:
```json
{ "ok": true, "data": { "session": {
  "id": "...", "locationId": "...", "date": "2026-06-17",
  "status": "open", "priceOverrides": null, "notes": "Feria del pueblo", "createdAt": "..."
} } }
```
- ⚠️ **`priceOverrides` NO se persiste por este endpoint hoy**. Aunque lo envíes en el
  body, `createOrUpdate` no lo guarda; siempre se devuelve `null` (salvo que se haya
  fijado por otra vía). No dependas de él para perfiles de precio: los precios aplicados
  viajan ya calculados en cada `order`/`order_item` del sync (ver 4.5). Si en el futuro
  se necesita, hay que ampliar el backend.

---

### 4.4 `GET /tpv/sessions/{id}` — detalle de jornada

- **Respuesta 200**: mismo shape de `session` que arriba.
- **404** `NOT_FOUND` si no existe.
- **Nota**: una sesión auto-creada por el sync (ver 4.5) tendrá `locationId: null` y
  `status: "open"` hasta que el TPV haga `POST /tpv/sessions` con los datos reales.

---

### 4.5 `POST /tpv/sync/orders` — sincronizar pedidos (LOTE, idempotente)

El endpoint central del TPV. Recibe un **array JSON** de pedidos (no un objeto).

- **Body** (array; cada elemento es un pedido):
```json
[
  {
    "id": "uuid-del-tpv",
    "sessionId": "uuid-sesion",
    "orderNumber": 42,
    "clientName": "Juan",
    "priceProfile": "normal",
    "total": 13.40,
    "printedAt": "2026-06-17T14:32:00Z",
    "editedAt": null,
    "editCount": 0,
    "items": [
      {
        "id": "uuid-item",
        "productId": "fat-furious",
        "productName": "FAT & FURIOUS",
        "qty": 2,
        "unitPrice": 6.50,
        "modifierPriceAdd": 0.40,
        "selectedModifiers": ["mod-sin-lechuga"],
        "customLabel": null
      }
    ]
  }
]
```

- **Validación por pedido** (si falla, ese pedido sale como `error`, los demás continúan):
  - `id`: requerido, **UUID v4 válido**.
  - `sessionId`: requerido. **No hace falta crear la sesión antes**: si no existe, el
    backend crea una **sesión mínima** (`locationId=null`, `status=open`, `date` derivada
    de `printedAt`). Aun así conviene hacer `POST /sessions` para fijar location/status.
  - `orderNumber`: entero > 0.
  - `priceProfile`: enum `normal|feriante|invitacion`.
  - `total`: número ≥ 0.
  - `printedAt`: requerido, ISO 8601 válido (**UTC con `Z`**).
  - `items`: array con ≥ 1 elemento. Por item: `id`, `productId`, `productName`
    requeridos; `qty` entero > 0; `unitPrice` número ≥ 0. `modifierPriceAdd` (def 0),
    `selectedModifiers` (array o null), `customLabel` (string o null) son opcionales.

- **Idempotencia (clave)**: por `id` + `editCount`:
  - `id` no existe → inserta → `status: "created"`.
  - `id` existe y `editCount` entrante **≤** almacenado → no-op → `status: "duplicate"`.
  - `id` existe y `editCount` entrante **>** almacenado → reemplaza pedido + items →
    `status: "updated"`.
  - → El TPV debe **incrementar `editCount`** cada vez que edita un pedido ya impreso, o
    la corrección se ignorará como duplicado.

- **Respuesta 200** (siempre 200 salvo body vacío/no-array → 422, o 500):
```json
{ "ok": true, "data": {
  "results": [
    { "id": "uuid-1", "status": "created" },
    { "id": "uuid-2", "status": "duplicate" },
    { "id": "uuid-3", "status": "updated" },
    { "id": "uuid-4", "status": "error", "reason": "items[0].qty debe ser un entero mayor que 0" }
  ],
  "summary": { "total": 4, "created": 1, "duplicated": 1, "updated": 1, "errors": 1 }
} }
```

- **Procesamiento del resultado en el TPV**:
  - `created` / `updated` / `duplicate` → marcar el pedido local como **sincronizado**
    (los tres son éxito desde el punto de vista de la cola).
  - `error` → mantener en la cola y mostrar/loguear `reason`. Si `reason` es de validación
    estructural (no transitorio), reintentar a ciegas no lo arregla → marcar para revisión.
  - Cada pedido se procesa en su **propia transacción** en el backend: un fallo no tumba
    el lote.

- **Body vacío o no-array** → **422** `VALIDATION_ERROR` "El body debe ser un array de
  orders no vacío".

---

### 4.6 `GET /tpv/expenses/categories` — listar categorías de gasto

- **Respuesta 200**:
```json
{ "ok": true, "data": { "categories": [ { "id": "uuid", "name": "Gasolina" } ] } }
```
- Orden alfabético por nombre.

---

### 4.7 `POST /tpv/expenses/categories` — crear categoría (idempotente por nombre)

- **Body**: `{ "name": "Peajes" }` (requerido, ≤100; se hace `trim`).
- **Idempotente**: si ya existe una con ese nombre, devuelve **200** con la existente. Si
  es nueva, **201**.
- **Respuesta**:
```json
{ "ok": true, "data": { "category": { "id": "uuid", "name": "Peajes" } } }
```
- → Permite que el operario teclee una categoría nueva sobre la marcha sin gestionar
  colisiones en el cliente.

---

### 4.8 `GET /tpv/sessions/{id}/expenses` — gastos de la jornada + totales

- **404** `NOT_FOUND` si la sesión no existe.
- **Respuesta 200**:
```json
{ "ok": true, "data": {
  "expenses": [ { /* shape de gasto, ver 4.9 */ } ],
  "totals": { "total": "45.50", "totalCard": "20.00", "totalCash": "25.50", "count": 3 }
} }
```
- ⚠️ Los importes de `totals` son **strings**. `count` es entero.
- Uso típico: conciliación de caja al cerrar la jornada (efectivo gastado vs caja).

---

### 4.9 `POST /tpv/sessions/{id}/expenses` — registrar gasto en la jornada

- **404** `NOT_FOUND` si la sesión no existe.
- **Body**:
```json
{
  "categoryId": "uuid-categoria",
  "amount": 50.00,
  "paymentMethod": "tarjeta",
  "date": "2026-06-17",
  "description": "Diésel furgoneta",
  "vatRate": 21,
  "supplierId": null,
  "notes": null
}
```
- **Validación**:
  - `categoryId` requerido (≤36) y **debe existir** (si no → 422 `categoryId`).
  - `amount` requerido, numérico, ≥ 0 (**sin IVA**).
  - `paymentMethod` requerido, enum `tarjeta|efectivo`.
  - `date` requerido (`YYYY-MM-DD`).
  - `description` ≤255, `vatRate` numérico, `totalAmount` numérico, `supplierId` ≤36 (si se
    envía, **debe existir** o 422), `notes` ≤65535 — todos opcionales.
- **Cálculo del total**: si **no** envías `totalAmount`, el backend calcula
  `total = amount + (amount * vatRate / 100)` (y si tampoco hay `vatRate`,
  `total = amount`). Si envías `totalAmount`, manda el tuyo.
- **`createdBy` es siempre `null`** para gastos del TPV (no hay usuario, solo API key).
- Se aceptan gastos **aunque la sesión esté cerrada**.
- **Respuesta 201**: `{ "ok": true, "data": { "expense": { /* shape abajo */ } } }`.

**Shape del gasto (`expense`)** — devuelto aquí y en 4.8:
```json
{
  "id": "uuid",
  "categoryId": "uuid",
  "categoryName": "Gasolina",
  "sessionId": "uuid-sesion",
  "description": "Diésel furgoneta",
  "amount": "50.00",
  "vatRate": "21.00",
  "vatAmount": "10.50",
  "totalAmount": "60.50",
  "paymentMethod": "tarjeta",
  "supplierId": null,
  "supplierName": null,
  "date": "2026-06-17",
  "notes": null,
  "createdAt": "2026-06-17 14:00:00"
}
```
⚠️ `amount`, `vatRate`, `vatAmount`, `totalAmount` son **strings**.

---

### 4.10 `DELETE /tpv/sessions/{sessionId}/expenses/{id}` — borrar gasto

- Borra solo si el gasto pertenece a esa sesión; si no, **404** `NOT_FOUND`.
- **Respuesta 200**: `{ "ok": true, "data": { "message": "Gasto eliminado" } }`.
- Es **hard delete** (no soft). El TPV debe confirmar con el usuario antes.

---

## 5. Flujos de integración (orden de operaciones)

### 5.1 Arranque de la app
1. `GET /health` → si falla, modo offline (encolar todo).
2. `GET /tpv/locations` → cachear localizaciones.
3. `GET /tpv/expenses/categories` → cachear categorías.

### 5.2 Abrir jornada
1. Asegurar la location: si el operario elige una existente, usar su `id`. Si crea una
   nueva, `POST /tpv/locations` (idempotente).
2. **Solo entonces** `POST /tpv/sessions` con `status: "open"` (la location debe existir).
3. Guardar `sessionId` como jornada activa local.

### 5.3 Durante el servicio
- Los pedidos se generan **offline** y se encolan localmente (ver §6). El sync puede
  correr en background; no bloquear la venta por la red.
- Gastos del día: `POST /tpv/sessions/{id}/expenses`. Si no hay red, encolar y reintentar.
  (Si la categoría es nueva, primero `POST /tpv/expenses/categories` — idempotente — para
  obtener su `id`.)

### 5.4 Sincronizar pedidos
- Enviar en **lotes** (p. ej. 25–50 pedidos) los pedidos pendientes/editados.
- Por cada `results[i]`: marcar `created|updated|duplicate` como sincronizado; reencolar
  `error` con su `reason`.
- Reintentos con backoff. La idempotencia garantiza que reenviar es seguro.

### 5.5 Cerrar jornada
1. Sincronizar pedidos pendientes (drenar la cola).
2. (Opcional) `GET /tpv/sessions/{id}/expenses` para conciliación de caja
   (`totals.totalCash` vs efectivo contado).
3. `POST /tpv/sessions` con el mismo `id` y `status: "closed"` (upsert).

---

## 6. Cola offline + motor de sincronización (lo que hay que construir en el TPV)

Esto es el corazón de la "conexión total". Implementar:

1. **Almacenamiento local persistente** (SQLite / WatermelonDB / AsyncStorage según
   tamaño): tablas espejo de `locations`, `sessions`, `orders`, `order_items`, `expenses`,
   con un campo de estado de sync: `pending | synced | error` y `lastError`.
2. **Generación de UUID v4 en el cliente** al crear cada entidad; persistir y reutilizar.
3. **`editCount`** por pedido: arranca en 0; **+1 en cada edición** posterior a impresión.
   Guardar `printedAt`/`editedAt` en **UTC**.
4. **Outbox / cola de sync**: una cola por tipo de entidad. Disparadores: al recuperar
   conectividad (NetInfo), periódicamente, y manualmente ("Sincronizar ahora").
5. **Worker de sync**:
   - Pedidos → `POST /tpv/sync/orders` en lotes; conciliar por `results`.
   - Gastos → `POST` individuales; en 404 de sesión, reabrir/asegurar sesión primero.
   - Backoff exponencial + límite de reintentos; en 401 (api key) **no** reintentar, avisar.
6. **Idempotencia de extremo a extremo**: reenviar SIEMPRE es seguro (locations/sessions
   son upsert, orders por editCount, categorías por nombre). No borrar de la cola hasta
   confirmar éxito en la respuesta.

---

## 7. Plan de implementación por fases (para el Claude Code del TPV)

> Cada fase deja la app en estado usable. Tipos en TypeScript.

**Fase 0 — Andamiaje del cliente API**
- `apiConfig` (baseUrl, apiKey desde almacenamiento seguro).
- `httpClient` con un único `request()` que: añade headers, serializa JSON, parsea el
  envoltorio `{ok,data|error}`, y lanza `ApiError { code, message, fields, httpStatus }`.
  Caso especial: 401 con cuerpo `{ error: "invalid_api_key" }`.
- Tipos base (`ApiResult`, `ApiError`) + tests del parser (incluido el 401 no estándar y
  el sync con `results` mixtos).

**Fase 1 — Recursos de solo lectura / catálogos**
- `getHealth()`, `listLocations()`, `listExpenseCategories()`.
- Mapeadores que convierten DECIMAL-string ↔ número.

**Fase 2 — Localizaciones y sesiones**
- `createLocation()`, `createOrUpdateSession()`, `getSession()`.
- Flujo "abrir jornada" (location antes que session; manejar 422 locationId).

**Fase 3 — Gastos**
- `createExpenseCategory()` (idempotente), `createSessionExpense()`,
  `listSessionExpenses()`, `deleteSessionExpense()`.
- UI de conciliación con `totals`.

**Fase 4 — Sync de pedidos (núcleo offline)**
- Modelo local de `orders`/`items` + outbox + `editCount`.
- `syncOrders(batch)` + conciliación por `results` + reintentos/backoff.

**Fase 5 — Orquestación**
- Worker de sync en background (NetInfo + periódico + manual).
- Pantalla de estado de sync (pendientes / errores con `reason`).

**Fase 6 — Endurecimiento**
- Manejo de 401 (api key), timeouts, modo avión, tests de idempotencia
  (reenviar el mismo lote no duplica), pruebas contra el backend local.

---

## 8. Checklist de "conexión total"

- [ ] Cliente HTTP con envoltorio `{ok,data|error}` y `ApiError` tipado.
- [ ] `X-API-Key` enviado en todas las llamadas (desde almacenamiento seguro).
- [ ] Manejo del 401 no estándar (`{ "error": "invalid_api_key" }`).
- [ ] DECIMAL-string parseado a número en lectura; fechas en UTC; `date` en `YYYY-MM-DD`.
- [ ] UUID v4 generado en cliente y reutilizado en reintentos.
- [ ] `GET /health` integrado (gating de conectividad).
- [ ] `locations`: list + create (idempotente).
- [ ] `sessions`: createOrUpdate (location existe antes) + get. `priceOverrides` NO se usa.
- [ ] `sync/orders`: lote + idempotencia por `editCount` + conciliación de `results`.
- [ ] `expenses`: categorías (idempotente) + crear/listar/borrar por sesión + `totals`.
- [ ] Outbox offline + worker de sync con backoff.
- [ ] Tests: parser, idempotencia de sync, error por-pedido, 404 sesión, 422 validación.

---

## 9. Apéndice — tabla rápida de validaciones (para evitar 422)

| Campo | Endpoint(s) | Regla |
|---|---|---|
| `id` (location/session) | POST locations/sessions | requerido, string ≤36 |
| `name` (location) | POST locations | requerido, ≤100 |
| `locationId` | POST sessions | requerido, ≤36, **debe existir** |
| `date` | sessions, expenses | requerido, `YYYY-MM-DD` estricto |
| `status` | POST sessions | opcional, `open|closed` |
| `notes` | POST sessions | opcional, ≤2000 |
| `orders[].id` | sync | requerido, **UUID v4** |
| `orderNumber` | sync | entero > 0 |
| `priceProfile` | sync | `normal|feriante|invitacion` |
| `total` | sync | número ≥ 0 |
| `printedAt` | sync | ISO 8601, **UTC `Z`** |
| `items[].qty` | sync | entero > 0 |
| `items[].unitPrice` | sync | número ≥ 0 |
| `categoryId` | POST expenses | requerido, ≤36, **debe existir** |
| `amount` | POST expenses | requerido, numérico ≥ 0 |
| `paymentMethod` | POST expenses | requerido, `tarjeta|efectivo` |
| `supplierId` | POST expenses | opcional, ≤36, **debe existir** si se envía |

## 10. Apéndice — ejemplos `curl` (contra local)

```bash
# Health
curl http://burger-beats-backend.test/api/v1/health

# Crear localización (idempotente)
curl -X POST http://burger-beats-backend.test/api/v1/tpv/locations \
  -H "Content-Type: application/json" -H "X-API-Key: bb_xxx" \
  -d '{"id":"11111111-1111-4111-8111-111111111111","name":"Terraza"}'

# Abrir sesión (la location debe existir)
curl -X POST http://burger-beats-backend.test/api/v1/tpv/sessions \
  -H "Content-Type: application/json" -H "X-API-Key: bb_xxx" \
  -d '{"id":"22222222-2222-4222-8222-222222222222","locationId":"11111111-1111-4111-8111-111111111111","date":"2026-06-17","status":"open"}'

# Sincronizar pedidos (array)
curl -X POST http://burger-beats-backend.test/api/v1/tpv/sync/orders \
  -H "Content-Type: application/json" -H "X-API-Key: bb_xxx" \
  -d '[{"id":"33333333-3333-4333-8333-333333333333","sessionId":"22222222-2222-4222-8222-222222222222","orderNumber":1,"priceProfile":"normal","total":13.40,"printedAt":"2026-06-17T14:32:00Z","editCount":0,"items":[{"id":"44444444-4444-4444-8444-444444444444","productId":"fat-furious","productName":"FAT & FURIOUS","qty":1,"unitPrice":13.40}]}]'

# Registrar gasto en la sesión
curl -X POST http://burger-beats-backend.test/api/v1/tpv/sessions/22222222-2222-4222-8222-222222222222/expenses \
  -H "Content-Type: application/json" -H "X-API-Key: bb_xxx" \
  -d '{"categoryId":"<uuid-categoria>","amount":50,"paymentMethod":"tarjeta","date":"2026-06-17","vatRate":21}'
```

---

## 11. Notas para el backend (fuera del alcance del TPV, pero a tener presente)

Estas NO las implementa el TPV, pero condicionan la integración:

1. **Activar `ApiKeyMiddleware` en `/tpv`** cuando se quiera proteger. El TPV ya debe
   enviar `X-API-Key`, así que el cambio será transparente.
2. **`priceOverrides` no se persiste** en `POST /tpv/sessions`. Si se necesita, ampliar el
   controlador/repositorio.
3. No existe (aún) endpoint TPV para **leer pedidos** ya sincronizados ni para listar
   sesiones; el TPV es la fuente de los pedidos y mantiene su copia local.
