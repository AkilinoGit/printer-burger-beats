# CLAUDE.md — TPV Hamburguesería (React Native + Expo)

## Contexto del proyecto

App móvil TPV (Terminal Punto de Venta) para una hamburguesería. Genera comandas para cocina vía impresora Bluetooth ESC/POS. **No es una app para clientes**, es una herramienta interna de toma de pedidos.

- **Plataforma**: Android (development build propio — no Expo Go)
- **Stack**: React Native + Expo SDK 52, TypeScript estricto
- **BD local**: expo-sqlite (offline-first)
- **Backend**: REST propio (Burger Beats). Producción fija en `https://burguerbeats.com`; servidor local editable en Ajustes para pruebas LAN. La app es offline-first: funciona sin red y sincroniza por entidad cuando hay conexión (ver *Arquitectura offline-first*).
- **Impresión**: conexión Bluetooth directa (Bluetooth Classic/SPP) con `react-native-bluetooth-classic` — la app envía los bytes ESC/POS directamente a la impresora, ver sección impresión
- **Gestión de estado**: Zustand
- **Navegación**: Expo Router (file-based)

---

## Modelo de datos

### Conceptos clave

| Entidad | Significado real |
|---|---|
| `Location` | Lugar físico donde opera el TPV (local, evento, terraza…) |
| `Session` | Jornada del día — siempre asociada a un Location |
| `Ticket` | Comanda de mesa — agrupa 1 o más Orders |
| `Order` | Pedido individual de una persona (con nombre) |
| `OrderItem` | Línea de producto dentro de un Order |
| `Product` | Producto del menú con precio base |
| `Modifier` | Variante de producto ("sin lechuga", "extra queso", selector de salsa…) |

### Tipos TypeScript (fuente de verdad: `lib/types.ts`)

```typescript
type SyncStatus = 'pending' | 'synced' | 'error' | 'pending_update';
type PriceProfile = 'normal' | 'feriante' | 'invitacion';

interface Location {
  id: string;
  name: string;         // "Local principal", "Terraza", "Evento X"…
  isDefault: boolean;
  createdAt: string;
}

interface Session {
  id: string;
  locationId: string;
  date: string;                        // ISO date YYYY-MM-DD
  status: 'open' | 'closed';
  priceOverrides: Record<string, number>; // productId → precio sesión
  createdAt: string;
  sessionCode: string | null;          // "LUN-2806"
  openedAt: string | null;
  autoCloseAt: string | null;          // 12:00 del día siguiente
  closedAt: string | null;
  deviceId: string | null;
}

interface ModifierOption {
  id: string;
  label: string;
}

interface Modifier {
  id: string;
  label: string;
  type: 'remove' | 'add' | 'radio';
  priceAdd?: number;           // coste extra al seleccionar (ej. +1€ bacon)
  options?: ModifierOption[];  // solo para type 'radio' — el usuario elige uno
  noSelectionLabel?: string;   // impreso si no se elige nada (ej. "Sin salsa")
}

interface Product {
  id: string;
  name: string;
  basePrice: number;
  category: 'burger' | 'side' | 'drink' | 'custom';
  modifiers: Modifier[];
  isCustom: boolean;           // true = "OTROS" (precio y nombre libres)
  isActive: boolean;
  alwaysShowModifiers?: boolean; // abre el sheet al pulsar, no solo al mantener
}

interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  productName: string;         // snapshot del nombre en el momento de venta
  qty: number;
  unitPrice: number;           // precio base efectivo (override sesión o basePrice)
  modifierPriceAdd: number;    // suma de priceAdd de los modifiers seleccionados
  selectedModifiers: string[]; // array de Modifier.id / ModifierOption.id
  customLabel: string | null;  // solo si product.isCustom === true
}

interface Order {
  id: string;
  ticketId: string;
  clientName: string;          // OBLIGATORIO — se muestra en ticket cocina
  priceProfile: PriceProfile;  // 'normal' | 'feriante' | 'invitacion'
  items: OrderItem[];
  amountPaid: number | null;
  change: number | null;
  total: number;
  createdAt: string;
}

interface Ticket {
  id: string;
  sessionId: string;
  ticketNumber: number;        // nº correlativo en la sesión
  orders: Order[];
  printedAt: string | null;
  syncStatus: SyncStatus;
  createdAt: string;
  editedAt: string | null;     // null si nunca se editó
  editCount: number;
}
```

