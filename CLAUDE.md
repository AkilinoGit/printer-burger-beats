# CLAUDE.md — TPV Hamburguesería (React Native + Expo)

## Contexto del proyecto

App móvil TPV (Terminal Punto de Venta) para una hamburguesería. Genera comandas para cocina vía impresora Bluetooth ESC/POS. **No es una app para clientes**, es una herramienta interna de toma de pedidos.

- **Plataforma**: Android primero
- **Stack**: React Native + Expo (SDK 51+), TypeScript estricto
- **BD local**: expo-sqlite (offline-first)
- **Backend**: por definir — la app funciona sin él. El sync queda en cola local hasta que exista API.
- **Impresión**: react-native-thermal-printer (ESC/POS Bluetooth SPP clásico)
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
| `Modifier` | Variante de producto ("sin lechuga", "sin cebolla"…) |

### Tipos TypeScript

```typescript
type SyncStatus = 'pending' | 'synced' | 'error';

interface Location {
  id: string;
  name: string;                        // "Local principal", "Terraza", "Evento X"…
  isDefault: boolean;                  // el dispositivo arranca con este location
  createdAt: string;
}

interface Session {
  id: string;
  locationId: string;                  // FK → Location — OBLIGATORIO
  date: string;                        // ISO date YYYY-MM-DD
  status: 'open' | 'closed';
  priceOverrides: Record<string, number>; // productId -> precio sesión
  createdAt: string;
}

interface Product {
  id: string;
  name: string;
  basePrice: number;                   // precio por defecto
  category: 'burger' | 'side' | 'drink' | 'custom';
  modifiers: Modifier[];               // solo burgers tienen modifiers
  isCustom: boolean;                   // true = "OTROS" (precio y nombre libres)
  isActive: boolean;
}

interface Modifier {
  id: string;
  label: string;                       // "Sin lechuga", "Sin cebolla", "Extra queso"…
  type: 'remove' | 'add';
}

interface Ticket {
  id: string;
  sessionId: string;
  ticketNumber: number;                // nº correlativo en la sesión
  orders: Order[];
  printedAt: string | null;
  syncStatus: SyncStatus;
  createdAt: string;
}

interface Order {
  id: string;
  ticketId: string;
  clientName: string;                  // OBLIGATORIO — se muestra en ticket cocina
  items: OrderItem[];
  amountPaid: number | null;           // null si no se ha cobrado aún
  change: number | null;
  total: number;
  createdAt: string;
}

interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  productName: string;                 // snapshot del nombre en el momento de venta
  qty: number;
  unitPrice: number;                   // precio efectivo (sesión override o base)
  selectedModifiers: string[];         // array de Modifier.id
  customLabel: string | null;          // solo si product.isCustom === true
}
```

---

## Menú inicial (seed data)

```typescript
const INITIAL_PRODUCTS: Product[] = [
  { id: 'fat-furious',      name: 'FAT & FURIOUS',     basePrice: 13.40, category: 'burger', modifiers: [], isCustom: false, isActive: true },
  { id: 'ben-muerde',       name: 'BEN Y MUERDE',      basePrice: 12.50, category: 'burger', modifiers: [], isCustom: false, isActive: true },
  { id: 'doble-subwoofer',  name: 'DOBLE SUBWOOFER',   basePrice: 11.00, category: 'burger', modifiers: [], isCustom: false, isActive: true },
  { id: 'burger-nino',      name: 'BURGER NIÑO',        basePrice:  8.00, category: 'burger', modifiers: [], isCustom: false, isActive: true },
  { id: 'tekenos',          name: 'TEKEÑOS',            basePrice:  8.00, category: 'side',   modifiers: [], isCustom: false, isActive: true },
  { id: 'alitas',           name: 'ALITAS',             basePrice:  8.00, category: 'side',   modifiers: [], isCustom: false, isActive: true },
  { id: 'gyozas',           name: 'GYOZAS',             basePrice:  8.00, category: 'side',   modifiers: [], isCustom: false, isActive: true },
  { id: 'patatas',          name: 'PATATAS',            basePrice:  6.00, category: 'side',   modifiers: [], isCustom: false, isActive: true },
  { id: 'bebida',           name: 'BEBIDA',             basePrice:  2.00, category: 'drink',  modifiers: [], isCustom: false, isActive: true },
  { id: 'agua',             name: 'AGUA',               basePrice:  1.00, category: 'drink',  modifiers: [], isCustom: false, isActive: true },
  { id: 'otros',            name: 'OTROS',              basePrice:  0.00, category: 'custom', modifiers: [], isCustom: true,  isActive: true },
];

const INITIAL_MODIFIERS: Modifier[] = [
  { id: 'sin-lechuga',  label: 'Sin lechuga',  type: 'remove' },
  { id: 'sin-cebolla',  label: 'Sin cebolla',  type: 'remove' },
  { id: 'sin-tomate',   label: 'Sin tomate',   type: 'remove' },
  { id: 'sin-pepinillo',label: 'Sin pepinillo', type: 'remove' },
  { id: 'sin-bacon',    label: 'Sin bacon',    type: 'remove' },
  { id: 'extra-queso',  label: 'Extra queso',  type: 'add'    },
];
// Asignar modifiers a burgers al hacer seed
```

