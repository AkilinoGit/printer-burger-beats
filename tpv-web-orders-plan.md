# Pedidos web → TPV (impresión instantánea)

> **Objetivo** (2026-07-23): que un cliente pueda hacer un pedido desde una web y que
> ese pedido **aparezca e imprima al instante** en el TPV, siempre que haya una sesión
> abierta y un dispositivo escuchando.
>
> Se apoya en el sync ya existente (`tpv-orders-sync-plan.md`, `tpv-sessions-sync-plan.md`)
> y **no lo modifica**: el pedido web se materializa como un `Ticket` + `Order` locales
> normales, así que caja, histórico y sync siguen funcionando sin tocar nada.

---

> **ESTADO (2026-07-23)**: **Fases 0–2 COMPLETADAS**. Falta la Fase 3 (web de cliente),
> parada a la espera de decisiones. `tsc --noEmit` limpio.
>
> - **Fase 0** — migración `035_web_orders.sql` aplicada en `burger_beats_local`
>   (`web_orders`, `web_order_items`, `sessions.last_seen_at`, `web_rate_limit`).
> - **Fase 1 (backend)** — `WebOrderRepository`, `Api\Web\WebOrderController` (público)
>   y `Api\Tpv\WebOrderController`. **25/25 con curl**:
>   `tests/Integration/web-orders.sh` cubre SERVICE_CLOSED, heartbeat, precios
>   recalculados, idempotencia por `clientRequestId`, claim concurrente A/B,
>   caducidad del claim, ACK y rate limit.
> - **Fase 2 (app)** — migración SQLite v30 (`tickets.source`, `tickets.web_order_id`
>   + self-heal), `services/webOrdersApi.ts`, `services/webOrders.ts` (poller),
>   `stores/useWebOrdersStore.ts`, `components/WebOrderBanner.tsx`,
>   `components/WebOrderTray.tsx`, cabecera `*** PEDIDO WEB ***` en `escpos.ts`.
>   **7/7** en `tests/Integration/web-orders-poller-sim.mjs`, que simula el ciclo del
>   poller con dos dispositivos compitiendo.
>
> **Corrección durante la Fase 1**: `releaseStaleClaims` liberaba por `printed_at IS NULL`,
> lo que devolvía a la cola un pedido cuya impresión había fallado — y el TPV que lo tenía
> ya había creado la comanda, así que otro dispositivo habría generado una **segunda
> comanda para el mismo pedido**. Ahora la condición es `ticket_id IS NULL` (§3.2).
>
> - **Códigos de descuento (§5.1)** — migración 036 (`web_promo_codes` + campos de
>   descuento en `web_orders`), `WebPromoCodeRepository`, `Admin\PromoCodeController`
>   (CRUD), migración SQLite v31 (`orders.notes`, `discount_amount`, `discount_label`),
>   comentario de cocina y línea de descuento fijo en `escpos.ts`.
>   **26/26** en `web-promo-codes.mjs` y **8/8** en `tpv/scripts/check-ticket-totals.ts`.
>
> **Total: 66/66 en las cuatro suites.**
>
> **Pendiente antes de producción**: probar con impresora y dispositivo reales, decidir
> el aviso sonoro (hoy solo vibración, ver §7) y desplegar las migraciones 035 y 036.

---

## 0. Decisiones tomadas

| Decisión | Elección |
|---|---|
| Transporte | **Polling corto (3 s) como fuente de verdad**; Expo Push opcional como "timbre" |
| Al entrar un pedido | **Auto-imprimir** + sonido + banner. Anulable después |
| Sin sesión abierta | La web **no deja ni empezar** el pedido |
| Sesión cerrada a media compra | Al enviar → mensaje *"El servicio ha cerrado, acércate en persona"* |
| Web de cliente | **Hay que construirla entera** (hoy `src/Controllers/Web` está vacío) |

### 0.1 Por qué polling y no WebSocket/SSE

El hosting es **cPanel compartido sin SSH** (ver `proceso de subida back.md`): no hay
forma de mantener un proceso persistente (Reverb, Ratchet, Node) → WebSocket propio
descartado. SSE/long-polling en PHP ocuparía un worker PHP-FPM por dispositivo durante
toda la espera, contra el límite de *entry processes* del plan y peleándose con el
buffering de LiteSpeed/Cloudflare → frágil como base.

