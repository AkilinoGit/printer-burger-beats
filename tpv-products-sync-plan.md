# Paso 1 de backend — Actualizar productos desde el servidor

> **Objetivo**: que el catálogo de productos (y sus modifiers) de la pantalla de venta
> se pueda **actualizar desde el backend** pulsando un botón en Ajustes.
> Si no hay conexión, la app sigue usando **los últimos productos guardados** en SQLite.
> Es un paso **de solo lectura**: NO toca el flujo de venta, ni la cola de sync de pedidos.
>
> Este documento se apoya en el contrato general ya definido en
> `tpv-backend-integration-plan.md` (envoltorio `{ok,data|error}`, headers, base URL,
> `X-API-Key`, DECIMAL-como-string, etc.). Aquí solo se añade lo específico de productos.

---

## 0. Principio de diseño

- **SQLite es la fuente de verdad en runtime.** La app siempre lee productos de SQLite
  (como hoy). El backend solo cambia **cómo se rellena** esa tabla.
- Hoy los productos se siembran desde `lib/constants.ts` (`INITIAL_PRODUCTS`). Tras este
  paso, ese seed pasa a ser solo el **fallback inicial** (primera instalación / sin red
  nunca). El catálogo "vivo" lo manda el backend.
- **Actualizar es explícito**: el operario pulsa "Actualizar productos" en Ajustes.
  (Opcional, fase posterior: refrescar también al abrir la app si hay red.)
- **Reemplazo total, no merge**: al actualizar, se descarga el catálogo completo y se
  **reemplaza** `products` + `modifiers` en una transacción. Es lo más simple y robusto, y
  el catálogo es pequeño (~13 productos). Sin diffs ni borrados parciales.
- **Fallo de red = no pasa nada**: si la descarga falla, se deja la tabla intacta y se
  avisa al usuario ("Sin conexión, se mantienen los productos actuales").

---

## 1. LO QUE NECESITA EL BACKEND

### 1.1 Nuevo endpoint: `GET /api/v1/tpv/products`

Devuelve el catálogo completo de productos activos con sus modifiers anidados.

- **Auth / headers**: igual que el resto de `/tpv/*` (envía `X-API-Key`; hoy sin middleware).
- **Sin parámetros** (de momento). Devuelve todo lo que la TPV debe mostrar.

**Respuesta 200:**

```json
{
  "ok": true,
  "data": {
    "version": "2026-06-17T10:00:00Z",
    "products": [
      {
        "id": "fat-furious",
        "name": "FAT & FURIOUS",
        "basePrice": 13.40,
        "category": "burger",
        "isCustom": false,
        "isActive": true,
        "alwaysShowModifiers": false,
        "sortOrder": 1,
        "modifiers": [
          {
            "id": "mod_sin_gluten",
            "label": "Sin Gluten",
            "type": "remove",
            "priceAdd": 0,
            "section": "otros",
            "sortOrder": 1,
            "noSelectionLabel": null,
            "options": []
          },
          {
            "id": "nino-salsa",
            "label": "Salsa",
            "type": "radio",
            "priceAdd": 0,
            "section": "queso-salsa",
            "sortOrder": 10,
            "noSelectionLabel": "Sin salsa",
            "options": [
              { "id": "salsa-ketchup", "label": "Ketchup" },
              { "id": "salsa-bbq",     "label": "BBQ" }
            ]
          }
        ]
      }
    ]
  }
}
```

### 1.2 Reglas de los campos (IMPORTANTE para que la app no rompa)

| Campo | Tipo JSON | Notas |
|---|---|---|
| `version` | string ISO-8601 UTC | timestamp del último cambio del catálogo. La app lo guarda para mostrar "actualizado el …" y, en el futuro, para evitar descargas innecesarias. |
| `products[].id` | string | **estable y único**. La app lo usa como PK y para casar `order_items.product_id`. **No cambiar ids de productos existentes** o se rompe el histórico. Reusar los ids actuales (`fat-furious`, `patatas`, `gyozas-pollo`, `otros`…). |
| `products[].name` | string | nombre visible. |
| `products[].basePrice` | number **o** string | precio base en euros. Si el backend serializa DECIMAL como string (ver plan general §3.2), la app hará `parseFloat`. Acepta ambos. |
| `products[].category` | string | enum: `burger \| side \| drink \| custom`. |
| `products[].isCustom` | boolean | `true` para "OTROS" (precio y nombre libres). |
| `products[].isActive` | boolean | si `false`, la app puede recibirlo igualmente; **el backend debería devolver solo activos**, pero la app filtra por `isActive` de todos modos. |
| `products[].alwaysShowModifiers` | boolean | abre el sheet al pulsar (no solo al mantener). |
| `products[].sortOrder` | integer | **orden de aparición en el grid**. Hoy el orden depende del `rowid` de inserción; con el backend el orden lo manda este campo. La app insertará respetándolo. |
| `modifiers[].id` | string | único **dentro del producto**. Ver nota de ids compartidos abajo. |
| `modifiers[].label` | string | texto visible. |
| `modifiers[].type` | string | enum: `remove \| add \| radio`. |
| `modifiers[].priceAdd` | number/string | coste extra (puede ser negativo, ej. "Sin una carne" = -1.50). Default 0. |
| `modifiers[].section` | string \| null | enum visual: `verdura \| queso-salsa \| carne \| extra \| otros` (o null). |
| `modifiers[].sortOrder` | integer | orden dentro de su sección. |
| `modifiers[].noSelectionLabel` | string \| null | solo `radio`: texto si no se elige nada (ej. "Sin salsa"). |
| `modifiers[].options` | array | solo `radio`: `[{ "id": string, "label": string }]`. Para `add`/`remove` → `[]`. |

