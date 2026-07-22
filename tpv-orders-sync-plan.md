# Paso 5 de backend — Sincronización de pedidos + base para compartir/unir sesiones

> **Objetivo**: que los pedidos (tickets/comandas) se sincronicen con el backend en
> ambas direcciones, de modo que los **totales de una sesión se combinen entre
> dispositivos**. Esto es el cimiento de dos funciones que pediste (2026-07-22):
>
> 1. **Compartir sesión al abrir** — si B abre y ya hay una sesión abierta en otro
>    dispositivo, poder elegir "trabajar sobre la misma" o "abrir la propia".
> 2. **Unificar sesiones** — fusionar dos sesiones (con sus pedidos) en una sola
>    después, aunque se hayan abierto por separado (p. ej. porque B estaba sin red).
>
> Sin sincronizar pedidos, "misma sesión" no combina ventas ni totales — por eso
> este paso va primero. Se apoya en el contrato de `tpv-backend-integration-plan.md`
> y en el sync de sesiones ya hecho (`tpv-sessions-sync-plan.md`).

---

> **ESTADO (2026-07-22)**: **Fases 1–4 COMPLETADAS** (toda tu tanda "totales combinados").
> `tsc --noEmit` limpio salvo 4 errores preexistentes ajenos. Migración 032 aplicada en
> `burger_beats_local`.
>
> - **Fase 1 (backend)** — probada 12/12 con curl. `TicketRepository`, `TicketSyncService`,
>   `TicketController` (`POST /tpv/sync/tickets`, `GET /tpv/tickets`). Push idempotente por
>   `edit_count`, edición que reemplaza items, dos dispositivos con el mismo nº sin
>   colisión, pull anidado, total de sesión combinado.
> - **Fase 2 (push app)** — migración local v27 (`tickets.device_id` + backfill),
>   `getNextTicketNumber` por (sesión, dispositivo), `getUnsyncedTickets`/`markTicketsSynced`,
>   `services/ticketsApi.ts`, task 'Comandas' en `syncAll` (tras 'Sesiones').
> - **Fase 3 (pull app)** — `upsertTicketsFromBackend` (merge no destructivo por
>   `edit_count`), `pullTickets`, cursor `since`. El resumen de sesión ya suma las ventas
>   de todos los dispositivos.
> - **Fase 4 (prefijo)** — `deviceLetter` en el store + campo en Ajustes → Impresión; la
>   comanda impresa usa "A3" (o "#3" sin letra); la lista in-app aplica el mismo prefijo a
>   las comandas propias.
>
> - **Fase 5 (compartir al abrir)** — al pulsar "Abrir sesión" se consulta EN VIVO si hay
>   jornadas abiertas en otros dispositivos (cualquier local); si las hay, diálogo
>   "Unirse / Abrir la mía". Unirse adopta la sesión remota como activa
>   (`adoptSessionAsLocal`). Sin red → abre la propia. `fetchJoinableSessions` /
>   `joinRemoteSession` en `sessionsApi`.
> - **Fase 6 (unificar sesiones)** — pantalla `app/session/merge/[id].tsx` + botón en el
>   detalle; `mergeSessions(target, source)` mueve y renumera los tickets, concatena notas
>   y borra (soft) la origen. **Propagación verificada 6/6 con curl**: el ticket reasignado
>   con `edit_count+1` mueve su total de una sesión a otra en el backend.
>
> **Corrección (letra):** la letra de dispositivo es un identificador INTERNO — **NO se
> imprime** en la comanda (siempre "#3"); solo se muestra en la app.
>
> **Pendiente**: verificación con 2 dispositivos reales y desplegar migraciones **031**
> (sesiones) y **032** (tickets) a producción.

## 0. Estado actual (auditoría)

### 0.1 App (SQLite)

Modelo jerárquico:
- `tickets` (comanda): `id`, `session_id`, `ticket_number`, `printed_at`, `sync_status`,
  `created_at`, `edited_at`, `edit_count`.
- `orders` (persona): `id`, `ticket_id`, `client_name`, `price_profile`, `take_away`,
  `amount_paid`, `change`, `total`, `created_at`. **No tiene `session_id` ni número propio**
  — cuelga del ticket.
- `order_items`: `id`, `order_id`, `product_id`, `product_name`, `qty`, `unit_price`,
  `modifier_price_add`, `selected_modifiers` (JSON), `custom_label`.

El nº correlativo de la sesión es `ticket_number` ([`getNextTicketNumber`](tpv/services/db.ts)
= `MAX(ticket_number)+1` por sesión, **calculado en local**).

`services/sync.ts` está en **stub** (`API_BASE_URL = null`): nada de esto se sube.

### 0.2 Backend (MySQL)

