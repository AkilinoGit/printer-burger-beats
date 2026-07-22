# Plan — Mensajes de ticket y batería de nombres (Text Presets)

> Entidad única `TextPreset` para dos usos: **mensajes del ticket del cliente**
> (hoy hardcodeados en `escpos.ts`) y **batería de nombres** de pedido. El
> contenido (texto) se sincroniza con el backend y se comparte entre móviles; la
> **selección de cuáles mostrar (`enabled`) y el modo de impresión son LOCALES**
> de cada dispositivo.

## 1. Decisiones cerradas (con el usuario)

1. **Entidad unificada** con discriminador `kind` (`ticket_message` | `order_name`).
2. Los mensajes de ticket tienen **posición** (`slot`: `header` | `footer`).
3. **"Todo local"**: solo el **texto** viaja al servidor. `enabled` y el modo de
   impresión son de cada dispositivo (no se sincronizan).
4. **Header y footer son simétricos**: ambos editables, ambos con `enabled` local
   y modo Fijo/Aleatorio local.
5. **Un slot imprime UN mensaje por ticket** (nunca varios a la vez). "Todos"
   significa "todos son candidatos al sorteo", no "imprime todos".
   - `enabled` por preset = candidatos.
   - Modo **Aleatorio** → sortea uno entre los candidatos activos.
   - Modo **Fijo** → imprime uno concreto (`fixedId`), sin sortear.
   - Sin candidatos activos (o `fixedId` inexistente) → el slot no imprime nada.
6. **Nombres**: al dejar el nombre del pedido vacío se resuelve un nombre según el
   modo (Aleatorio entre activos / Fijo). Relaja la regla "nombre obligatorio".

## 2. Modelo local vs. modelo de red

Como `Session`/`ApiSession`: el modelo local incluye `enabled` (que **nunca**
cruza la red); el modelo de red lo omite.

```typescript
type TextPresetKind = 'ticket_message' | 'order_name';
type TicketSlot = 'header' | 'footer';

interface TextPreset {          // local (SQLite + store)
  id: string;
  kind: TextPresetKind;
  text: string;
  slot: TicketSlot | null;      // header/footer para mensajes; null para nombres
  enabled: boolean;             // SOLO local — no se sincroniza
  sortOrder: number;
  createdAt: string;
  updatedAt: string;            // árbitro LWW
  syncStatus: SyncStatus;
  deletedAt: string | null;     // soft delete
  origin: 'local' | 'remote';
}

interface ApiTextPreset {       // red (sube/baja del backend) — sin `enabled`
  id: string;
  kind: TextPresetKind;
  text: string;
  slot: TicketSlot | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string | null;
  deletedAt: string | null;
}
```

Config de dispositivo (AsyncStorage):

```typescript
tpv:textPresetModes → {
  header:    { mode: 'random' | 'fixed', fixedId: string | null },
  footer:    { mode: 'random' | 'fixed', fixedId: string | null },
  orderName: { mode: 'random' | 'fixed', fixedId: string | null },
}
```

## 3. SQLite — migración v29 (SCHEMA_VERSION 28 → 29)

```sql
CREATE TABLE IF NOT EXISTS text_presets (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,              -- 'ticket_message' | 'order_name'
  text         TEXT NOT NULL,
  slot         TEXT,                       -- 'header' | 'footer' | NULL
  enabled      INTEGER NOT NULL DEFAULT 1, -- local; el sync NUNCA la toca
  sort_order   INTEGER NOT NULL DEFAULT 999,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  sync_status  TEXT NOT NULL DEFAULT 'pending',
  deleted_at   TEXT,
  origin       TEXT NOT NULL DEFAULT 'local'
);
```

**Seed** (en la migración): mensaje de catering (`header`), `GRACIAS POR VENIR :)`
(`footer`) y ~20 nombres (`kind='order_name'`), todos `enabled=1`.