Un `GET` cada 3 s sobre un índice `(status, created_at)` son ~9.600 requests en 8 h de
servicio con un TPV: irrelevante. Latencia máxima 3 s, media 1,5 s — se percibe como
instantáneo.

**Principio**: el push nunca transporta el pedido, solo avisa de que hay algo nuevo. Un
push perdido (Doze mode, token caducado) no pierde el pedido porque el poller lo recoge
igual. Esto mantiene la regla de *Arquitectura offline-first*: la red acelera, nunca es
la fuente de verdad.

### 0.2 El heartbeat sale gratis

El propio poller actualiza `sessions.last_seen_at` en cada tick. Con eso, "¿está abierto?"
deja de ser "¿hay una fila `status='open'`?" (que puede ir por detrás si el TPV cerró sin
red) y pasa a ser **"hay sesión abierta Y algún TPV la está escuchando ahora mismo"**.
Si `last_seen_at` > 60 s, la web dice cerrado. Sin esto, una sesión cerrada sin cobertura
dejaría la web aceptando pedidos que nadie va a imprimir.

---

## 1. Modelo de datos

### 1.1 Backend — migración `035_web_orders.sql`

```sql
CREATE TABLE `web_orders` (
    `id`                CHAR(36)     NOT NULL,
    `client_request_id` CHAR(36)     NOT NULL COMMENT 'Idempotencia: UUID del navegador',
    `session_id`        CHAR(36)     NULL     COMMENT 'Sesión abierta en el momento de crear',
    `status`            VARCHAR(16)  NOT NULL DEFAULT 'pending'
                        COMMENT 'pending | claimed | printed | cancelled',
    `customer_name`     VARCHAR(120) NOT NULL,
    `customer_phone`    VARCHAR(32)  NULL,
    `notes`             TEXT         NULL,
    `total`             DECIMAL(10,2) NOT NULL,
    `claimed_by_device` CHAR(36)     NULL,
    `claimed_at`        DATETIME     NULL,
    `printed_at`        DATETIME     NULL,
    `ticket_id`         CHAR(36)     NULL COMMENT 'Ticket local que lo materializó',
    `created_at`        DATETIME     NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_web_orders_request` (`client_request_id`),
    INDEX `idx_web_orders_pending` (`status`, `created_at`)
) ENGINE=InnoDB ...;

CREATE TABLE `web_order_items` (
    `id`, `web_order_id` (FK), `product_id`, `product_name`, `qty`,
    `unit_price`, `modifier_price_add`, `selected_modifiers` (JSON), `custom_label`
);

ALTER TABLE `sessions` ADD COLUMN `last_seen_at` DATETIME NULL;
```

`client_request_id` con `UNIQUE` evita el duplicado clásico: el cliente pulsa "Enviar"
dos veces, o la respuesta se pierde y el navegador reintenta. El segundo `INSERT` choca
y se devuelve el pedido ya creado, no uno nuevo.

`web_order_items` como tabla hija (no JSON) para poder agregar ventas por producto en la
web de inventario de Fase 2.

### 1.2 App — migración SQLite v30

`tickets` gana:
- `source` TEXT NOT NULL DEFAULT `'local'` — `'local' | 'web'`
- `web_order_id` TEXT NULL

Backfill: todo lo existente a `'local'`. Sirve para marcar la comanda impresa, filtrar la
bandeja y evitar reprocesar.

---

## 2. Endpoints

### 2.1 Públicos (sin API key, rate-limit por IP)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/v1/web/status` | `{ open, locationName, closingSoon }`. `open` = sesión `open` **y** `last_seen_at` < 60 s |
| `GET` | `/api/v1/web/menu` | Catálogo público (reusa el catálogo TPV: **mismos `productId`**) |
| `POST` | `/api/v1/web/orders` | Crea el pedido. Revalida el estado |

`POST /web/orders` revalida **siempre** que el servicio siga abierto. Si no:
`409 { error: { code: 'SERVICE_CLOSED' } }` → la web muestra *"El servicio ha cerrado,
acércate en persona"*. Es la carrera que pediste cubrir: la sesión se cierra mientras el
cliente está montando el carrito.

También revalida precios contra el catálogo — **nunca** confiar en el total que manda el
navegador.