**Nota sobre ids de modifiers (clave para no romper la BD local):**
Hoy la app guarda cada modifier con id **scopeado al producto**: `"{productId}-{modifierId}"`
(ver `db.ts`, p.ej. `fat-furious-sin-queso`). El mismo modifier lógico (`sin-queso`) se
repite en varios productos. **Decisión recomendada**: el backend devuelve el id "lógico"
del modifier (`sin-queso`, `nino-salsa`, etc.) **dentro de cada producto**, y es la **app**
quien construye el id scopeado al insertar (`{productId}-{modifier.id}`), igual que hace
hoy con `INITIAL_MODIFIERS`. Así no cambia nada del resto de la app (ESC/POS, etiquetas,
`order_items.selected_modifiers`). El backend no necesita conocer el scoping.

→ Es decir: en el JSON, `modifiers[].id` y `options[].id` son los ids **lógicos** que ya
usa `lib/constants.ts` (`sin-queso`, `salsa-ketchup`, `extra-bacon`…). Mantenerlos
idénticos a los actuales para que las comandas ya impresas/guardadas sigan resolviéndose.

### 1.3 Errores

- Estándar del plan general: `{ "ok": false, "error": { "code": "SERVER_ERROR", "message": "…" } }`.
- La app trata **cualquier** fallo (red, 4xx, 5xx, JSON inválido) igual: **no toca SQLite**
  y muestra "No se pudo actualizar, se mantienen los productos actuales".

### 1.4 Modelo de datos sugerido en el backend

El backend ya tendrá tablas para gestionar el menú desde la web de inventario (fase 2).
Mínimo necesario para servir este endpoint:

- `products(id, name, base_price, category, is_custom, is_active, always_show_modifiers, sort_order, updated_at)`
- `modifiers(id, product_id, label, type, price_add, section, sort_order, no_selection_label, options_json, updated_at)`
  - o una relación N:M si un modifier se comparte entre productos; pero servir el JSON
    **anidado y desnormalizado** (como arriba) es lo que la TPV consume.
- `version` = `MAX(updated_at)` de ambas tablas, o un registro de catálogo con su propio
  timestamp.

### 1.5 (Opcional, fase posterior) descarga condicional

Para no descargar si nada cambió:
- App envía `If-Modified-Since` o `?since=<version>`.
- Backend responde **304 Not Modified** (sin cuerpo) si el catálogo no cambió desde esa
  versión. La app entonces no toca nada y dice "Ya estás al día".
- **No es necesario para el primer paso.** Anótalo como mejora.

---

## 2. LO QUE NECESITA LA APP (TPV)

Cambios mínimos, todos aislados. Orden sugerido:

### 2.1 Config del cliente (nuevo `services/apiConfig.ts`)

- `API_BASE_URL` configurable (hoy es `null` en `services/sync.ts`). Centralizarlo aquí.
- `X-API-Key` desde almacenamiento seguro (puede quedar como TODO en este paso, ya que el
  middleware del backend aún no exige la key — ver plan general §1.3).
- Un helper `apiGet(path)` que: añade headers, hace `fetch`, parsea el envoltorio
  `{ok,data|error}` y lanza `ApiError` tipado. (Es la base que el plan general llama
  "Fase 0", pero aquí basta con la parte GET.)

### 2.2 Tipos de respuesta (`lib/types.ts` o nuevo `services/catalogApi.ts`)

```typescript
interface ApiModifierOption { id: string; label: string }

interface ApiModifier {
  id: string;
  label: string;
  type: 'remove' | 'add' | 'radio';
  priceAdd?: number | string;
  section?: string | null;
  sortOrder?: number;
  noSelectionLabel?: string | null;
  options?: ApiModifierOption[];
}

interface ApiProduct {
  id: string;
  name: string;
  basePrice: number | string;
  category: 'burger' | 'side' | 'drink' | 'custom';
  isCustom: boolean;
  isActive: boolean;
  alwaysShowModifiers?: boolean;
  sortOrder?: number;
  modifiers: ApiModifier[];
}

interface ProductCatalogResponse {
  version: string;
  products: ApiProduct[];
}
```

### 2.3 Función de fetch (`services/catalogApi.ts`)

```typescript
// Devuelve { ok, data?, error? } — nunca lanza (convención de services/)
export async function fetchProductCatalog(): Promise<
  { ok: true; catalog: ProductCatalogResponse } | { ok: false; error: string }
>
```

