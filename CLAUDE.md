# CLAUDE.md — TPV Hamburguesería (React Native + Expo)

## Contexto del proyecto

App móvil TPV (Terminal Punto de Venta) para una hamburguesería. Genera comandas para cocina vía impresora Bluetooth ESC/POS. **No es una app para clientes**, es una herramienta interna de toma de pedidos.

- **Plataforma**: Android (development build propio — no Expo Go)
- **Stack**: React Native + Expo SDK 52, TypeScript estricto
- **BD local**: expo-sqlite (offline-first)
- **Backend**: por definir — la app funciona sin él. El sync queda en cola local hasta que exista API.
- **Impresión**: RawBT vía Android Intents (`expo-intent-launcher`) — ver sección impresión
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
- **Nada se persiste en SQLite** — ni tickets, ni orders, ni sync_queue
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
                              envía a RawBT vía Intent
                              persiste en SQLite + intenta sync
```

### Reglas de negocio importantes

1. **Nombre del cliente obligatorio** en cada Order.
2. **Cobrar no imprime ni guarda** — es solo un cálculo de cambio.
3. **Añadir otro e Imprimir siempre persisten** en SQLite.
4. **Un Ticket puede tener N Orders** con nombres distintos (misma mesa).
5. **El ticket de cocina muestra todos los Orders**, cada uno con el nombre del cliente.
6. **Precios por sesión**: override configurable al inicio del día; sin override hereda `basePrice`.
7. Los tickets pueden **editarse** después de imprimir (editedAt, editCount).

---

## Impresión ESC/POS vía RawBT

**Arquitectura**: la app genera bytes ESC/POS raw, los codifica en Base64 y los envía a la app RawBT instalada en Android mediante `expo-intent-launcher`. RawBT gestiona la conexión Bluetooth con la impresora.

**No se necesitan permisos Bluetooth** en la app — RawBT los gestiona por su cuenta.

### Método de Intent activo (en `services/printer.ts`)

```typescript
// Método principal (printTicket usa este):
await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
  data: 'rawbt:base64,' + base64Data,
  packageName: 'ru.a402d.rawbtprinter',
});
```

Hay un segundo método de diagnóstico (`diagMethod2`) con intent: URI scheme como fallback.
Ambos son testables desde Ajustes con el botón "Test Intent (diagnóstico)".

### Generación de bytes (`services/escpos.ts`)

- `buildTicketBuffer(ticket, isTest, modifierLabels)` → `Uint8Array` de bytes ESC/POS reales
- `buildTicketCommands(...)` → string con tags `[B]`/`[C]` (legado, ya no se usa para imprimir)
- Los bytes se convierten a Base64 en `printer.ts` con `_uint8ArrayToBase64()`

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

Tablas: `locations`, `sessions`, `products`, `modifiers`, `tickets`, `orders`, `order_items`, `sync_queue`

La tabla `sync_queue` almacena entidades pendientes:
```sql
CREATE TABLE sync_queue (
  id TEXT PRIMARY KEY,
  entity_type TEXT,   -- 'order' | 'ticket'
  entity_id TEXT,
  action TEXT,        -- 'create' | 'update'
  status TEXT,        -- 'pending' | 'synced' | 'error'
  attempts INTEGER DEFAULT 0,
  created_at TEXT
);
```

### Estrategia de sincronización

1. Siempre escribir en SQLite primero.
2. Tras escribir, intentar sync inmediato si hay red y API configurada.
3. Sin API o si falla → queda en `sync_queue` con `pending`.
4. Background sync cada 2 minutos.
5. Sync manual desde Ajustes.
6. Sin API configurada: todo permanece en `pending`, sin errores para el usuario.

---

## Estructura de carpetas

```
app/
  (tabs)/
    index.tsx          ← pantalla principal / selección de productos
    session.tsx        ← gestión de sesión del día + historial de tickets
    settings.tsx       ← ajustes, impresora RawBT, sync, precios feriante, locales
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
services/
  db.ts               ← expo-sqlite: init, migrations, CRUD
  sync.ts             ← lógica de sync (preparada para API futura)
  printer.ts          ← impresión vía RawBT Intent + funciones de diagnóstico
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
  "expo-intent-launcher": "~12.0.2",
  "zustand": "^5.0.12",
  "react-native-thermal-printer": "(instalado pero sin usar — reservado)",
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

- API REST propia (backend por decidir: PHP/Slim, Node, etc.)
- App web de inventario y gráficas
- Autenticación de usuarios
- Múltiples impresoras o puntos de venta
- Histórico de ventas en la app móvil (solo en web)