Rate limit: sin Redis en compartido, basta una tabla `web_rate_limit (ip, window, count)`
o APCu. N pedidos/IP/hora.

### 2.2 TPV (dentro del grupo `/tpv/*` existente)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/tpv/web-orders/pending?since=` | Pendientes + refresca `last_seen_at` (heartbeat) |
| `POST` | `/tpv/web-orders/{id}/claim` | `{ deviceId }` → 200 con el pedido completo, o **409** si otro se lo quedó |
| `POST` | `/tpv/web-orders/{id}/ack` | `{ ticketId, printed }` → `status='printed'` |
| `POST` | `/tpv/web-orders/{id}/cancel` | Anular tras imprimir (el cliente no aparece, etc.) |

---

## 3. Idempotencia — lo que realmente rompe esto

Cuatro puntos, por orden de gravedad:

**3.1 Claim atómico.** Con dos TPV en la misma sesión, ambos ven el mismo pedido en su
tick y ambos lo imprimen. Se resuelve en SQL, no en la app:

```sql
UPDATE web_orders
   SET status='claimed', claimed_by_device=?, claimed_at=NOW()
 WHERE id=? AND status='pending'
```

`rowCount = 0` → 409, otro dispositivo ganó. **Solo se imprime tras un claim con éxito.**

**3.2 Claim caducado.** El TPV hace claim y la app muere antes de imprimir → el pedido
queda en `claimed` para siempre y nadie lo cocina. Un pedido con `claimed_at` > 2 min y
`printed_at IS NULL` vuelve a `pending` (comprobación perezosa en el propio `GET /pending`,
sin cron — no hay SSH).

**3.3 Fallo de impresora.** El Bluetooth se cae a mitad. El `Ticket` se guarda igual con
`printedAt = null` y aparece en la bandeja con botón *Reimprimir*. El ACK se manda con
`printed: false`. Nunca se pierde un pedido por un socket colgado — ver el manejo de
`PrintCancelledError` en [printer.ts](tpv/services/printer.ts).

**3.4 Modo prueba.** El poller **no debe hacer claim de nada** con modo prueba activo. Si
no, una tablet "de pruebas" roba pedidos reales y los imprime marcados como no válidos.

---

## 4. Flujo en la app

```
[poller cada 3 s]  ← solo si: sesión abierta + app en foreground + NO modo prueba
      |
      v
GET /tpv/web-orders/pending   (y de paso, heartbeat)
      |  hay pedidos
      v
POST /{id}/claim  --409-->  otro TPV lo cogió → ignorar
      |  200
      v
Crear Ticket + Order locales (ticketNumber correlativo del dispositivo,
                              source='web', priceProfile='normal')
      |
      v
Sonido + banner "PEDIDO WEB de [nombre]"
      |
      v
printTicket()  --error-->  printedAt=null, entra en la bandeja
      |  ok
      v
POST /{id}/ack  → status='printed'
```

Piezas nuevas:
- `services/webOrdersApi.ts` — `fetchPending` / `claim` / `ack` / `cancel`, con la
  convención de `services/`: **nunca lanza**, devuelve `{ ok, error? }`.
- Poller ligado al ciclo de vida de la sesión + `AppState`. Backoff a 10 s tras 3 fallos
  de red seguidos, vuelta a 3 s al primer éxito.
- Bandeja de pedidos web (pendientes de imprimir / recién entrados) en `session.tsx`.
- `expo-keep-awake` en la pantalla principal: si la tablet se duerme, deja de sonar.
- Aviso sonoro + `Vibration`. Un banner silencioso pasa desapercibido en cocina.

En el ESC/POS ([escpos.ts](tpv/services/escpos.ts)), cabecera distinta para `source='web'`:
`*** PEDIDO WEB ***` + nombre y teléfono del cliente, para que en cocina se distinga de
una comanda de mostrador.

---

## 5. Web de cliente

**IMPLEMENTADO (2026-07-23)**: ruta `/vip` dentro del admin SPA
(`C:\dev\burger-beats-admin`), **pública** — fuera de `ProtectedRoute`, igual que
`/login`, y **sin `Shell`** (nada de sidebar ni bottom nav: es pantalla de cliente).