Modelo plano (mig. 001):
- `orders`: `id`, `session_id`, `order_number` ("correlativo dentro de la sesión"),
  `client_name`, `price_profile`, `total`, `printed_at`, `edited_at`, `edit_count`,
  `created_at`. Comentario en el schema: *"Fusión deliberada de ticket+order"*.
- `order_items`: igual que la app.

Endpoint existente: `POST /api/v1/tpv/sync/orders` → `SyncController` → `SyncService`.
- Upsert por `id` con **idempotencia por `edit_count`** (reenviar el mismo pedido no
  duplica; un `edit_count` mayor actualiza).
- Crea la sesión mínima si no existe (`createMinimal`).
- **No existe GET de pedidos** (no hay dirección de bajada).

### 0.3 El desajuste de modelo (a resolver — §2)

El `order` del backend tiene `session_id` + `order_number` + **un** `client_name`. El
`Order` de la app tiene `ticket_id` + `client_name` pero **ni `session_id` ni número**, y
varios `Order` comparten un mismo `ticket_number`. Es decir: **la comanda que agrupa a
varias personas no tiene representación en el backend.** Nunca se notó porque el sync de
pedidos nunca se activó.

---

## 1. Riesgos (y cómo se neutralizan)

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | **Colisión de nº de comanda** entre dispositivos sobre la misma sesión (dos "COMANDA #3") | Numeración con **prefijo de dispositivo** (§3). Compatible con impresión offline. |
| 2 | **Pérdida de la agrupación por comanda** al aplanar al modelo backend | La decisión de mapeo (§2) preserva el ticket como entidad (opción recomendada B). |
| 3 | **Duplicar pedidos** al reenviar | Ya resuelto: idempotencia por `id` + `edit_count` en `SyncService`. Se mantiene. |
| 4 | **Unificar sesiones pierde/duplica pedidos** | La fusión reasigna `session_id`, **renumera** y sube `edit_count` (§4). Nada se borra; todo es upsert idempotente. |
| 5 | **Pull de pedidos pisa ediciones locales** | Mismo patrón que sesiones: LWW por `edit_count`/`updated_at`; no se pisa una fila local `pending`. |
| 6 | **Sesión sin location al bajar pedidos** (FK) | Sesiones se sincronizan **antes** que pedidos en `syncAll` (ya ordenado). |
| 7 | **Reglas de negocio del flujo de venta** (CLAUDE.md: cobrar no guarda, etc.) | El sync es una capa aparte; **no toca el flujo de venta**. Solo lee lo ya persistido. |

---

## 2. DECISIÓN CLAVE — cómo se representa una comanda en el backend

Hay que elegir **una** antes de implementar. Afecta a cómo se ven las ventas en el
admin/web y a qué granularidad se reporta.

**Opción A — "order backend = persona".** Cada `Order` (persona) de la app es un `order`
del backend. `order_number` = `ticket_number` (se repite entre personas del mismo ticket).
- ✅ Mínimo cambio en el backend.
- ❌ `order_number` deja de ser único por sesión; se pierde la comanda como grupo.

**Opción B — "añadir tickets al backend" (RECOMENDADA).** Se crea tabla `tickets` en el
backend (id, session_id, ticket_number, printed_at, edited_at, edit_count) y `orders` gana
`ticket_id`. El modelo del backend pasa a espejar el de la app fielmente.
- ✅ Se conserva la comanda (agrupa personas), los números son correctos, el admin puede
  mostrar ventas por comanda y por persona.
- ✅ La "unificación" y el "compartir" quedan naturales (mover tickets entre sesiones).
- ❌ Migración de esquema + adaptar `SyncService`/repos (moderado).

**Opción C — "order backend = comanda entera".** El `Ticket` de la app es un `order` del
backend; `client_name` se concatena, los items se aplanan.
- ❌ Se pierde el desglose por persona. Descartada salvo que el reporting no lo necesite.

> **Recomendación: Opción B.** Es la única que soporta bien "compartir" y "unificar" sin
> ambigüedad, y alinea de una vez los dos modelos. El resto del plan asume B (si eliges A
> o C, ajusto §3–§5).

---

## 3. Numeración de comandas entre dispositivos

El número se imprime **en el momento**, offline, así que **no** puede asignarlo el servidor.
Solución: **prefijo corto de dispositivo** en las comandas de una sesión compartida.

- Sesión de un solo dispositivo (caso normal): se imprime "COMANDA #3" como hoy.
- Sesión compartida/fusionada: "COMANDA A3" / "COMANDA B1" (prefijo = 1 letra o los 2
  últimos del `deviceId`), de modo que cocina las distingue y no chocan.
