# Perfiles de producto (BURGER / CAFE)

> **Objetivo**: cada producto pertenece a un **perfil de carta** (`burger` | `cafe`).
> Todos los perfiles coexisten en la misma BD (local y backend). En **Ajustes** se elige
> el perfil activo; la **pantalla de venta** solo muestra los productos de ese perfil.
> El producto `OTROS` (precio libre) se muestra **siempre**, en cualquier perfil.
>
> No afecta al flujo de venta (COBRAR / AÑADIR OTRO / IMPRIMIR), ni a impresión ESC/POS,
> ni a la cola de sync, ni al histórico de comandas (`order_items` guarda snapshot del
> nombre, sin FK a `products` en la app).

Estado: **IMPLEMENTADO** (app + backend). Este documento describe el diseño y sirve de
referencia para el mantenimiento cross-repo.

---

## 0. Principio de diseño

- Nuevo campo `profile` en el producto. Extensible: hoy `'burger' | 'cafe'`, mañana más.
- **Migración**: todos los productos actuales quedan en `'burger'` (la carta actual es de
  hamburguesería). Se consigue con `DEFAULT 'burger'` en la columna, sin `UPDATE` explícito.
- **Retrocompatibilidad**: si el backend (o un JSON antiguo) no envía `profile`, la app
  asume `'burger'`.
- **Filtrado solo en la vista de venta**: `getProducts()` sigue devolviendo TODOS los
  productos; Ajustes (precios base, feriante) ve el catálogo completo. La pantalla de
  venta filtra en memoria por el perfil activo.

---

## 1. APP (TPV) — implementado

### 1.1 Modelo — `lib/types.ts`
- `export type ProductProfile = 'burger' | 'cafe';`
- `Product.profile: ProductProfile` (obligatorio).
- `ApiProduct.profile?: ProductProfile` (opcional → default `'burger'` al parsear).

### 1.2 Semilla local — `lib/constants.ts`
- `profile: 'burger'` en cada entrada de `INITIAL_PRODUCTS` (fallback de primera instalación).

### 1.3 Base de datos — `services/db.ts`
- `SCHEMA_VERSION` → **24**.
- `migrate_v1`: la definición `CREATE TABLE products` incluye
  `profile TEXT NOT NULL DEFAULT 'burger'` (instalaciones nuevas).
- Nueva **`migrate_v24`**: `ALTER TABLE products ADD COLUMN profile TEXT NOT NULL DEFAULT
  'burger'` (try/catch para BDs preexistentes). El `DEFAULT` deja todos los productos
  actuales en `'burger'`.
- `ProductRow.profile` + `mapProduct` → `profile: row.profile ?? 'burger'`.
- INSERTs con `profile`: **`insertProduct`** (creación de producto → aquí se elige el
  perfil) y **`replaceProductCatalog`** (sync del backend). Los reseeds
  (`seedInitialData`, `migrate_v2/3/4/20/22`) NO se tocan: sus productos son todos burger
  y heredan el `DEFAULT`.
- `getProducts()`: sin cambios de filtro; devuelve todos con su `profile`.

### 1.4 Estado global — `stores/useSessionStore.ts`
- `activeProductProfile: ProductProfile` (default `'burger'`).
- `setActiveProductProfile(p)` + `loadActiveProductProfile()`, persistido en AsyncStorage
  (`tpv:activeProductProfile`), mismo patrón que `forcePrintTwice` / `printMode`.
- Se carga en `initSession()` (fire-and-forget).

### 1.5 Ajustes — `app/(tabs)/settings.tsx`
- Nueva sección **"PERFIL DE PRODUCTOS"** con `SegmentedButtons`
  (Burger / Cafetería) enlazado a `activeProductProfile` / `setActiveProductProfile`.

### 1.6 Venta — `app/(tabs)/index.tsx`
- `visibleProducts = products.filter(p => p.isCustom || p.profile === activeProductProfile)`
  → **OTROS siempre visible**.
- `ProductGrid` (grid principal) y el `ProductGrid` de "Añadir producto" dentro de
  `NewTicketScreen` reciben `visibleProducts`.
- `buildMaps(...)` sigue construyéndose desde **todos** los `products`, para que las
  etiquetas de modifiers resuelvan siempre.

---

## 2. BACKEND (burger-beats-backend, PHP/Slim) — implementado

Repo: `C:\laragon\www\burger-beats-backend` (MySQL `burger_beats_local`, Laragon).

### 2.1 Migración — `migrations/026_products_profile.sql`
```sql
ALTER TABLE `products`
    ADD COLUMN `profile` VARCHAR(32) NOT NULL DEFAULT 'burger' AFTER `category`;
INSERT INTO `schema_migrations` (`version`, `description`, `applied_at`)
VALUES (26, 'products.profile: perfil de carta TPV (burger|cafe), default burger', NOW());
```
- Aditiva: todos los productos existentes → `'burger'`.
- ⚠️ La tabla `products` es **COMPARTIDA** con el admin (recetas/escandallos, ids UUID).
  Añadir columna con DEFAULT no rompe esos productos; simplemente quedan en `'burger'`
  (irrelevante para ellos, no se sirven en el catálogo TPV salvo id slug compartido como
  `fat-furious`).