```
src/lib/webOrdersApi.ts          getWebStatus / getWebMenu / createWebOrder
src/pages/vip/VipPage.tsx        orquesta carta → carrito → datos → confirmación
src/pages/vip/useVipCart.ts      carrito (líneas por producto + modifiers)
src/pages/vip/ProductSheet.tsx   elección de modifiers (remove/add/radio)
src/pages/vip/CartSheet.tsx      repaso del pedido
src/pages/vip/CheckoutSheet.tsx  nombre, teléfono y comentario para cocina
```

Móvil-first (objetivos táctiles de 48 px+), TanStack Query para los datos, React Hook
Form + Zod para el formulario — las convenciones del proyecto admin.

Decisiones:

- **Los importes que pinta la web son orientativos.** El precio y el descuento los
  recalcula el backend contra el catálogo; el total real aparece en la confirmación.
  Es lo que permite que el precio feriante no viaje nunca al navegador.
- **Un grupo `radio` puede quedarse sin elegir**: la comanda imprime entonces su
  `noSelectionLabel` ("Sin salsa"), igual que el TPV en mostrador. Volver a pulsar la
  opción marcada la deselecciona.
- **El producto `OTROS` (isCustom) no sale en la carta**: es de uso interno, con
  nombre y precio libres.
- **`/web/status` se refresca cada 20 s** y el envío puede fallar con `SERVICE_CLOSED`
  → "El servicio ha cerrado mientras hacías el pedido. Acércate en persona."

**Despliegue**: nada especial. En producción `VITE_API_BASE_URL=/api/v1` (same-origin,
sin CORS) y el `.htaccess` ya hace SPA fallback, así que `/vip` aguanta una recarga.

Verificado en `tests/Integration/vip-web-e2e.mjs` (23/23): flujo completo con los
mismos payloads que genera la web, incluidos modifiers radio, código de descuento,
reintento con el mismo `clientRequestId` y cierre de la jornada a media compra.

- Consume `GET /web/status` al entrar **y en un intervalo**. Si `open === false`, pantalla
  "Cerrado ahora mismo" y no se puede añadir nada al carrito.
- `GET /web/menu` reusa el catálogo TPV, con los **mismos `productId`** que ya comparten
  app y backend, así el pedido entra al TPV sin traducción de ids.
- Los modifiers (`remove`/`add`/`radio`) se renderizan desde el catálogo: hay que respetar
  que `radio` exige exactamente una opción.
- Genera y persiste `client_request_id` antes de enviar (idempotencia del 3.1).
- Sin pasarela de pago en esta fase: **pago al recoger**.

### 5.1 Código promocional oculto en el comentario

**IMPLEMENTADO (2026-07-23)**. El cliente escribe el código dentro del comentario
para cocina. Dos códigos, **acumulables** en el mismo pedido:

| Código | Tipo | Efecto |
|---|---|---|
| `FERIANTE` | `price_profile` | Cotiza todas las líneas con `products.feriante_price` |
| `BESITOS` | `fixed` | Resta 12 € del total |

Ambos son **editables desde el admin** (`/api/v1/admin/promo-codes`): texto, importe,
activo sí/no, caducidad y máximo de usos. Un código escondido en un campo de texto
libre acaba circulando por grupos de WhatsApp, y ese día hay que poder apagarlo sin
volver a desplegar.

### Por qué los dos tipos se tratan distinto

- **`FERIANTE` no descuadra nada.** Cada línea sale ya rebajada, así que los items
  suman exactamente el total. Y la impresión ya estaba hecha: `escpos.ts` lleva desde
  siempre el precio original por línea, la resta por producto y `TOTAL CON DTO`.
- **`BESITOS` sí descuadra**, y por eso necesita tratamiento aparte: 12 € sobre el
  total dejan los productos sumando más que lo cobrado. Se guarda en
  `orders.discount_amount` (migración SQLite v31) y se imprime como línea de resta.
  Sin ella, el ticket parecería mal calculado.

Ticket real con los dos códigos (2 × ALITAS, normal 8 €, feriante 6 €):

```
TOTAL----------------------16.00
DESCUENTO..................-4.00      ← perfil feriante, por línea
DESCUENTO BESITOS.........-12.00      ← importe fijo
TOTAL CON DTO---------------0.00      ← = orders.total, lo que suma la caja
```

### Detalles que importan

- **Todo se calcula en el servidor.** El navegador manda texto libre; los precios,
  el perfil y el descuento salen del catálogo y de `web_promo_codes`.