- En BD, `ticket_number` sigue siendo el correlativo **por (sesión, dispositivo)**; el
  prefijo es de presentación. El admin puede mostrar `device_prefix + ticket_number`.

---

## 4. Unificar dos sesiones (fusión)

Operación explícita desde la UI (p. ej. en el detalle de sesión: "Unir con otra sesión…").
Fusiona la sesión **origen** en la **destino**:

1. Reasignar cada ticket de la origen: `session_id = destino`, renumerar para no chocar
   con los de destino, `edit_count++`, `sync_status='pending'`.
2. Marcar la sesión origen como **fusionada** (nuevo estado o `merged_into = destinoId`)
   y `deleted_at`/oculta; nunca se borra físicamente.
3. Sincronizar: el push sube los tickets reasignados (upsert idempotente por `edit_count`)
   y el estado de ambas sesiones. Otros dispositivos lo reciben en el pull.
4. Los totales de la destino pasan a incluir todo automáticamente (agregación por
   `session_id`).

Requiere que los pedidos **ya se sincronicen** (este paso) y el pull de pedidos (§5).

---

## 5. Fases de ejecución

### Fase 1 — Backend: modelo + endpoints (asumiendo Opción B)
- Migración: tabla `tickets`, `orders.ticket_id`, `sessions.merged_into` (o estado).
- `SyncService`/repos: aceptar tickets con sus orders anidados; upsert idempotente por
  `edit_count` a nivel ticket.
- Nuevo `GET /api/v1/tpv/sessions/{id}/tickets` (o `GET /tpv/tickets?since=`) para el pull.

### Fase 2 — App: push de pedidos
- Adaptar `services/sync.ts` (quitar el stub) para subir tickets pendientes con sus
  orders+items, reutilizando la cola `sync_queue` que ya existe.
- Registrar en `syncAll` **después** de 'Sesiones'.

### Fase 3 — App: pull de pedidos
- Bajar tickets del backend y fusionarlos en SQLite sin destruir lo local (mismo patrón
  no destructivo que las sesiones).
- El resumen de sesión pasa a reflejar pedidos de todos los dispositivos.

### Fase 4 — Numeración con prefijo (§3)
- Añadir `device_prefix` al render de comanda cuando la sesión sea compartida.

### Fase 5 — Compartir al abrir (la función 1)
- Al pulsar "Abrir sesión": GET en vivo de sesiones abiertas de **cualquier local**
  (tu decisión). Si hay → diálogo: "Unirse a [Disp/hora]" | "Abrir la mía".
  Sin red → abrir la propia (tu decisión), unificable después.

### Fase 6 — Unificar sesiones (la función 2, §4)
- UI "Unir con otra sesión…" + la lógica de reasignación y sync.

### Fase 7 — Verificación con 2 dispositivos
- Checklist análogo al de sesiones: totales combinados correctos, sin pedidos perdidos ni
  duplicados, comandas sin colisión, fusión idempotente.

---

## 6. Decisiones tomadas (2026-07-22)

1. **§2 — modelo: Opción B.** El backend replica el modelo de la app: un `Ticket`
   agrupa un conjunto de `Orders` (personas), cada uno con sus `OrderItems`. **Sin clase
   intermedia** entre ticket y order, y **sin mezclar la información de unas personas con
   otras** (se descarta aplanar → no es la opción C). El `order` "fusionado" actual del
   backend deja de ser el contenedor: se añade la entidad `ticket` por encima.
2. **§3 — prefijo: letra asignada a mano.** Cada dispositivo elige su letra (A, B, C…) en
   Ajustes. La comanda compartida se imprime "COMANDA A3". Sin sesión compartida, sigue
   siendo "COMANDA #3". Implicación: el `ticket` necesita `device_id` y el nº correlativo
   pasa a ser por **(sesión, dispositivo)**, para que dos móviles no choquen.
3. **Alcance de esta tanda: Fases 1–4** (base: pedidos sincronizados en ambas direcciones
   + numeración sin colisión = "totales combinados"). Las Fases 5–6 (compartir al abrir /
   unificar) se harán después, sobre esta base ya probada.

### Concreción del esquema (Opción B)

Backend (nueva migración):
- Tabla `tickets`: `id`, `session_id` (FK), `ticket_number`, `device_id`, `printed_at`,
  `created_at`, `edited_at`, `edit_count`, `updated_at`, `deleted_at`.
- `orders`: nueva columna `ticket_id` (FK a `tickets`). Se conserva `order_number`
  espejando el `ticket_number` por compatibilidad. `session_id` se mantiene (denormalizado)
  para agregados directos.

App (SQLite, migración local): `tickets` gana `device_id` (backfill = este dispositivo) y
`getNextTicketNumber` pasa a ser `MAX(ticket_number)+1` por **(sesión, dispositivo)**.