---

## Modo prueba

La app tiene un **modo prueba** activable desde ajustes (toggle visible y claramente identificado). Cuando está activo:

- Se muestra un banner permanente en la UI: **"MODO PRUEBA — nada se guardará"**
- El flujo de venta funciona exactamente igual (selección, cobro, variantes, añadir otro)
- La impresión ESC/POS funciona igual — el ticket llega físicamente a la impresora
- El ticket impreso incluye una línea visible: `*** PRUEBA — NO VÁLIDO ***`
- **Nada se persiste en SQLite** — ni tickets, ni orders, ni sync_queue
- El modo prueba se recuerda entre sesiones (guardado en AsyncStorage, no en SQLite)
- No cuenta en el número correlativo de tickets (`ticketNumber` no se incrementa)

---

## Flujo de venta (CRÍTICO — no cambiar sin revisar este doc)

```
[Pantalla principal]
      |
      v
[Selección de productos]  ← usuario añade items al carrito activo
      |                      puede añadir variantes a burgers
      |                      introduce nombre del cliente (OBLIGATORIO antes de continuar)
      v
[Revisión del pedido]
      |
      +---> [COBRAR]        → modal: input importe pagado → muestra cambio
      |                       NO guarda, NO imprime automáticamente
      |
      +---> [AÑADIR OTRO]   → guarda Order actual en Ticket
      |                       abre nueva pantalla de selección con nombre vacío
      |                       el Ticket permanece abierto (mismo ticketId)
      |                       implícito: persiste en SQLite + intenta sync
      |
      +---> [IMPRIMIR]      → cierra el Ticket
                              genera ESC/POS con TODOS los Orders del Ticket
                              envía a impresora BT
                              implícito: persiste en SQLite + intenta sync
```

### Reglas de negocio importantes

1. **Nombre del cliente es obligatorio** en cada Order antes de proceder.
2. **Cobrar no imprime ni guarda** — es solo un cálculo de cambio.
3. **Añadir otro e Imprimir siempre persisten** en SQLite, independientemente de si se ha cobrado.
4. **Un Ticket puede tener N Orders** con nombres distintos (misma mesa).
5. **El ticket de cocina muestra todos los Orders agrupados**, cada uno con el nombre de su cliente.
6. **Precios por sesión**: al inicio del día se puede hacer override de cualquier precio; los no modificados heredan `basePrice`.

---

## Formato ticket de cocina (ESC/POS)

```
================================
    COMANDA #[ticketNumber]
    [HH:MM]
================================
--- [clientName Order 1] ---
2x FAT & FURIOUS
   Sin lechuga · Sin cebolla
1x PATATAS
1x BEBIDA

--- [clientName Order 2] ---
1x BURGER NIÑO
1x AGUA
================================
```

**Reglas de impresión:**
- Fuente grande para nombre del cliente (ESC/POS emphasis ON)
- Sin precios en el ticket de cocina
- Separador visual entre Orders
- Número de ticket correlativo por sesión