---

## Menú y modifiers

El menú está definido en `lib/constants.ts` (INITIAL_PRODUCTS + INITIAL_MODIFIERS).
Los modifiers de tipo `radio` tienen un array `options` — el usuario elige exactamente una opción del grupo.
Los modifiers de tipo `remove`/`add` son checkboxes simples.

Perfiles de precio:
- **normal**: precio base / override de sesión
- **feriante**: precios especiales configurables en Ajustes (DEFAULT_FERIANTE_PRICES en constants.ts)
- **invitacion**: precio 0 — se imprime "INVITACION" en el ticket

---

## Modo prueba

Activable desde Ajustes (toggle). Cuando está activo:

- Banner permanente: **"MODO PRUEBA ACTIVO — nada se guardará"**
- Flujo de venta igual, impresión ESC/POS igual
- El ticket impreso incluye: `*** PRUEBA - NO VALIDO ***`
- **Nada se persiste en SQLite** — ni tickets ni orders
- Se recuerda entre sesiones (AsyncStorage, no SQLite)
- `ticketNumber` no se incrementa

---

## Flujo de venta (CRÍTICO — no cambiar sin revisar este doc)

```
[Pantalla principal]
      |
      v
[Selección de productos]  ← usuario añade items al carrito activo
      |                      puede añadir modifiers (remove/add/radio)
      |                      nombre del cliente OBLIGATORIO antes de continuar
      v
[Revisión del pedido — ticket/[id].tsx]
      |
      +---> [COBRAR]        → modal: input importe pagado → muestra cambio
      |                       NO guarda, NO imprime automáticamente
      |
      +---> [AÑADIR OTRO]   → guarda Order actual en Ticket
      |                       abre nueva selección con nombre vacío
      |                       el Ticket permanece abierto (mismo ticketId)
      |                       persiste en SQLite + intenta sync
      |
      +---> [IMPRIMIR]      → cierra el Ticket
                              genera ESC/POS con TODOS los Orders del Ticket
                              abre conexión Bluetooth directa y envía los bytes
                              persiste en SQLite + intenta sync
```

### Reglas de negocio importantes

1. **Nombre del cliente en cada Order**: si se deja vacío, se autorrellena con un nombre de la *batería de nombres* (entidad `TextPreset` kind `order_name`, modo aleatorio/fijo local). Ver *Text presets*.
2. **Cobrar no imprime ni guarda** — es solo un cálculo de cambio.
3. **Añadir otro e Imprimir siempre persisten** en SQLite.
4. **Un Ticket puede tener N Orders** con nombres distintos (misma mesa).
5. **El ticket de cocina muestra todos los Orders**, cada uno con el nombre del cliente.
6. **Precios por sesión**: override configurable al inicio del día; sin override hereda `basePrice`.
7. Los tickets pueden **editarse** después de imprimir (editedAt, editCount).

---

## Impresión ESC/POS vía Bluetooth directo

**Arquitectura**: la app genera bytes ESC/POS raw y los envía **directamente** a la impresora por Bluetooth Classic (SPP) usando `react-native-bluetooth-classic`. Ya **no se usa RawBT** ni `expo-intent-launcher` — la conexión Bluetooth la gestiona la propia app. La impresora seleccionada (su MAC) se guarda y cachea localmente.

**Sí se necesitan permisos Bluetooth** en la app (Android): `BLUETOOTH_CONNECT` / `BLUETOOTH_SCAN` (Android 12+) y emparejamiento previo de la impresora desde los ajustes del sistema.

### Envío directo (en `services/printer.ts`)

Todo el envío físico pasa por un único `writeBytes(bytes)`:

```typescript
// 1. Recupera la MAC cacheada de la impresora seleccionada (loadCache)
// 2. Abre/reusa la conexión SPP con openConnection(cachedAddress)
// 3. device.write(base64Data, 'base64') — la capa nativa decodifica y emite los bytes
```

`writeBytes` es además el único punto donde se controla el overlay global de impresión
(contador de ms + botón Cancelar), de modo que una conexión colgada se puede abortar
(`PrintCancelledError` / `withCancel`). En cancelación se cierra el socket con `disconnectPrinter()`.

La impresora se selecciona/empareja y se prueba desde Ajustes → Impresora (`printTest()`).

### Generación de bytes (`services/escpos.ts`)

- `buildTicketBuffer(ticket, isTest, modifierLabels, repeatContent, normalPrices)` → `Uint8Array` de bytes ESC/POS reales
- `buildTicketCommands(...)` → string con tags `[B]`/`[C]` (legado, ya no se usa para imprimir)
- Antes de enviarlos, `writeBytes` los convierte a Base64 con `_uint8ArrayToBase64()` (la API nativa los recibe en base64)

### Formato ticket de cocina

```
================================
    COMANDA #[ticketNumber]
    [HH:MM]
================================
--- [clientName Order 1] ---
2x FAT & FURIOUS
   Sin lechuga
   PRECIO: 13.40EUR

--- [clientName Order 2] ---
1x BURGER NIÑO
   PRECIO: 8.00EUR
================================
```

---

## Arquitectura offline-first

### SQLite (expo-sqlite)

Tablas: `locations`, `sessions`, `products`, `modifiers`, `tickets`, `orders`, `order_items`, `text_presets`

> `text_presets` (mig. v29): mensajes del ticket del cliente (kind `ticket_message`, `slot` header/footer) y batería de nombres (kind `order_name`). **Solo el texto se sincroniza**; el `enabled` (cuáles mostrar) y el modo de impresión (fijo/aleatorio) son **locales** de cada dispositivo. Ver `tpv-text-presets-plan.md`.

> Nota histórica: existió una tabla `sync_queue` (cola offline genérica de la Fase 1) que nunca llegó a consumirse. Fue **eliminada en la migración v28** al pasar a un sync por entidad. No la reintroduzcas: cada entidad gestiona su propia sincronización.

### Estrategia de sincronización

El sync ya **no** usa una cola genérica. Cada entidad tiene su módulo API en `services/` y todos se orquestan desde `services/syncAll.ts` (`runFullSync`), disparado por un **único botón** en Ajustes → Sincronización.

Principios:

1. **Escribir primero en local** (SQLite, o AsyncStorage para config/precios pendientes). La UI nunca bloquea esperando red.
2. **Un solo orquestador** (`runFullSync`) ejecuta las tasks **en orden por dependencias (FK)**: precios → productos (catálogo) → locales → sesiones → comandas. Un fallo en una no aborta las demás.
3. **Módulos por entidad**:
   - `pricesApi.ts` — sube ediciones de precio; los cambios offline quedan en una **cola de reintento propia en AsyncStorage** (no en SQLite).
   - `catalogApi.ts` — descarga el catálogo y **reemplaza** la tabla local (con red de seguridad contra borrados: revisión de candidatos, ver plan de productos).
   - `locationsApi.ts` — locales, bidireccional.
   - `sessionsApi.ts` — jornadas; **PUSH primario + Last-Write-Wins**, campo `origin` local/remote.
   - `ticketsApi.ts` — comandas (tickets→orders); numeración por (sesión, dispositivo).
4. **Disparadores**: sync completo manual desde Ajustes; además, las **sesiones** se sincronizan *fire-and-forget* tras sus eventos (abrir/editar/fusionar/cerrar). No hay background sync periódico (el único `setInterval` global es el auto-cierre de sesiones, cada 5 min).
5. **Config de servidor** en `apiConfig.ts`: modo `production` (fijo, `burguerbeats.com`) o `local` (editable en Ajustes). Envoltorio de respuesta `{ ok, data | error }`, `ApiError` tipado, timeout de 6 s.
6. **Sin red o error**: no se muestran errores intrusivos al usuario; se reintenta en la próxima sincronización (fire-and-forget silencioso). Las funciones de `services/` nunca lanzan — devuelven `{ ok, error? }`.