- **El precio feriante nunca sale del backend.** `GET /web/menu` solo expone
  `basePrice`, así que el cliente no puede ver ni forzar el precio rebajado.
- **El código se borra del comentario** antes de guardarlo: llega a cocina la nota
  del cliente, no el código.
- **Coincidencia por palabra completa**, sin distinguir mayúsculas: `besitos` cuenta,
  `BESITOSO` no.
- **Un código por tipo.** Dos descuentos fijos a la vez se acumularían sin control.
- **El total nunca baja de 0**: el descuento fijo se limita al importe del pedido.
- **Producto sin `feriante_price`** (5 de 14 hoy) se cobra a precio normal: mejor no
  descontar que regalarlo por un hueco en la ficha.

Verificado en `tests/Integration/web-promo-codes.mjs` (26/26) y
`tpv/scripts/check-ticket-totals.ts` (8/8, renderiza el ESC/POS y comprueba que el
total impreso es el que cobra la caja).

---

## 6. Fases

| Fase | Alcance | Entregable |
|---|---|---|
| **0** ✅ | Migración 035 + contrato de endpoints | SQL aplicado en `burger_beats_local` |
| **1** ✅ | Backend: `WebOrderController` + repos + claim atómico + rate limit | 25/25 en `tests/Integration/web-orders.sh` |
| **2** ✅ | App: mig. v30, `webOrdersApi`, poller, auto-print, bandeja, aviso | 7/7 en `web-orders-poller-sim.mjs`; falta prueba con impresora real |
| **3** ✅ | Web de cliente en `/vip` | 23/23 en `vip-web-e2e.mjs`; falta revisión visual en móvil |
| **4** | *(opcional)* Expo Push como timbre → latencia <1 s | `POST` plano a `exp.host`, sin JWT |
| **5** | Deploy: migraciones 035 y 036 + backend + web a producción | — |

**Pendiente de UI**: pantalla de gestión de códigos de descuento en el admin. El CRUD
del backend (`/api/v1/admin/promo-codes`) está hecho y probado; hoy los códigos se
editan por API o SQL.

Las fases 0–2 ya dan el sistema funcionando (con curl como "web"). La 3 es la más larga en
volumen de trabajo, pero la de menos riesgo técnico.

---

## 7. Riesgos abiertos

- **La tablet tiene que estar despierta y con la app delante.** Android mata el trabajo en
  background; sin Fase 4 el poller solo corre en foreground. `expo-keep-awake` lo mitiga,
  pero conviene que el TPV esté enchufado. **`expo-keep-awake` no está instalado**: añadirlo
  obliga a recompilar el development build, así que de momento la pantalla se apaga sola
  según los ajustes de Android.
- **El aviso es solo vibración, sin sonido.** `expo-av`/`expo-audio` tampoco están instalados
  y añadirlos exige rebuild. `Vibration` funciona con el binario actual. Si en cocina no
  basta, instalar `expo-audio` y disparar el sonido desde `useWebOrdersStore.pushIncoming`.
- **El modo prueba descrito en CLAUDE.md no existe en el código** (solo el parámetro
  `isTest` de `escpos.ts`, que siempre llega `false`). Por eso el poller no lo comprueba
  antes de reclamar. Si se implementa, hay que añadir la guarda en `pollOnce` —
  si no, una tablet "de pruebas" robaría pedidos reales.
- **El teléfono del cliente no se imprime**: el modelo local (`Order`) no tiene dónde
  guardarlo. Queda en el backend, visible desde el admin. Si hace falta en mano para
  avisar al cliente, requiere un campo nuevo en `orders`.
- **Pedidos broma.** Con auto-impresión, cualquiera que encuentre la URL imprime papel.
  Mitigación de esta fase: rate limit por IP y teléfono obligatorio. Si se convierte en
  problema real, el siguiente paso es SMS/OTP o pago online por adelantado.
- **Sin red en el TPV.** El pedido se queda en el backend en `pending` y entra en cuanto
  vuelva la cobertura; la web sigue aceptando durante los primeros 60 s (hasta que caduca
  el heartbeat). Es el comportamiento correcto para un corte breve.
- **Expo Push (Fase 4)** requiere subir credenciales FCM v1 a EAS una sola vez; el envío
  desde PHP sigue siendo un POST JSON plano, sin OAuth.