- **Aplicación**: no hay runner automático en el repo; aplicar el `.sql` contra la BD por
  el método habitual del proyecto (p. ej. importar el fichero, o añadirlo a
  `migrations_all.sql`).

### 2.2 Endpoint `GET /api/v1/tpv/products`
- `ProductRepository::getCatalog()`: el `SELECT` incluye `profile`.
- `ProductController::formatProduct()`: añade `'profile' => (string)($row['profile'] ??
  'burger')` al JSON.

Respuesta (fragmento):
```json
{
  "id": "fat-furious",
  "name": "FAT & FURIOUS",
  "basePrice": 13.40,
  "category": "burger",
  "profile": "burger",
  "isCustom": false,
  "isActive": true,
  "alwaysShowModifiers": false,
  "sortOrder": 1,
  "modifiers": [ ... ]
}
```

### 2.3 Seed — `scripts/seed_tpv_catalog.php`
- El `INSERT ... ON DUPLICATE KEY UPDATE` incluye `profile` (`$p['profile'] ?? 'burger'`).
- Las entradas actuales del `$catalog` no declaran `profile` → default `'burger'`.
- Para añadir cafetería: crear entradas con `'profile' => 'cafe'` (y su id slug estable).

### 2.4 Orden de despliegue backend
1. Aplicar `026_products_profile.sql`.
2. Desplegar `ProductRepository` + `ProductController` (ya devuelven `profile`).
3. (Opcional) re-ejecutar `php scripts/seed_tpv_catalog.php` — idempotente; ahora también
   fija `profile`.

---

## 3. Restricción cross-repo (recordatorio)

Los ids de productos/modifiers/options deben coincidir **carácter a carácter** entre
`tpv/lib/constants.ts` y `scripts/seed_tpv_catalog.php`. Al añadir la carta de cafetería,
crear los productos en **ambos** con el mismo id slug y `profile: 'cafe'`.

---

## 4. Fuera de alcance (confirmado)

- No se añaden productos de cafetería de ejemplo — solo el mecanismo.
- No hay UI de creación de productos en la app; "elegir perfil al crear" se materializa en
  `insertProduct` (app) y en el backend/admin.

## 5. Cómo añadir la carta de cafetería (guía futura)

1. Definir los productos `cafe` (id slug, nombre, precio, category, modifiers).
2. Añadirlos a `INITIAL_PRODUCTS` (app) y al `$catalog` del seed (backend), ambos con
   `profile: 'cafe'`.
3. Re-ejecutar el seed backend; en la app, "Actualizar productos" en Ajustes.
4. En Ajustes → Perfil de productos → **Cafetería** para venderlos.

---

## 6. Rediseño: `category` como TEXTO LIBRE + secciones dinámicas

Estado: **IMPLEMENTADO** (app + backend + admin). Sustituye al enum fijo de
categoría por texto libre; el valor de `category` **es** el encabezado de sección
en la vista de venta, y se muestran tantas secciones como categorías distintas
existan. Se añade `categoryOrder` para ordenar las secciones. `profile` se
mantiene (redundante con category, pero filtra la carta). `OTROS`/precio libre se
sigue detectando por `isCustom`, nunca por el valor de category.

### 6.1 APP (TPV)
- `lib/types.ts`: `Product.category: string` (antes enum) + `categoryOrder?: number`.
  `ApiProduct` igual. Se eliminaron los campos intermedios `section`/`sectionOrder`.
- `services/db.ts`: `SCHEMA_VERSION` → **25**. Columna `category_order`. `migrate_v25`
  renombra las claves burger a nombres visibles (`burger→HAMBURGUESAS`,
  `side→ACOMPAÑANTES`, `drink→BEBIDAS`, `custom→OTROS`) y fija su orden 0..3
  (idempotente: el `WHERE category IN (clave, nombre)` cubre BD vieja e instalación
  nueva). Self-heal de `category_order`. `insertProduct`/`replaceProductCatalog`/
  `mapProduct` incluyen `category_order`.
- `components/ProductGrid.tsx`: `buildCategories()` agrupa por el string `category`
  (el valor es el título), ordena por `categoryOrder` (fallback: orden de aparición),
  color por posición (4 primeros = paleta clásica). Ya no depende del perfil para
  los títulos.
- `lib/constants.ts`: `INITIAL_PRODUCTS` con categorías visibles + `categoryOrder`.

