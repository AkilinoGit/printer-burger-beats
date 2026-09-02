# Riesgos del catálogo de productos antes de llevar la BD a producción

> Documento de revisión (2026-09-02) sobre **cómo se rellena la tabla `products`**
> del TPV. Conclusión previa: el catálogo **no es 100 % API**. Convive una semilla
> hardcodeada en el APK con la descarga del backend, y hay rutas que pueden
> revertir el catálogo sincronizado a esa semilla sin avisar.
>
> Pendiente de resolver antes de dar la base de datos por buena en producción.

---

## 1. Las 4 vías por las que hoy se rellenan los productos

| Vía | Origen | Cuándo se ejecuta |
|---|---|---|
| `seedInitialData()` — 13 productos | **APK (build-time)** | Primera instalación (`migrate_v1`) |
| Reseeds en migraciones `v3`, `v4` (usada para v5–v8), `v20` (y v21), `v22` | **APK (build-time)** | Actualización desde esquema anterior a v23 |
| Self-heal "modifiers sin `section`" | **APK (build-time)** | **En cualquier arranque** si se cumple la condición |
| `replaceProductCatalogKeeping()` | **API** (`GET /api/v1/tpv/products`) | **Solo** al pulsar Sincronizar en Ajustes |
| `updateProductBasePrice()` + `priceOverrides` de sesión + precios feriante | **Local** | Edición manual del usuario |

Puntos de referencia:

- Semilla: `tpv/lib/constants.ts:126` (`INITIAL_PRODUCTS`), sembrada por
  `tpv/services/db.ts:910` (`seedInitialData`) desde `migrate_v1` (`db.ts:301`).
- Sync de catálogo: `tpv/services/catalogApi.ts` → `syncCatalogTask`
  (`tpv/services/syncAll.ts:85`) → `replaceProductCatalogKeeping`
  (`tpv/services/db.ts:1934`). Reemplazo **total** de `products` + `modifiers`,
  con red de seguridad de "supervivientes" (lo que el backend ya no trae se
  conserva salvo confirmación explícita en el modal de revisión).
- Disparo del sync: botón único de Ajustes → Sincronización
  (`tpv/app/(tabs)/settings.tsx:260`). **No hay sync de catálogo al arrancar ni
  periódico**: un dispositivo que nunca pulse ese botón vende exclusivamente con
  la semilla del APK.
- `insertProduct()` existe en `db.ts:1885` pero **ninguna pantalla lo llama**: la
  app no permite crear productos a mano.

---

## 2. Riesgos a resolver

### R1 — El self-heal puede revertir el catálogo de la API a la semilla del APK 🔴

**Dónde**: `tpv/services/db.ts:268-278`, dentro de `initDb()` (se ejecuta en cada arranque).

```sql
SELECT COUNT(*) as c FROM modifiers WHERE section IS NOT NULL
```

Si el resultado es `0`, se ejecuta `migrate_v20`, que hace
`DELETE FROM modifiers` + `DELETE FROM products` y reinserta `INITIAL_PRODUCTS`.

**Escenario de fallo**: se sincroniza un catálogo cuyos productos **no traen
modifiers**, o los traen todos con `section` a `null` → en el siguiente arranque
la app vuelve **silenciosamente** a los 13 productos hardcodeados. El usuario solo
lo detecta al ver nombres/precios viejos en la pantalla de venta.

**Arreglo propuesto**: condicionar el reseed a que el catálogo **no** provenga del
backend — ya se persiste `tpv:catalogVersion` / `tpv:catalogUpdatedAt` en
AsyncStorage (`syncAll.ts:105-112`). Si existe `tpv:catalogUpdatedAt`, no reseedear
nunca; como mucho, registrar el aviso en el log de diagnóstico.

---

### R2 — El `catch` del mismo bloque también reseedea 🔴

**Dónde**: `tpv/services/db.ts:279-282`.

Cualquier error en esa consulta (columna ausente en un esquema raro, BD bloqueada,
etc.) cae en el `catch` y ejecuta `migrate_v20` → borrado + reseed completo.

**Arreglo propuesto**: el `catch` debe registrar el error y **no** reseedear cuando
haya catálogo sincronizado. El reseed a ciegas solo es aceptable en una instalación
que nunca ha sincronizado.