---

## Arquitectura offline-first

### SQLite (expo-sqlite)

Tablas: `locations`, `sessions`, `products`, `modifiers`, `tickets`, `orders`, `order_items`, `sync_queue`

**Seed de locations:** al inicializar la app por primera vez se crea un location por defecto ("Local principal"). El usuario puede añadir más desde ajustes. El `locationId` activo se guarda en `useSessionStore` y se selecciona al abrir cada sesión del día.

La tabla `sync_queue` almacena los IDs de entidades pendientes de sync:
```sql
CREATE TABLE sync_queue (
  id TEXT PRIMARY KEY,
  entity_type TEXT,  -- 'order' | 'ticket'
  entity_id TEXT,
  status TEXT,       -- 'pending' | 'synced' | 'error'
  attempts INTEGER DEFAULT 0,
  created_at TEXT
);
```

### Estrategia de sincronización

1. **Siempre escribir en SQLite primero** (nunca esperar red).
2. **Tras escribir**, intentar sync inmediato si hay red Y hay API configurada.
3. **Si no hay API o falla** → queda en `sync_queue` con status `pending`.
4. **Background sync** cada 2 minutos si hay red y hay pendientes.
5. **Sync manual** desde pantalla de ajustes (botón "Sincronizar ahora").
6. **Al abrir la app**, intentar sync de todo lo pendiente.
7. **Sin API configurada**: todo queda en `pending` indefinidamente, sin errores para el usuario. La app funciona igual.

---

## Estructura de carpetas

```
app/
  (tabs)/
    index.tsx          ← pantalla principal / selección productos
    session.tsx        ← gestión de sesión del día
    settings.tsx       ← ajustes, sync manual, precios
  ticket/
    [id].tsx           ← revisión de ticket activo
  _layout.tsx
components/
  ProductGrid.tsx      ← grid de productos táctil
  CartSummary.tsx      ← resumen del carrito
  ModifierSheet.tsx    ← bottom sheet para variantes
  PaymentModal.tsx     ← modal cobro + cambio
  TicketPreview.tsx    ← vista previa del ticket antes de imprimir
stores/
  useCartStore.ts      ← Zustand: carrito activo
  useSessionStore.ts   ← Zustand: sesión del día y precios
  useTicketStore.ts    ← Zustand: ticket activo (múltiples orders)
services/
  db.ts               ← expo-sqlite: init, migrations, CRUD
  sync.ts             ← lógica de sync (preparada para API futura)
  printer.ts          ← ESC/POS: conexión BT, formato, impresión
  escpos.ts           ← helpers de formato ESC/POS
lib/
  types.ts            ← todos los tipos TypeScript (ver arriba)
  constants.ts        ← menú inicial, modifiers
  utils.ts            ← formatPrice, calcChange, etc.
```

---

## Dependencias clave

```json
{
  "expo": "~51.0.0",
  "expo-sqlite": "^14.0.0",
  "expo-router": "~3.5.0",
  "zustand": "^4.5.0",
  "react-native-thermal-printer": "^2.2.0",
  "react-native-paper": "^5.12.0"
}
```

---

## Convenciones de código

- TypeScript estricto (`strict: true`), sin `any`.
- Todos los accesos a BD son async/await con try/catch.
- Los stores de Zustand son la única fuente de verdad en runtime.
- SQLite es la fuente de verdad persistente en el dispositivo.
- Nunca bloquear UI esperando red — todo lo que dependa de red es fire-and-forget con manejo de error silencioso (se encola).
- Componentes de UI: `react-native-paper` para consistencia táctil.
- Botones del flujo de venta (COBRAR / AÑADIR OTRO / IMPRIMIR) deben ser grandes y claramente distintos visualmente.

---

## Lo que NO está implementado aún (Fase 2)

- API REST propia (backend por decidir: PHP/Slim, Node, etc.)
- App web de inventario y gráficas
- Autenticación de usuarios
- Múltiples impresoras o puntos de venta
- Histórico de ventas en la app móvil (solo en web)