- Llama `GET {baseUrl}/api/v1/tpv/products`.
- Parsea, **convierte `basePrice`/`priceAdd` string→number** (`parseFloat`).
- Si falla → `{ ok: false, error }`.

### 2.4 Reemplazo en SQLite (`services/db.ts` — nueva función)

```typescript
/**
 * Reemplaza TODO el catálogo de products + modifiers en una sola transacción.
 * No toca tickets/orders/order_items. Si la transacción falla, SQLite hace
 * rollback automático → el catálogo anterior queda intacto.
 */
export async function replaceProductCatalog(products: ApiProduct[]): Promise<void>
```

- Patrón idéntico al de los `migrate_v*` que ya reseedean (ver `migrate_v20`):
  1. `PRAGMA foreign_keys = OFF`
  2. `DELETE FROM modifiers; DELETE FROM products;`
  3. `PRAGMA foreign_keys = ON`
  4. Transacción: insertar cada producto (respetando `sortOrder` → usar como `rowid` o
     añadir columna `sort_order` a `products`) y sus modifiers con id scopeado
     `{productId}-{modifier.id}`, igual que el seed actual.
- ⚠️ **`order_items.product_id` NO tiene FK a `products`** (ver schema: `order_items` no
  referencia `products`), así que borrar/reinsertar productos **no rompe** comandas
  históricas. Verificado en `db.ts`. Bien.
- Si un producto ya no viene del backend, simplemente desaparece del grid; las comandas
  antiguas que lo usaban siguen mostrando su `product_name` (snapshot guardado en
  `order_items`). Correcto por diseño.
- Guardar `version` y fecha de actualización en AsyncStorage (`catalog_version`,
  `catalog_updated_at`) para mostrarlo en Ajustes.

**Nota sobre orden**: hoy `getProducts()` ordena por `rowid ASC`. Para respetar `sortOrder`
del backend, lo más limpio es **añadir columna `sort_order` a `products`** (migración nueva)
y cambiar el `ORDER BY` a `sort_order ASC, rowid ASC`. Si se quiere evitar la migración en
este paso, insertar en el orden recibido también funciona (rowid creciente), pero es más
frágil. **Recomendado: añadir la columna.**

### 2.5 Acción de actualizar (orquestación)

Flujo del botón "Actualizar productos":

```
1. fetchProductCatalog()
2. si ok:
     replaceProductCatalog(catalog.products)
     guardar catalog.version + fecha en AsyncStorage
     useSessionStore.loadProducts()   ← recarga el store desde SQLite (ya existe)
     toast "Productos actualizados (N productos)"
   si error:
     toast "No se pudo actualizar. Se mantienen los productos actuales."
     (NO se toca SQLite)
```

`loadProducts()` ya existe en `stores/useSessionStore.ts` y recarga desde
`getProducts()` — reutilizarlo tal cual tras el reemplazo.

### 2.6 UI en Ajustes (`app/(tabs)/settings.tsx`)

- Nueva fila/sección "Productos":
  - Botón **"Actualizar productos"** (con spinner mientras descarga).
  - Texto secundario: "Última actualización: {fecha}" / "Versión: {version}".
  - Mensaje de resultado (toast o snackbar de react-native-paper).
- Deshabilitar el botón mientras hay una descarga en curso.

### 2.7 Lo que NO se toca en este paso

- Flujo de venta (COBRAR / AÑADIR OTRO / IMPRIMIR).
- Cola de sync de pedidos (`sync_queue`) — sigue desactivada (TODO API).
- ESC/POS, impresión, modo prueba.
- `lib/constants.ts` sigue siendo el **fallback de primera instalación** (seed inicial).

---

## 3. Checklist

**Backend**
- [ ] `GET /api/v1/tpv/products` con el shape de §1.1.
- [ ] Ids de productos y modifiers **estables** y coincidentes con los actuales.
- [ ] `version` (timestamp del catálogo).
- [ ] Solo productos activos (o `isActive` correcto).
- [ ] (Opcional) 304 con `?since=`/`If-Modified-Since`.

**App**
- [ ] `apiConfig` con base URL configurable + `apiGet` que parsea `{ok,data|error}`.
- [ ] Tipos `ApiProduct`/`ApiModifier` + conversión DECIMAL-string→number.
- [ ] `fetchProductCatalog()` (no lanza).
- [ ] `replaceProductCatalog()` en `db.ts` (transacción, rollback seguro, id scopeado).
- [ ] (Recomendado) columna `sort_order` en `products` + `ORDER BY` actualizado.
- [ ] Guardar `version`/fecha en AsyncStorage.
- [ ] Botón "Actualizar productos" en Ajustes + recarga de store + feedback.
- [ ] Probado offline: el fallo deja el catálogo intacto.

---

## 4. Resumen en una frase

El backend expone **un GET de solo lectura** con el catálogo completo; la app añade
**un botón** que lo descarga y **reemplaza** la tabla local en una transacción segura,
recargando el store que ya existe. Sin red, todo sigue funcionando con lo último guardado.