---

### R3 — `UPDATE` hardcodeado por id de producto en cada arranque 🟠

**Dónde**: `tpv/services/db.ts:285`.

```sql
UPDATE products SET always_show_modifiers = 0 WHERE id = 'patatas'
```

Se ejecuta incondicionalmente en cada `initDb()`. Si el backend envía `patatas`
con `alwaysShowModifiers: true`, la app lo revierte en el siguiente arranque: el
backend deja de ser la fuente de verdad para ese campo.

**Arreglo propuesto**: eliminar la línea (ya la cubre `migrate_v23`, `db.ts:633`)
o limitarla a dispositivos sin catálogo sincronizado.

---

### R4 — Los precios feriante están anclados a ids del build 🟠

**Dónde**: `tpv/app/(tabs)/settings.tsx:242` — `Object.keys(DEFAULT_FERIANTE_PRICES)`,
8 ids hardcodeados en `tpv/lib/constants.ts`.

Un producto que llegue **solo por API** no aparece en el modal de precios feriante
y por tanto no se le puede fijar precio feriante desde el TPV. La única vía es que
el backend rellene `feriantePrice`, que se mergea en el store en
`tpv/services/syncAll.ts:114-122`.

**Arreglo propuesto**: construir la lista editable a partir de los productos reales
del store (`products.filter(p => !p.isCustom)`), usando `DEFAULT_FERIANTE_PRICES`
solo como valor por defecto de los ids que lo tengan.

---

### R5 — Cualquier migración futura que reseede vuelve a arrasar el catálogo 🟠

**Dónde**: patrón repetido en `migrate_v3` (`db.ts:887`), `migrate_v4` (`db.ts:423`),
`migrate_v20` (`db.ts:529`), `migrate_v22` (`db.ts:584`).

Hoy `SCHEMA_VERSION = 32` (`db.ts:33`) y ninguna de esas migraciones corre en un
dispositivo al día. Pero el patrón "borro todo y reinserto `INITIAL_PRODUCTS`" sigue
siendo el idioma del fichero: la próxima migración escrita por inercia repetirá el
borrado y perderá el catálogo del backend.

**Arreglo propuesto**: dejar una nota en `db.ts` (y en `CLAUDE.md`) prohibiendo el
reseed desde `INITIAL_PRODUCTS` en migraciones nuevas; las migraciones de catálogo
deben ser `ALTER`/`UPDATE` idempotentes, nunca `DELETE` + reseed.

---

### R6 — Código muerto que construye mapas desde la semilla 🟡

**Dónde**: `tpv/lib/constants.ts:243-290` — `buildModifierLabels()`,
`buildRadioNoSelectionLabels()`, `buildRadioOptionSets()`.

No los usa nadie: el runtime resuelve etiquetas con `buildMaps()`
(`tpv/lib/modifiers.ts:9`) sobre los productos leídos de SQLite. Si alguien vuelve
a llamarlos, se imprimirían etiquetas de la semilla en lugar de las del catálogo
sincronizado.

**Arreglo propuesto**: borrarlos.

---

## 3. Cambios mínimos para que el catálogo sea 100 % API

1. **Condicionar el self-heal** de `db.ts:268` (y su `catch`) a que no exista
   `tpv:catalogUpdatedAt` en AsyncStorage. *(R1 + R2)*
2. **Sincronizar el catálogo al arrancar**, fire-and-forget y **sin**
   `confirmCatalogDeletions` (así no se borra nada sin revisión del usuario).
3. Quitar el `UPDATE ... 'patatas'` incondicional. *(R3)*
4. Derivar la lista de precios feriante de los productos reales. *(R4)*
5. Nota anti-reseed en `db.ts` / `CLAUDE.md` para migraciones futuras. *(R5)*
6. Borrar las tres funciones muertas de `constants.ts`. *(R6)*

Decisión de producto pendiente: **¿la semilla del APK debe seguir existiendo?**
Sirve como red de seguridad para vender sin red en un dispositivo recién instalado.
Si se conserva, debe quedar claro que es **solo** para el arranque en frío y que
cualquier sync posterior la sustituye de forma definitiva.