**Regla de oro del "todo local"**: `upsertTextPresetsFromBackend` actualiza
`text/slot/sort_order/updated_at/deleted_at` pero **nunca** toca `enabled`. Un
preset nuevo bajado del servidor entra `enabled=1` (opt-out por defecto).

## 4. Sincronización (solo el texto)

- `services/textPresetsApi.ts`: **PUSH primario + PULL con LWW**, calcado de
  `sessionsApi.ts`. Sube `ApiTextPreset` (sin `enabled`); baja y fusiona sin
  destruir. Cursor `since` en AsyncStorage. Nunca lanza.
- `services/syncAll.ts`: nueva `SyncTask` "Mensajes" en `buildTasks` (sin FK, va
  junto a Locales).
- Disparo *fire-and-forget* tras cada alta/edición/borrado (como sesiones).

### Backend (repo `burger-beats-backend`, PENDIENTE en su propio repo)

- Migración `~033`: tabla `tpv_text_presets` (**sin columna `enabled`** — es
  concepto de cliente).
- Endpoints con envoltorio `{ ok, data }`:
  - `GET  /api/v1/tpv/text-presets?since=…` → `{ presets: ApiTextPreset[], serverTime }`
  - `POST /api/v1/tpv/text-presets/batch`   → upsert por lotes, LWW por `updatedAt`.
- El admin web puede curar el **contenido** del pool; el on/off es de cada TPV.

## 5. Store y consumo

- `stores/useTextPresetsStore.ts`:
  - `presets: TextPreset[]` (cargado de SQLite), `modes` (AsyncStorage).
  - CRUD (escribe local + sync fire-and-forget) y `toggleEnabled` (solo local).
  - Resolvers: `resolveHeaderMessage()`, `resolveFooterMessage()`,
    `resolveOrderName()` → `string | null` según `enabled` + modo.
- `services/escpos.ts`: `buildTicketBuffer(..., headerMessage, footerMessage)`.
  Se eliminan los literales del mensaje de catering y de `GRACIAS POR VENIR`. El
  logo y los iconos de contacto siguen fijos (identidad de marca); solo el
  **texto** sale del pool. Los mensajes solo se imprimen en la copia completa
  (`repeatContent`), que es la copia del cliente.
- `services/printer.ts`: `printTicket` resuelve header/footer del store (una vez)
  y los pasa a `buildTicketBuffer`. Sin cambios en los call sites.
- Flujo de venta (`app/(tabs)/index.tsx`): en `persistCurrentOrder`, si
  `clientName` va vacío se usa `resolveOrderName()` en vez del literal `'PEDIDO'`.

## 6. UI de gestión

Nueva ruta `app/settings/mensajes.tsx` (enlazada desde Ajustes). Tres secciones
(Cabecera, Pie, Nombres). Por sección:
- Lista de presets: toggle `enabled`, editar texto, borrar; botón "Añadir".
- Selector de modo **Fijo / Aleatorio**; en Fijo, elegir cuál es el fijo.

## 7. Fases de ejecución

1. Tipos (`lib/types.ts`) + seed (`lib/constants.ts`).
2. DB: migración v29, tabla, seed, CRUD, sync-support.
3. `textPresetsApi.ts` + task en `syncAll.ts`.
4. `useTextPresetsStore.ts` + carga en `_layout`.
5. `escpos.ts` + `printer.ts` (mensajes) — quitar literales.
6. Nombre aleatorio en el flujo de venta.
7. Pantalla `settings/mensajes.tsx` + enlace.
8. Backend (repo aparte) — migración + endpoints.

## 8. Notas

- Actualizar en `CLAUDE.md` la regla "nombre obligatorio" (ahora se autorrellena
  desde la batería si se deja vacío) y añadir `text_presets` a la lista de tablas.
- La app es funcional en local sin backend: los presets viven en SQLite, la
  edición/impresión/nombre funcionan offline y el sync degrada en silencio.