### 6.2 BACKEND (burger-beats-backend)
- Migración `027_products_category_free.sql`: `category` ENUM → `VARCHAR(64)`,
  añade `category_order INT NULL`, renombra las claves burger a nombres visibles
  con su orden. Registra `schema_migrations` v27.
- `ProductRepository::getCatalog()` y `ProductRecipeRepository` (find*/create/update)
  incluyen `category_order`.
- `ProductController` (Tpv) y `RecipeController` (admin) `formatProduct` devuelven
  `categoryOrder`.
- `RecipeController`: `category` deja de validarse contra enum (ahora `string`, máx 64);
  se valida `categoryOrder` numérico. `VALID_CATEGORIES` eliminado; `VALID_PROFILES` se
  mantiene.
- `scripts/seed_tpv_catalog.php`: catálogo con categorías visibles + `categoryOrder`;
  el INSERT/UPSERT escribe `category_order`.
- Respuesta catálogo (fragmento): `"category": "HAMBURGUESAS", "categoryOrder": 0`.

### 6.3 ADMIN (burger-beats-admin)
- `types/api.ts`: `ProductCategory = string`; `Create/UpdateProductInput` y `Product`
  con `categoryOrder`.
- Alta (`CreateProductDialog`) y edición (`ProductRecipeSheet`): la categoría pasa de
  `Select` fijo a **input de texto libre con `datalist`** de categorías existentes
  (elegir una o escribir una nueva) + campo **Orden sección** (`categoryOrder`); al
  elegir una categoría existente se prerrellena su orden. La creación de productos y el
  alta de categorías nuevas viven aquí (el TPV solo consume).

### 6.4 Restricción cross-repo
Los ids siguen coincidiendo carácter a carácter entre `tpv/lib/constants.ts` y
`scripts/seed_tpv_catalog.php`. Ahora también deben coincidir el valor de `category`
(texto visible) y `categoryOrder` de los productos sembrados en ambos lados.

---

## 7. Normalización: `Category` como ENTIDAD propia (backend + admin)

Estado: **IMPLEMENTADO** (backend + admin). **La app TPV NO cambia.**

El texto libre de §6 dejaba la categoría desnormalizada (nombre+orden repetidos en
cada producto), obligando a mantener a mano la coherencia del orden. Se promueve a
entidad propia para que nombre y orden vivan en **un único sitio**.

### 7.1 Idea clave — la app no se toca
El endpoint del catálogo (`GET /api/v1/tpv/products`) hace **JOIN** con `categories`
y **sigue devolviendo `category` (nombre) + `categoryOrder`** por producto. La app TPV
sigue siendo un consumidor denormalizado (agrupa por el string `category`, ordena por
`categoryOrder`): **cero cambios** en la app.

### 7.2 BACKEND (burger-beats-backend)
- Migración `028_categories_table.sql`: crea `categories { id, name UNIQUE, sort_order }`,
  la puebla desde las categorías distintas actuales, añade `products.category_id` (FK),
  hace backfill por nombre y **elimina** `products.category` y `products.category_order`.
- `CategoryRepository` + `CategoryController` (Api/Admin): CRUD en `/api/v1/admin/categories`
  (crear/renombrar/reordenar/borrar; 409 si el nombre está duplicado o la categoría está
  en uso). Registrados en `App.php` (DI) y `Routes.php`.
- `ProductRepository::getCatalog` y `ProductRecipeRepository` (find/create/update) usan
  `category_id` + JOIN; el JSON del catálogo TPV mantiene `category`/`categoryOrder`.
- `RecipeController`: crear/editar producto usa `categoryId` (requerido en alta, validado
  contra `categories`); `formatProduct` devuelve `categoryId` + `category` + `categoryOrder`.
- `scripts/seed_tpv_catalog.php`: upsert de `categories` desde el catálogo → mapa nombre→id;
  los productos se insertan con `category_id`.

### 7.3 ADMIN (burger-beats-admin)
- `types/api.ts`: entidad `Category { id, name, sortOrder }`; `Product` gana `categoryId`
  (+ `category`/`categoryOrder` de solo lectura); `Create/UpdateProductInput` usan `categoryId`.
- `lib/categoriesApi.ts` + `hooks/useCategories.ts`: CRUD + react-query.
- Alta (`CreateProductDialog`) y edición (`ProductRecipeSheet`): la categoría es ahora un
  **`Select` de categorías** (entidad), sin campo de orden por producto.
- **`ManageCategoriesDialog`** (accesible desde `ProductsTab` → botón «Categorías»):
  crear / renombrar / reordenar / borrar categorías. Aquí el orden se edita **una vez**.

### 7.4 Despliegue backend
1. Aplicar `028_categories_table.sql` (después de la 027).
2. Desplegar el código (categorías + JOINs, ya en repo).
3. (Opcional) re-ejecutar `php scripts/seed_tpv_catalog.php` — idempotente; crea/actualiza
   categorías y reasigna `category_id`.