Detalles por entidad en `tpv-products-sync-plan.md`, `tpv-sessions-sync-plan.md` y `tpv-orders-sync-plan.md`.

---

## Estructura de carpetas

```
app/
  (tabs)/
    index.tsx          ← pantalla principal / selección de productos
    session.tsx        ← gestión de sesión del día + historial de tickets
    settings.tsx       ← ajustes, impresora Bluetooth, sync, precios feriante, locales
  ticket/
    [id].tsx           ← revisión/edición de ticket activo
  session/
    [id].tsx           ← detalle de sesión cerrada + reimpresión
  _layout.tsx
components/
  ProductGrid.tsx      ← grid de productos táctil
  CartSummary.tsx      ← resumen del carrito
  ModifierSheet.tsx    ← bottom sheet para modifiers (remove/add/radio)
  PaymentModal.tsx     ← modal cobro + cambio
  TicketPreview.tsx    ← vista previa del ticket antes de imprimir
stores/
  useCartStore.ts      ← Zustand: carrito activo
  useSessionStore.ts   ← Zustand: sesión del día, precios feriante, testMode
  useTicketStore.ts    ← Zustand: ticket activo (múltiples orders)
  useTextPresetsStore.ts ← Zustand: presets de texto (mensajes ticket + batería nombres) + modos locales
services/
  db.ts               ← expo-sqlite: init, migrations, CRUD
  apiConfig.ts        ← cliente HTTP base (modo production/local, apiGet/apiPost, ApiError)
  syncAll.ts          ← orquestador del sync unificado (runFullSync)
  catalogApi.ts       ← descarga/reemplazo del catálogo de productos
  pricesApi.ts        ← push de precios + cola de reintento en AsyncStorage
  locationsApi.ts     ← sync de locales
  sessionsApi.ts      ← sync de sesiones (PUSH primario, LWW)
  textPresetsApi.ts   ← sync de presets de texto (solo el texto; PUSH primario, LWW)
  ticketsApi.ts       ← sync de comandas (tickets→orders)
  printer.ts          ← impresión vía Bluetooth directo (react-native-bluetooth-classic) + diagnóstico
  escpos.ts           ← generación de bytes ESC/POS y string commands (legado)
lib/
  types.ts            ← todos los tipos TypeScript
  constants.ts        ← menú inicial, modifiers, DEFAULT_FERIANTE_PRICES
  utils.ts            ← formatPrice, calcChange, generateId, currentTime, etc.
```

---

## Dependencias clave

```json
{
  "expo": "~52.0.0",
  "expo-sqlite": "~14.0.0",
  "expo-router": "~4.0.0",
  "react-native-bluetooth-classic": "^1.73.0-rc.17",
  "expo-intent-launcher": "~12.0.2 (instalado, ya NO se usa para imprimir)",
  "zustand": "^5.0.12",
  "react-native-paper": "^5.15.0"
}
```

---

## Convenciones de código

- TypeScript estricto (`strict: true`), sin `any`.
- Todos los accesos a BD son async/await con try/catch.
- Los stores de Zustand son la única fuente de verdad en runtime.
- SQLite es la fuente de verdad persistente en el dispositivo.
- Nunca bloquear UI esperando red — todo lo que dependa de red es fire-and-forget silencioso.
- Componentes de UI: `react-native-paper` para consistencia táctil.
- Botones del flujo de venta (COBRAR / AÑADIR OTRO / IMPRIMIR) grandes y visualmente distintos.
- Las funciones públicas de `services/` devuelven tipos resultado `{ ok, error? }` — nunca lanzan.

---

## Lo que NO está implementado aún (Fase 2)

- App web de inventario y gráficas
- Autenticación de usuarios (hoy solo `X-API-Key`, con el middleware del grupo `/tpv/*` desactivado)
- Múltiples impresoras o puntos de venta
- Histórico de ventas en la app móvil (solo en web)
