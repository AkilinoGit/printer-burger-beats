import * as SQLite from 'expo-sqlite';
import { INITIAL_PRODUCTS, DEFAULT_LOCATION_NAME, INITIAL_TEXT_PRESETS } from '../lib/constants';
import { getDeviceId } from '../lib/device';
import { generateId, todayISO } from '../lib/utils';
import type {
  Location,
  Session,
  SessionOrigin,
  Product,
  Modifier,
  Ticket,
  Order,
  OrderItem,
  PriceProfile,
  SyncStatus,
  ApiProduct,
  ApiLocation,
  ApiSession,
  ApiTicket,
  TextPreset,
  TextPresetKind,
  TicketSlot,
  ApiTextPreset,
} from '../lib/types';

// ---------------------------------------------------------------------------
// DB singleton
// ---------------------------------------------------------------------------

const DB_NAME = 'tpv_v12.db';
const SCHEMA_VERSION = 29;

let _db: SQLite.SQLiteDatabase | null = null;
let _initPromise: Promise<void> | null = null;

async function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync(DB_NAME);
  return _db;
}

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;           // already open — skip await entirely
  if (_initPromise) await _initPromise;
  return openDb();
}

// ---------------------------------------------------------------------------
// Init & migrations
// ---------------------------------------------------------------------------

/**
 * Initializes the database. Safe to call multiple times — runs only once.
 * Always await this before any CRUD operation.
 */
export async function initDb(): Promise<void> {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const db = await openDb();

    // Disable WAL — use simpler DELETE journal mode to avoid checkpoint overhead.
    // Also set cache size and synchronous level for mobile I/O.
    await db.execAsync(`
      PRAGMA journal_mode=DELETE;
      PRAGMA synchronous=NORMAL;
      PRAGMA cache_size=-2000;
    `);

    // user_version pragma drives migrations
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const currentVersion = row?.user_version ?? 0;

    if (currentVersion < 1) {
      await migrate_v1(db);
    }
    if (currentVersion < 2) {
      await migrate_v2(db);
    }
    if (currentVersion < 3) {
      await migrate_v3(db);
    }
    if (currentVersion < 4) {
      await migrate_v4(db);
    }
    if (currentVersion < 5) {
      await migrate_v4(db);
    }
    if (currentVersion < 6) {
      await migrate_v4(db);
    }
    if (currentVersion < 7) {
      await migrate_v4(db); // same logic: reseed products/modifiers
    }
    if (currentVersion < 8) {
      await migrate_v4(db); // reseed with fixed priceAdd for negative modifiers
    }
    if (currentVersion < 9) {
      await migrate_v9(db); // add session_code/opened_at/auto_close_at/closed_at/device_id to sessions; edited_at/edit_count to tickets
    }
    if (currentVersion < 10) {
      await migrate_v10(db); // add action column to sync_queue
    }
    if (currentVersion < 11) {
      await migrate_v11(db); // add price_profile column to orders
    }
    if (currentVersion < 12) {
      await migrate_v12(db); // ensure price_profile column exists (retry after silent fail in v11)
    }
    if (currentVersion < 13) {
      await migrate_v13(db); // guarantee price_profile exists on devices already at v12
    }
    if (currentVersion < 14) {
      await migrate_v14(db); // add take_away column to orders
    }
    if (currentVersion < 15) {
      await migrate_v15(db); // insert mod_sin_gluten modifier for all burger products
    }
    if (currentVersion < 16) {
      await migrate_v16(db); // add indexes on FK columns and sync_queue status
    }
    if (currentVersion < 17) {
      await migrate_v17(db); // create app_log table for in-app diagnostics
    }
    if (currentVersion < 18) {
      await migrate_v18(db); // purge sync_queue — no API yet, rows were never consumed
    }
    if (currentVersion < 19) {
      await migrate_v19(db); // add Sin nada modifier to patatas, alitas, tekeños, burger-nino
    }
    if (currentVersion < 20) {
      await migrate_v20(db); // add section + sort_order columns to modifiers and reseed
    }
    if (currentVersion < 21) {
      await migrate_v20(db); // reseed: patatas modifiers now have section assigned
    }
    if (currentVersion < 22) {
      await migrate_v22(db); // rename product id 'gyozas' → 'gyozas-pollo' and add 'gyozas-verdura'
    }
    if (currentVersion < 23) {
      await migrate_v23(db); // clear always_show_modifiers for patatas
    }
    if (currentVersion < 24) {
      await migrate_v24(db); // add profile column to products (all existing → 'burger')
    }
    if (currentVersion < 25) {
      await migrate_v25(db); // category becomes free text: add category_order + rename burger keys to display names
    }
    if (currentVersion < 26) {
      await migrate_v26(db); // sessions: notes/updated_at/sync_status/deleted_at/origin + backfill device_id
    }
    if (currentVersion < 27) {
      await migrate_v27(db); // tickets: device_id (numeración + prefijo por dispositivo) + backfill
    }
    if (currentVersion < 28) {
      await migrate_v28(db); // drop legacy sync_queue table (cola offline nunca consumida)
    }
    if (currentVersion < 29) {
      await migrate_v29(db); // create text_presets table + seed (mensajes de ticket + batería de nombres)
    }
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);

    // Self-heal de las columnas de sync de sesiones: si el ALTER de v26 se tragó
    // silenciosamente en algún dispositivo (mismo fallo que products.profile en
    // v24), el push de sesiones fallaría al leer columnas inexistentes.
    try {
      await ensureSessionSyncColumns(db);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log('[db] sessions sync columns self-heal failed', e);
    }

    // Self-heal de tickets.device_id (v27): si el ALTER falló en silencio, el push
    // de comandas fallaría al leerla. Idempotente.
    try {
      const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(tickets)');
      if (!cols.some((c) => c.name === 'device_id')) {
        await db.execAsync(`ALTER TABLE tickets ADD COLUMN device_id TEXT`);
        const deviceId = await getDeviceId();
        await db.runAsync('UPDATE tickets SET device_id = ? WHERE device_id IS NULL', [deviceId]);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log('[db] tickets.device_id self-heal failed', e);
    }

    // Self-heal: guarantee products.profile exists even on devices whose
    // user_version was already bumped to 24 while migrate_v24's ALTER was
    // silently swallowed (same class of bug fixed for price_profile in v12/v13).
    // Without this, replaceProductCatalog fails writing the profile column.
    try {
      const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(products)');
      if (!cols.some((c) => c.name === 'profile')) {
        // eslint-disable-next-line no-console
        console.log('[db] products.profile missing — adding column');
        await db.execAsync(`ALTER TABLE products ADD COLUMN profile TEXT NOT NULL DEFAULT 'burger'`);
      }
      // Same self-heal for the category ordering column (v25).
      if (!cols.some((c) => c.name === 'category_order')) {
        // eslint-disable-next-line no-console
        console.log('[db] products.category_order missing — adding column');
        await db.execAsync(`ALTER TABLE products ADD COLUMN category_order INTEGER`);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log('[db] products.profile self-heal failed', e);
    }

    // Self-heal: if for any reason modifiers have no section populated
    // (e.g. v20 was marked done but the reseed silently failed), force a reseed.
    try {
      const check = await db.getFirstAsync<{ c: number }>(
        "SELECT COUNT(*) as c FROM modifiers WHERE section IS NOT NULL"
      );
      if (!check || check.c === 0) {
        // eslint-disable-next-line no-console
        console.log('[db] No modifiers with section found — running reseed');
        await migrate_v20(db);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log('[db] Self-heal check failed (column may not exist yet) — running reseed', e);
      await migrate_v20(db);
    }

    // Always ensure patatas does not force the modifier sheet on every tap.
    try {
      await db.runAsync("UPDATE products SET always_show_modifiers = 0 WHERE id = 'patatas'");
    } catch { /* column may not exist on very old schemas — safe to ignore */ }

    // Self-heal: guarantee the text_presets table exists and has its seed even
    // on devices whose user_version was already 29 while migrate_v29 was silently
    // swallowed. Idempotent (CREATE IF NOT EXISTS + INSERT OR IGNORE seed).
    try {
      await ensureTextPresetsSeed(db);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log('[db] text_presets self-heal failed', e);
    }
  })();
  return _initPromise;
}

async function migrate_v1(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync(`
      CREATE TABLE IF NOT EXISTS locations (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        is_default  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id               TEXT PRIMARY KEY,
        location_id      TEXT NOT NULL REFERENCES locations(id),
        date             TEXT NOT NULL,
        status           TEXT NOT NULL DEFAULT 'open',
        price_overrides  TEXT NOT NULL DEFAULT '{}',
        created_at       TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS products (
        id                    TEXT PRIMARY KEY,
        name                  TEXT NOT NULL,
        base_price            REAL NOT NULL,
        category              TEXT NOT NULL,
        category_order        INTEGER,
        profile               TEXT NOT NULL DEFAULT 'burger',
        is_custom             INTEGER NOT NULL DEFAULT 0,
        is_active             INTEGER NOT NULL DEFAULT 1,
        always_show_modifiers INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS modifiers (
        id                  TEXT PRIMARY KEY,
        product_id          TEXT NOT NULL REFERENCES products(id),
        label               TEXT NOT NULL,
        type                TEXT NOT NULL,
        price_add           REAL NOT NULL DEFAULT 0,
        options             TEXT NOT NULL DEFAULT '[]',
        no_selection_label  TEXT,
        section             TEXT,
        sort_order          INTEGER NOT NULL DEFAULT 999
      );

      CREATE TABLE IF NOT EXISTS tickets (
        id             TEXT PRIMARY KEY,
        session_id     TEXT NOT NULL REFERENCES sessions(id),
        ticket_number  INTEGER NOT NULL,
        printed_at     TEXT,
        sync_status    TEXT NOT NULL DEFAULT 'pending',
        created_at     TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS orders (
        id           TEXT PRIMARY KEY,
        ticket_id    TEXT NOT NULL REFERENCES tickets(id),
        client_name  TEXT NOT NULL,
        amount_paid  REAL,
        change       REAL,
        total        REAL NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id                  TEXT PRIMARY KEY,
        order_id            TEXT NOT NULL REFERENCES orders(id),
        product_id          TEXT NOT NULL,
        product_name        TEXT NOT NULL,
        qty                 INTEGER NOT NULL DEFAULT 1,
        unit_price          REAL NOT NULL,
        modifier_price_add  REAL NOT NULL DEFAULT 0,
        selected_modifiers  TEXT NOT NULL DEFAULT '[]',
        custom_label        TEXT
      );

      CREATE TABLE IF NOT EXISTS sync_queue (
        id           TEXT PRIMARY KEY,
        entity_type  TEXT NOT NULL,
        entity_id    TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending',
        attempts     INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL
      );
    `);
  });

  await seedInitialData(db);
}

async function migrate_v2(db: SQLite.SQLiteDatabase): Promise<void> {
  // ALTER TABLE must run outside a transaction in expo-sqlite.
  // Ignore "duplicate column" errors in case a previous partial migration ran.
  const addColumn = async (sql: string) => {
    try { await db.execAsync(sql); } catch { /* column already exists */ }
  };
  await addColumn(`ALTER TABLE modifiers ADD COLUMN price_add REAL NOT NULL DEFAULT 0`);
  await addColumn(`ALTER TABLE modifiers ADD COLUMN options TEXT NOT NULL DEFAULT '[]'`);
  await addColumn(`ALTER TABLE modifiers ADD COLUMN no_selection_label TEXT`);
  await addColumn(`ALTER TABLE order_items ADD COLUMN modifier_price_add REAL NOT NULL DEFAULT 0`);

  // Delete outside transaction first to avoid constraint issues
  await db.execAsync('PRAGMA foreign_keys = OFF');
  await db.runAsync('DELETE FROM modifiers');
  await db.runAsync('DELETE FROM products');
  await db.execAsync('PRAGMA foreign_keys = ON');

  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const p of INITIAL_PRODUCTS) {
      await txn.runAsync(
        'INSERT INTO products (id, name, base_price, category, is_custom, is_active, always_show_modifiers) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [p.id, p.name, p.basePrice, p.category, p.isCustom ? 1 : 0, p.isActive ? 1 : 0, p.alwaysShowModifiers ? 1 : 0],
      );
      for (const m of p.modifiers) {
        await txn.runAsync(
          'INSERT INTO modifiers (id, product_id, label, type, price_add, options, no_selection_label) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [`${p.id}-${m.id}`, p.id, m.label, m.type, m.priceAdd ?? 0, JSON.stringify(m.options ?? []), m.noSelectionLabel ?? null],
        );
      }
    }
  });
}

async function migrate_v4(db: SQLite.SQLiteDatabase): Promise<void> {
  // Reseed products in correct display order (rowid-based sorting)
  await db.execAsync('PRAGMA foreign_keys = OFF');
  await db.runAsync('DELETE FROM modifiers');
  await db.runAsync('DELETE FROM products');
  await db.execAsync('PRAGMA foreign_keys = ON');

  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const p of INITIAL_PRODUCTS) {
      await txn.runAsync(
        'INSERT INTO products (id, name, base_price, category, is_custom, is_active, always_show_modifiers) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [p.id, p.name, p.basePrice, p.category, p.isCustom ? 1 : 0, p.isActive ? 1 : 0, p.alwaysShowModifiers ? 1 : 0],
      );
      for (const m of p.modifiers) {
        await txn.runAsync(
          'INSERT INTO modifiers (id, product_id, label, type, price_add, options, no_selection_label) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [`${p.id}-${m.id}`, p.id, m.label, m.type, m.priceAdd ?? 0, JSON.stringify(m.options ?? []), m.noSelectionLabel ?? null],
        );
      }
    }
  });
}

async function migrate_v9(db: SQLite.SQLiteDatabase): Promise<void> {
  const addCol = async (sql: string) => {
    try { await db.execAsync(sql); } catch { /* column already exists */ }
  };
  await addCol(`ALTER TABLE sessions ADD COLUMN session_code TEXT`);
  await addCol(`ALTER TABLE sessions ADD COLUMN opened_at TEXT`);
  await addCol(`ALTER TABLE sessions ADD COLUMN auto_close_at TEXT`);
  await addCol(`ALTER TABLE sessions ADD COLUMN closed_at TEXT`);
  await addCol(`ALTER TABLE sessions ADD COLUMN device_id TEXT`);
  await addCol(`ALTER TABLE tickets ADD COLUMN edited_at TEXT`);
  await addCol(`ALTER TABLE tickets ADD COLUMN edit_count INTEGER NOT NULL DEFAULT 0`);
}

async function migrate_v10(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    await db.execAsync(`ALTER TABLE sync_queue ADD COLUMN action TEXT NOT NULL DEFAULT 'create'`);
  } catch { /* column already exists */ }
}

async function migrate_v11(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    await db.execAsync(`ALTER TABLE orders ADD COLUMN price_profile TEXT NOT NULL DEFAULT 'normal'`);
  } catch { /* column already exists */ }
}

async function migrate_v12(db: SQLite.SQLiteDatabase): Promise<void> {
  // Retry adding price_profile in case migrate_v11 was silently swallowed on tpv_v11.db
  try {
    await db.execAsync(`ALTER TABLE orders ADD COLUMN price_profile TEXT NOT NULL DEFAULT 'normal'`);
  } catch { /* column already exists — OK */ }
}

async function migrate_v13(db: SQLite.SQLiteDatabase): Promise<void> {
  // Guarantee price_profile exists on devices whose user_version was already 12
  // but the column was never actually created (v11/v12 may have been skipped).
  try {
    await db.execAsync(`ALTER TABLE orders ADD COLUMN price_profile TEXT NOT NULL DEFAULT 'normal'`);
  } catch { /* column already exists — OK */ }
}

async function migrate_v14(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    await db.execAsync(`ALTER TABLE orders ADD COLUMN take_away INTEGER NOT NULL DEFAULT 0`);
  } catch { /* column already exists — OK */ }
}

async function migrate_v15(db: SQLite.SQLiteDatabase): Promise<void> {
  const burgerIds = ['fat-furious', 'ben-muerde', 'doble-subwoofer', 'burger-nino'];
  for (const productId of burgerIds) {
    await db.runAsync(
      `INSERT OR IGNORE INTO modifiers (id, product_id, label, type) VALUES (?, ?, ?, ?)`,
      ['mod_sin_gluten_' + productId, productId, 'Sin Gluten', 'remove'],
    );
  }
}

async function migrate_v16(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_orders_ticket ON orders(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_session ON tickets(session_id);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
  `);
}

async function migrate_v17(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS app_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ts         TEXT    NOT NULL,
      level      TEXT    NOT NULL,
      tag        TEXT    NOT NULL,
      msg        TEXT    NOT NULL,
      ms         INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_app_log_ts ON app_log(ts);
  `);
}

async function migrate_v18(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.runAsync("DELETE FROM sync_queue");
}

async function migrate_v20(db: SQLite.SQLiteDatabase): Promise<void> {
  // Add section + sort_order columns and reseed products/modifiers
  const addCol = async (sql: string) => {
    try { await db.execAsync(sql); } catch { /* column already exists */ }
  };
  await addCol(`ALTER TABLE modifiers ADD COLUMN section TEXT`);
  await addCol(`ALTER TABLE modifiers ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 999`);

  await db.execAsync('PRAGMA foreign_keys = OFF');
  await db.runAsync('DELETE FROM modifiers');
  await db.runAsync('DELETE FROM products');
  await db.execAsync('PRAGMA foreign_keys = ON');

  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const p of INITIAL_PRODUCTS) {
      await txn.runAsync(
        'INSERT INTO products (id, name, base_price, category, is_custom, is_active, always_show_modifiers) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [p.id, p.name, p.basePrice, p.category, p.isCustom ? 1 : 0, p.isActive ? 1 : 0, p.alwaysShowModifiers ? 1 : 0],
      );
      for (const m of p.modifiers) {
        await txn.runAsync(
          'INSERT INTO modifiers (id, product_id, label, type, price_add, options, no_selection_label, section, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [`${p.id}-${m.id}`, p.id, m.label, m.type, m.priceAdd ?? 0, JSON.stringify(m.options ?? []), m.noSelectionLabel ?? null, m.section ?? null, m.order ?? 999],
        );
      }
    }
  });
}

async function migrate_v19(db: SQLite.SQLiteDatabase): Promise<void> {
  // Insert 'Sin nada' as first modifier for patatas, alitas, tekeños, burger-nino
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `INSERT OR IGNORE INTO modifiers (id, product_id, label, type, price_add, options, no_selection_label)
       VALUES ('patatas-sin-nada', 'patatas', 'Sin nada', 'add', 0, '[]', NULL)`,
    );
    // salsa-sin-nada is a radio option — stored in the options JSON of each salsa radio modifier.
    // Update options for alitas-salsa, tekenos-salsa, nino-salsa to prepend Sin nada.
    const radioIds = ['alitas-salsa', 'tekenos-salsa', 'nino-salsa'];
    for (const modId of radioIds) {
      const row = await txn.getFirstAsync<{ options: string }>(
        'SELECT options FROM modifiers WHERE id = ?', [modId],
      );
      if (!row) continue;
      const opts: { id: string; label: string }[] = JSON.parse(row.options);
      if (opts.some((o) => o.id === 'salsa-sin-nada')) continue; // already added
      opts.unshift({ id: 'salsa-sin-nada', label: 'Sin nada' });
      await txn.runAsync(
        'UPDATE modifiers SET options = ? WHERE id = ?',
        [JSON.stringify(opts), modId],
      );
    }
  });
}

async function migrate_v22(db: SQLite.SQLiteDatabase): Promise<void> {
  // Rename product id 'gyozas' → 'gyozas-pollo' across all tables, and
  // rotate the corresponding key in sessions.price_overrides JSON blobs.
  // products table is fully reseeded from INITIAL_PRODUCTS at the end so
  // the new 'gyozas-verdura' row also lands.
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      "UPDATE order_items SET product_id = 'gyozas-pollo' WHERE product_id = 'gyozas'",
    );

    const rows = await txn.getAllAsync<{ id: string; price_overrides: string }>(
      "SELECT id, price_overrides FROM sessions WHERE price_overrides LIKE '%gyozas%'",
    );
    for (const row of rows) {
      let obj: Record<string, number>;
      try { obj = JSON.parse(row.price_overrides); } catch { continue; }
      if (Object.prototype.hasOwnProperty.call(obj, 'gyozas')) {
        obj['gyozas-pollo'] = obj['gyozas'];
        delete obj['gyozas'];
        await txn.runAsync(
          'UPDATE sessions SET price_overrides = ? WHERE id = ?',
          [JSON.stringify(obj), row.id],
        );
      }
    }
  });

  // Reseed products + modifiers so the new gyozas-pollo / gyozas-verdura rows exist.
  await db.execAsync('PRAGMA foreign_keys = OFF');
  await db.runAsync('DELETE FROM modifiers');
  await db.runAsync('DELETE FROM products');
  await db.execAsync('PRAGMA foreign_keys = ON');

  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const p of INITIAL_PRODUCTS) {
      await txn.runAsync(
        'INSERT INTO products (id, name, base_price, category, is_custom, is_active, always_show_modifiers) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [p.id, p.name, p.basePrice, p.category, p.isCustom ? 1 : 0, p.isActive ? 1 : 0, p.alwaysShowModifiers ? 1 : 0],
      );
      for (const m of p.modifiers) {
        await txn.runAsync(
          'INSERT INTO modifiers (id, product_id, label, type, price_add, options, no_selection_label, section, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [`${p.id}-${m.id}`, p.id, m.label, m.type, m.priceAdd ?? 0, JSON.stringify(m.options ?? []), m.noSelectionLabel ?? null, m.section ?? null, m.order ?? 999],
        );
      }
    }
  });
}

async function migrate_v23(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.runAsync(
    "UPDATE products SET always_show_modifiers = 0 WHERE id = 'patatas'",
  );
}

async function migrate_v24(db: SQLite.SQLiteDatabase): Promise<void> {
  // Add profile column to products. The DEFAULT leaves every existing product
  // in the 'burger' profile automatically. New 'cafe' products come from the
  // backend catalog or insertProduct with an explicit profile.
  try {
    await db.execAsync(`ALTER TABLE products ADD COLUMN profile TEXT NOT NULL DEFAULT 'burger'`);
  } catch { /* column already exists (created in migrate_v1 on fresh installs) */ }
}

async function migrate_v25(db: SQLite.SQLiteDatabase): Promise<void> {
  // `category` pasa a ser texto libre y ES el encabezado de sección en la vista
  // de venta. Se añade `category_order` para ordenar las categorías entre sí, y
  // se renombran las claves internas burger a sus nombres visibles para que los
  // encabezados no muestren 'burger'/'side'/… El catálogo del backend puede
  // enviar cualquier category y su categoryOrder.
  try {
    await db.execAsync(`ALTER TABLE products ADD COLUMN category_order INTEGER`);
  } catch { /* column already exists (created in migrate_v1 on fresh installs) */ }

  // Renombrado + orden de las categorías burger (idempotente). El WHERE acepta
  // tanto la clave interna vieja (BDs preexistentes) como el nombre visible
  // (instalaciones nuevas ya sembradas con constants.ts), de modo que
  // category_order queda fijado en ambos casos.
  const RENAMES: Array<[from: string, to: string, order: number]> = [
    ['burger', 'HAMBURGUESAS', 0],
    ['side',   'ACOMPAÑANTES', 1],
    ['drink',  'BEBIDAS',      2],
    ['custom', 'OTROS',        3],
  ];
  for (const [from, to, order] of RENAMES) {
    await db.runAsync(
      'UPDATE products SET category = ?, category_order = ? WHERE category IN (?, ?)',
      [to, order, from, to],
    );
  }
}

/**
 * Añade (si faltan) las columnas que el sync de sesiones necesita. Idempotente:
 * se usa tanto desde migrate_v26 como desde el self-heal de initDb.
 */
async function ensureSessionSyncColumns(db: SQLite.SQLiteDatabase): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(sessions)');
  const has = (name: string): boolean => cols.some((c) => c.name === name);

  if (!has('notes')) {
    await db.execAsync(`ALTER TABLE sessions ADD COLUMN notes TEXT`);
  }
  if (!has('updated_at')) {
    await db.execAsync(`ALTER TABLE sessions ADD COLUMN updated_at TEXT`);
    // Las sesiones preexistentes nunca se han editado: su última escritura real
    // es el cierre, o la creación si siguen abiertas.
    await db.execAsync(
      `UPDATE sessions SET updated_at = COALESCE(closed_at, created_at) WHERE updated_at IS NULL`,
    );
  }
  if (!has('sync_status')) {
    // 'pending' a propósito: en el primer sync se suben TODAS las sesiones que
    // ya existían en el dispositivo (backfill del histórico).
    await db.execAsync(
      `ALTER TABLE sessions ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending'`,
    );
  }
  if (!has('deleted_at')) {
    await db.execAsync(`ALTER TABLE sessions ADD COLUMN deleted_at TEXT`);
  }
  if (!has('origin')) {
    await db.execAsync(`ALTER TABLE sessions ADD COLUMN origin TEXT NOT NULL DEFAULT 'local'`);
  }
}

async function migrate_v26(db: SQLite.SQLiteDatabase): Promise<void> {
  // Prepara `sessions` para el sync con el backend (ver tpv-sessions-sync-plan.md).
  // No borra ni modifica ningún dato existente más allá de rellenar los campos
  // nuevos: el histórico de sesiones del dispositivo queda intacto.
  await ensureSessionSyncColumns(db);

  // device_id llevaba existiendo desde v9 pero nadie lo rellenaba (insertSession
  // aceptaba el parámetro y ningún llamador lo pasaba). Todas las sesiones que ya
  // están en esta BD las abrió, por definición, ESTE dispositivo.
  try {
    const deviceId = await getDeviceId();
    await db.runAsync('UPDATE sessions SET device_id = ? WHERE device_id IS NULL', [deviceId]);
  } catch (e) {
    // Sin device_id el sync sigue funcionando; solo se pierde la atribución.
    // eslint-disable-next-line no-console
    console.log('[db] migrate_v26: no se pudo rellenar device_id', e);
  }
}

async function migrate_v27(db: SQLite.SQLiteDatabase): Promise<void> {
  // tickets.device_id: qué dispositivo creó la comanda. Necesario para que el nº
  // correlativo sea por (sesión, dispositivo) — así dos móviles que comparten una
  // sesión no generan la misma "COMANDA #3" — y para el prefijo de impresión.
  try {
    await db.execAsync(`ALTER TABLE tickets ADD COLUMN device_id TEXT`);
  } catch { /* ya existe */ }

  // Las comandas que ya están en esta BD las creó, por definición, este dispositivo.
  try {
    const deviceId = await getDeviceId();
    await db.runAsync('UPDATE tickets SET device_id = ? WHERE device_id IS NULL', [deviceId]);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('[db] migrate_v27: no se pudo rellenar device_id de tickets', e);
  }
}

async function migrate_v28(db: SQLite.SQLiteDatabase): Promise<void> {
  // Elimina la tabla sync_queue: era la cola offline de la Fase 1 (reintento local
  // de tickets/orders), superada por el sync por entidad (ticketsApi/sessionsApi…
  // orquestado en syncAll.ts). Nunca llegó a consumirse (nadie encolaba). En BDs
  // nuevas la crea migrate_v1 y esta migración la retira acto seguido; las
  // migraciones históricas v10/v16/v18 se conservan como registro (append-only).
  // IF EXISTS por defensa.
  await db.execAsync(`DROP TABLE IF EXISTS sync_queue`);
}

async function migrate_v29(db: SQLite.SQLiteDatabase): Promise<void> {
  // Tabla de presets de texto: mensajes del ticket del cliente (header/footer,
  // antes hardcodeados en escpos.ts) + batería de nombres. Solo el texto se
  // sincroniza; `enabled` y el modo de impresión son locales (ver plan §2).
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS text_presets (
      id           TEXT PRIMARY KEY,
      kind         TEXT NOT NULL,
      text         TEXT NOT NULL,
      slot         TEXT,
      enabled      INTEGER NOT NULL DEFAULT 1,
      sort_order   INTEGER NOT NULL DEFAULT 999,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      sync_status  TEXT NOT NULL DEFAULT 'pending',
      deleted_at   TEXT,
      origin       TEXT NOT NULL DEFAULT 'local'
    );
    CREATE INDEX IF NOT EXISTS idx_text_presets_kind ON text_presets(kind);
  `);
  await ensureTextPresetsSeed(db);
}

/**
 * Inserta la semilla de presets (INITIAL_TEXT_PRESETS) si aún no existen. Crea la
 * tabla si falta (self-heal). Idempotente: INSERT OR IGNORE por id, así que no
 * reintroduce presets que el usuario haya borrado (soft-delete conserva la fila).
 */
async function ensureTextPresetsSeed(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS text_presets (
      id           TEXT PRIMARY KEY,
      kind         TEXT NOT NULL,
      text         TEXT NOT NULL,
      slot         TEXT,
      enabled      INTEGER NOT NULL DEFAULT 1,
      sort_order   INTEGER NOT NULL DEFAULT 999,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      sync_status  TEXT NOT NULL DEFAULT 'pending',
      deleted_at   TEXT,
      origin       TEXT NOT NULL DEFAULT 'local'
    );
  `);
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const p of INITIAL_TEXT_PRESETS) {
      await txn.runAsync(
        `INSERT OR IGNORE INTO text_presets
           (id, kind, text, slot, enabled, sort_order, created_at, updated_at, sync_status, deleted_at, origin)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'pending', NULL, 'local')`,
        [p.id, p.kind, p.text, p.slot, p.sortOrder, now, now],
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

const DAY_ABBR_ES = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];

export function generateSessionCode(date: Date): string {
  const day = DAY_ABBR_ES[date.getDay()];
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}-${dd}${mm}`;
}

export function calculateAutoCloseAt(openedAt: Date): string {
  const next = new Date(openedAt);
  next.setDate(next.getDate() + 1);
  next.setHours(12, 0, 0, 0);
  return next.toISOString();
}

async function migrate_v3(db: SQLite.SQLiteDatabase): Promise<void> {
  // Re-seed products and modifiers with new order and BURGER NIÑO in 'custom' category
  await db.execAsync('PRAGMA foreign_keys = OFF');
  await db.runAsync('DELETE FROM modifiers');
  await db.runAsync('DELETE FROM products');
  await db.execAsync('PRAGMA foreign_keys = ON');

  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const p of INITIAL_PRODUCTS) {
      await txn.runAsync(
        'INSERT INTO products (id, name, base_price, category, is_custom, is_active, always_show_modifiers) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [p.id, p.name, p.basePrice, p.category, p.isCustom ? 1 : 0, p.isActive ? 1 : 0, p.alwaysShowModifiers ? 1 : 0],
      );
      for (const m of p.modifiers) {
        await txn.runAsync(
          'INSERT INTO modifiers (id, product_id, label, type, price_add, options, no_selection_label) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [`${p.id}-${m.id}`, p.id, m.label, m.type, m.priceAdd ?? 0, JSON.stringify(m.options ?? []), m.noSelectionLabel ?? null],
        );
      }
    }
  });
}

async function seedInitialData(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.withExclusiveTransactionAsync(async (txn) => {
    // Default location
    const locationId = generateId();
    await txn.runAsync(
      'INSERT INTO locations (id, name, is_default, created_at) VALUES (?, ?, 1, ?)',
      [locationId, DEFAULT_LOCATION_NAME, new Date().toISOString()],
    );

    // Products
    for (const p of INITIAL_PRODUCTS) {
      await txn.runAsync(
        'INSERT INTO products (id, name, base_price, category, is_custom, is_active, always_show_modifiers) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [p.id, p.name, p.basePrice, p.category, p.isCustom ? 1 : 0, p.isActive ? 1 : 0, p.alwaysShowModifiers ? 1 : 0],
      );
    }

    // Modifiers — use product-scoped id to avoid duplicates across shared modifier lists
    for (const p of INITIAL_PRODUCTS) {
      for (const m of p.modifiers) {
        await txn.runAsync(
          'INSERT INTO modifiers (id, product_id, label, type, price_add, options, no_selection_label, section, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [`${p.id}-${m.id}`, p.id, m.label, m.type, m.priceAdd ?? 0, JSON.stringify(m.options ?? []), m.noSelectionLabel ?? null, m.section ?? null, m.order ?? 999],
        );
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

type LocationRow = {
  id: string;
  name: string;
  is_default: number;
  created_at: string;
};

type SessionRow = {
  id: string;
  location_id: string;
  date: string;
  status: string;
  price_overrides: string;
  created_at: string;
  session_code: string | null;
  opened_at: string | null;
  auto_close_at: string | null;
  closed_at: string | null;
  device_id: string | null;
  // Columnas de sync (v26). Nullable en el tipo porque una BD a medio migrar
  // puede devolverlas vacías; mapSession aplica los valores por defecto.
  notes: string | null;
  updated_at: string | null;
  sync_status: string | null;
  deleted_at: string | null;
  origin: string | null;
};

type ProductRow = {
  id: string;
  name: string;
  base_price: number;
  category: string;
  category_order: number | null;
  profile: string | null;
  is_custom: number;
  is_active: number;
  always_show_modifiers: number;
};

type ModifierRow = {
  id: string;
  product_id: string;
  label: string;
  type: string;
  price_add: number;
  options: string;
  no_selection_label: string | null;
  section: string | null;
  sort_order: number;
};

type TicketRow = {
  id: string;
  session_id: string;
  ticket_number: number;
  device_id: string | null;
  printed_at: string | null;
  sync_status: string;
  created_at: string;
  edited_at: string | null;
  edit_count: number;
};

type OrderRow = {
  id: string;
  ticket_id: string;
  client_name: string;
  price_profile: string;
  take_away: number | null;
  amount_paid: number | null;
  change: number | null;
  total: number;
  created_at: string;
};

type OrderItemRow = {
  id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  qty: number;
  unit_price: number;
  modifier_price_add: number;
  selected_modifiers: string;
  custom_label: string | null;
};

function mapLocation(row: LocationRow): Location {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
  };
}

function mapSession(row: SessionRow): Session {
  return {
    id: row.id,
    locationId: row.location_id,
    date: row.date,
    status: row.status as Session['status'],
    priceOverrides: JSON.parse(row.price_overrides) as Record<string, number>,
    createdAt: row.created_at,
    sessionCode: row.session_code ?? null,
    openedAt: row.opened_at ?? null,
    autoCloseAt: row.auto_close_at ?? null,
    closedAt: row.closed_at ?? null,
    deviceId: row.device_id ?? null,
    notes: row.notes ?? null,
    updatedAt: row.updated_at ?? row.created_at,
    syncStatus: (row.sync_status as SyncStatus | null) ?? 'pending',
    deletedAt: row.deleted_at ?? null,
    origin: row.origin === 'remote' ? 'remote' : 'local',
  };
}

function mapProduct(row: ProductRow, modifiers: Modifier[]): Product {
  return {
    id: row.id,
    name: row.name,
    basePrice: row.base_price,
    category: row.category,
    categoryOrder: row.category_order ?? undefined,
    profile: (row.profile ?? 'burger') as Product['profile'],
    modifiers,
    isCustom: row.is_custom === 1,
    isActive: row.is_active === 1,
    alwaysShowModifiers: row.always_show_modifiers === 1,
  };
}

function mapModifier(row: ModifierRow): Modifier {
  return {
    id: row.id,
    label: row.label,
    type: row.type as Modifier['type'],
    priceAdd: row.price_add !== 0 ? row.price_add : undefined,
    options: JSON.parse(row.options),
    noSelectionLabel: row.no_selection_label ?? undefined,
    section: (row.section ?? undefined) as Modifier['section'],
    order: row.sort_order,
  };
}

function mapTicket(row: TicketRow, orders: Order[]): Ticket {
  return {
    id: row.id,
    sessionId: row.session_id,
    ticketNumber: row.ticket_number,
    deviceId: row.device_id ?? null,
    orders,
    printedAt: row.printed_at,
    syncStatus: row.sync_status as SyncStatus,
    createdAt: row.created_at,
    editedAt: row.edited_at ?? null,
    editCount: row.edit_count ?? 0,
  };
}

function mapOrder(row: OrderRow, items: OrderItem[]): Order {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    clientName: row.client_name,
    priceProfile: (row.price_profile ?? 'normal') as PriceProfile,
    takeAway: (row.take_away ?? 0) === 1,
    items,
    amountPaid: row.amount_paid,
    change: row.change,
    total: row.total,
    createdAt: row.created_at,
  };
}

function mapOrderItem(row: OrderItemRow): OrderItem {
  return {
    id: row.id,
    orderId: row.order_id,
    productId: row.product_id,
    productName: row.product_name,
    qty: row.qty,
    unitPrice: row.unit_price,
    modifierPriceAdd: row.modifier_price_add ?? 0,
    selectedModifiers: JSON.parse(row.selected_modifiers) as string[],
    customLabel: row.custom_label,
  };
}

// ---------------------------------------------------------------------------
// LOCATIONS
// ---------------------------------------------------------------------------

export async function getLocations(): Promise<Location[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<LocationRow>('SELECT * FROM locations ORDER BY is_default DESC, name ASC');
  return rows.map(mapLocation);
}

export async function getDefaultLocation(): Promise<Location | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<LocationRow>('SELECT * FROM locations WHERE is_default = 1 LIMIT 1');
  return row ? mapLocation(row) : null;
}

export async function insertLocation(name: string, isDefault: boolean): Promise<Location> {
  const db = await getDb();
  const location: Location = {
    id: generateId(),
    name,
    isDefault,
    createdAt: new Date().toISOString(),
  };
  await db.runAsync(
    'INSERT INTO locations (id, name, is_default, created_at) VALUES (?, ?, ?, ?)',
    [location.id, location.name, location.isDefault ? 1 : 0, location.createdAt],
  );
  return location;
}

export async function updateLocation(id: string, name: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE locations SET name = ? WHERE id = ?', [name, id]);
}

/**
 * Fusiona las ubicaciones recibidas del backend con las locales.
 * Actualiza nombre e is_default de las existentes (por id) e inserta las nuevas.
 * No borra ubicaciones locales que el backend desconozca (offline-first).
 */
export async function upsertLocationsFromBackend(locations: ApiLocation[]): Promise<void> {
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const loc of locations) {
      const existing = await txn.getFirstAsync<{ id: string }>(
        'SELECT id FROM locations WHERE id = ?',
        [loc.id],
      );
      if (existing) {
        await txn.runAsync(
          'UPDATE locations SET name = ?, is_default = ? WHERE id = ?',
          [loc.name, loc.isDefault ? 1 : 0, loc.id],
        );
      } else {
        await txn.runAsync(
          'INSERT INTO locations (id, name, is_default, created_at) VALUES (?, ?, ?, ?)',
          [loc.id, loc.name, loc.isDefault ? 1 : 0, loc.createdAt || new Date().toISOString()],
        );
      }
    }
  });
}

// ---------------------------------------------------------------------------
// SESSIONS
// ---------------------------------------------------------------------------

// Toda escritura local sobre una sesión deja rastro para el sync: nuevo
// `updated_at` (árbitro del last-write-wins) y `sync_status='pending'`.
const TOUCH_SYNC = `updated_at = ?, sync_status = 'pending'`;

/**
 * Filtro SQL de "sesiones de este dispositivo". `device_id IS NULL` cuenta como
 * propia: solo puede serlo una fila anterior a v26 cuyo backfill no llegó a
 * ejecutarse (una sesión remota SIEMPRE trae device_id y origin='remote').
 */
const OWN_SESSION_SQL = `origin = 'local' AND (device_id IS NULL OR device_id = ?)`;

export async function getSessionByDate(locationId: string, date: string): Promise<Session | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<SessionRow>(
    'SELECT * FROM sessions WHERE location_id = ? AND date = ? AND deleted_at IS NULL LIMIT 1',
    [locationId, date],
  );
  return row ? mapSession(row) : null;
}

export async function getOpenSession(locationId: string): Promise<Session | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<SessionRow>(
    `SELECT * FROM sessions
      WHERE location_id = ? AND status = 'open' AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [locationId],
  );
  return row ? mapSession(row) : null;
}

export async function insertSession(locationId: string, priceOverrides: Record<string, number> = {}, deviceId?: string): Promise<Session> {
  const db = await getDb();
  const now = new Date();
  const baseCode = generateSessionCode(now);
  const countRow = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) as n FROM sessions WHERE session_code = ? OR session_code LIKE ?",
    [baseCode, baseCode + '-%'],
  );
  const count = countRow?.n ?? 0;
  const sessionCode = count === 0 ? baseCode : `${baseCode}-${count + 1}`;
  const session: Session = {
    id: generateId(),
    locationId,
    date: todayISO(),
    status: 'open',
    priceOverrides,
    createdAt: now.toISOString(),
    sessionCode,
    openedAt: now.toISOString(),
    autoCloseAt: calculateAutoCloseAt(now),
    closedAt: null,
    // Sin deviceId explícito, el de este dispositivo: es quien la está abriendo.
    deviceId: deviceId ?? await getDeviceId(),
    notes: null,
    updatedAt: now.toISOString(),
    syncStatus: 'pending',
    deletedAt: null,
    origin: 'local',
  };
  await db.runAsync(
    `INSERT INTO sessions
       (id, location_id, date, status, price_overrides, created_at,
        session_code, opened_at, auto_close_at, closed_at, device_id,
        notes, updated_at, sync_status, deleted_at, origin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      session.id, session.locationId, session.date, session.status,
      JSON.stringify(session.priceOverrides), session.createdAt,
      session.sessionCode, session.openedAt, session.autoCloseAt,
      session.closedAt, session.deviceId,
      session.notes, session.updatedAt, session.syncStatus, session.deletedAt, session.origin,
    ],
  );
  return session;
}

export async function closeSession(id: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE sessions SET status = 'closed', closed_at = ?, ${TOUCH_SYNC} WHERE id = ?`,
    [now, now, id],
  );
}

/**
 * Returns the current active session if it's still within its valid window.
 *
 * Solo puede ser activa una sesión ABIERTA POR ESTE DISPOSITIVO: las sesiones
 * que llegan del backend (origin='remote') se ven y se editan, pero nunca se
 * adoptan como sesión de venta — si no, este TPV numeraría tickets dentro de la
 * jornada de otro móvil.
 *
 * Las sesiones propias ya expiradas se cierran TODAS de una pasada (no solo la
 * más reciente): de lo contrario una antigua quedaría 'open' para siempre,
 * invisible en el historial y bloqueando su sync como jornada sin cerrar.
 */
export async function getActiveSession(): Promise<Session | null> {
  const db = await getDb();
  const now = new Date().toISOString();
  const deviceId = await getDeviceId();

  // Cierre masivo de las propias expiradas. Si falla, seguimos: la consulta de
  // abajo aún puede devolver una sesión válida y se reintenta en la próxima llamada.
  try {
    await db.runAsync(
      `UPDATE sessions
          SET status = 'closed', closed_at = COALESCE(auto_close_at, ?), ${TOUCH_SYNC}
        WHERE status = 'open' AND deleted_at IS NULL
          AND auto_close_at IS NOT NULL AND auto_close_at <= ?
          AND ${OWN_SESSION_SQL}`,
      [now, now, now, deviceId],
    );
  } catch {
    // ignorado a propósito — ver comentario
  }

  const row = await db.getFirstAsync<SessionRow>(
    `SELECT * FROM sessions
      WHERE status = 'open' AND deleted_at IS NULL AND ${OWN_SESSION_SQL}
      ORDER BY opened_at DESC LIMIT 1`,
    [deviceId],
  );
  if (!row) return null;

  const session = mapSession(row);

  // Red de seguridad por si el UPDATE masivo no llegó a aplicarse.
  if (session.autoCloseAt && session.autoCloseAt <= now) {
    try {
      await closeSession(session.id);
    } catch {
      return session;
    }
    return null;
  }

  return session;
}

/** Sesiones visibles (no borradas), propias y de otros dispositivos. */
export async function getSessions(locationId?: string): Promise<Session[]> {
  const db = await getDb();
  const rows = locationId
    ? await db.getAllAsync<SessionRow>(
        `SELECT * FROM sessions WHERE location_id = ? AND deleted_at IS NULL
         ORDER BY COALESCE(opened_at, created_at) DESC`,
        [locationId],
      )
    : await db.getAllAsync<SessionRow>(
        `SELECT * FROM sessions WHERE deleted_at IS NULL
         ORDER BY COALESCE(opened_at, created_at) DESC`,
      );
  return rows.map(mapSession);
}

export async function getSessionById(id: string): Promise<Session | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<SessionRow>('SELECT * FROM sessions WHERE id = ? LIMIT 1', [id]);
  return row ? mapSession(row) : null;
}

export async function updateSessionPriceOverrides(id: string, overrides: Record<string, number>): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE sessions SET price_overrides = ?, ${TOUCH_SYNC} WHERE id = ?`,
    [JSON.stringify(overrides), new Date().toISOString(), id],
  );
}

/** Comentario libre de la jornada. `null` borra la nota. */
export async function updateSessionNotes(id: string, notes: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE sessions SET notes = ?, ${TOUCH_SYNC} WHERE id = ?`,
    [notes, new Date().toISOString(), id],
  );
}

export async function updateSessionLocation(id: string, locationId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE sessions SET location_id = ?, ${TOUCH_SYNC} WHERE id = ?`,
    [locationId, new Date().toISOString(), id],
  );
}

/**
 * Soft delete: la fila y sus tickets permanecen en la BD, solo dejan de listarse.
 * Queda `pending` para propagar el borrado al backend en el próximo sync.
 */
export async function softDeleteSession(id: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE sessions SET deleted_at = ?, ${TOUCH_SYNC} WHERE id = ?`,
    [now, now, id],
  );
}

/**
 * Adopta una sesión (típicamente remota, de otro dispositivo) como sesión activa
 * de ESTE dispositivo: marca `origin='local'` para que `getActiveSession` la
 * recupere. No cambia `device_id` (quién la abrió) ni la sube: solo cambia a
 * quién pertenece la jornada activa en este TPV. Usado al "unirse" a una sesión
 * abierta en otro dispositivo (Fase 5). Idempotente.
 */
export async function adoptSessionAsLocal(sessionId: string): Promise<void> {
  const db = await getDb();
  // No marcamos pending: adoptar no cambia el dato de la sesión, solo su origin
  // local. El backend no necesita enterarse de que este dispositivo la trabaja.
  await db.runAsync(
    "UPDATE sessions SET origin = 'local', deleted_at = NULL WHERE id = ?",
    [sessionId],
  );
}

/** Concatena la nota de la sesión absorbida bajo la de destino. `null` si ambas vacías. */
function mergeNotes(target: string | null, source: string | null): string | null {
  const a = (target ?? '').trim();
  const b = (source ?? '').trim();
  if (a === '' && b === '') return null;
  if (b === '') return a;
  if (a === '') return b;
  return `${a}\n${b}`;
}

/**
 * Fusiona `sourceId` dentro de `targetId`: la sesión de destino sobrevive y
 * absorbe todos los tickets de la origen; la origen queda borrada (soft delete).
 *
 * - Los tickets de la origen se reasignan a la de destino y se **renumeran**
 *   correlativamente a partir del último nº de la destino (no hay índice único,
 *   pero así los nº quedan limpios y sin colisiones). Sus orders / order_items
 *   cuelgan del ticket, así que se mueven con él sin tocar nada más.
 * - Las notas se concatenan; los precios de sesión de la destino se conservan
 *   (son jornadas cerradas: ya no generan ventas nuevas).
 * - Ambas sesiones y los tickets movidos quedan `pending` para propagarse en el
 *   próximo sync. Todo va en una única transacción: o se fusiona entero o nada.
 *
 * El llamador debe garantizar que ambas están cerradas y no borradas
 * (la UI solo ofrece sesiones cerradas). Lanza si se pasa el mismo id dos veces.
 */
export async function mergeSessions(targetId: string, sourceId: string): Promise<void> {
  if (targetId === sourceId) throw new Error('No se puede fusionar una sesión consigo misma');
  const db = await getDb();
  const now = new Date().toISOString();

  await db.withExclusiveTransactionAsync(async (txn) => {
    const maxRow = await txn.getFirstAsync<{ max_num: number | null }>(
      'SELECT MAX(ticket_number) AS max_num FROM tickets WHERE session_id = ?',
      [targetId],
    );
    let next = (maxRow?.max_num ?? 0) + 1;

    const srcTickets = await txn.getAllAsync<{ id: string }>(
      'SELECT id FROM tickets WHERE session_id = ? ORDER BY ticket_number ASC',
      [sourceId],
    );
    for (const t of srcTickets) {
      // IMPORTANTE: subir edit_count. El sync de comandas es idempotente por
      // edit_count; sin incrementarlo, el backend vería 'duplicate' y la
      // reasignación de session_id NO se propagaría (ver ticketsApi / SyncService).
      await txn.runAsync(
        "UPDATE tickets SET session_id = ?, ticket_number = ?, edited_at = ?, edit_count = edit_count + 1, sync_status = 'pending' WHERE id = ?",
        [targetId, next, now, t.id],
      );
      next += 1;
    }

    const notesRow = await txn.getAllAsync<{ id: string; notes: string | null }>(
      'SELECT id, notes FROM sessions WHERE id IN (?, ?)',
      [targetId, sourceId],
    );
    const targetNotes = notesRow.find((r) => r.id === targetId)?.notes ?? null;
    const sourceNotes = notesRow.find((r) => r.id === sourceId)?.notes ?? null;

    await txn.runAsync(
      `UPDATE sessions SET notes = ?, ${TOUCH_SYNC} WHERE id = ?`,
      [mergeNotes(targetNotes, sourceNotes), now, targetId],
    );
    await txn.runAsync(
      `UPDATE sessions SET deleted_at = ?, ${TOUCH_SYNC} WHERE id = ?`,
      [now, now, sourceId],
    );
  });
}

export async function getSessionByCode(code: string): Promise<Session | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<SessionRow>(
    'SELECT * FROM sessions WHERE session_code = ? AND deleted_at IS NULL LIMIT 1',
    [code],
  );
  return row ? mapSession(row) : null;
}

// ── soporte para el sync de sesiones (ver services/sessionsApi.ts) ──────────

/** Sesiones con cambios locales sin confirmar por el backend (incluye borradas). */
export async function getUnsyncedSessions(): Promise<Session[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SessionRow>(
    `SELECT * FROM sessions WHERE sync_status != 'synced'
     ORDER BY COALESCE(opened_at, created_at) ASC`,
  );
  return rows.map(mapSession);
}

/**
 * Marca como sincronizadas las sesiones confirmadas por el backend, PERO solo si
 * no han vuelto a cambiar entre medias: si `updated_at` ya no es el que se
 * envió, la fila sigue `pending` y se reintenta en la próxima pasada.
 */
export async function markSessionsSynced(
  confirmed: Array<{ id: string; updatedAt: string }>,
): Promise<void> {
  if (confirmed.length === 0) return;
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const { id, updatedAt } of confirmed) {
      await txn.runAsync(
        "UPDATE sessions SET sync_status = 'synced' WHERE id = ? AND updated_at = ?",
        [id, updatedAt],
      );
    }
  });
}

/**
 * Fusiona en SQLite las sesiones bajadas del backend. **Nunca borra filas ni
 * pisa cambios locales sin sincronizar**:
 *
 *  - Sesión desconocida  → INSERT. `origin` es 'local' solo si la abrió este
 *    mismo dispositivo (caso reinstalación: se recupera su propia jornada).
 *  - Sesión con cambios locales pendientes (`sync_status != 'synced'`) → se
 *    ignora lo remoto; el push de esta misma pasada ya la ha subido.
 *  - Resto → gana la escritura más reciente comparando `updatedAt` como
 *    instante (no como texto: local trae milisegundos y el backend no).
 *
 * Devuelve cuántas filas se insertaron o actualizaron realmente.
 */
export async function upsertSessionsFromBackend(remotes: ApiSession[]): Promise<number> {
  if (remotes.length === 0) return 0;
  const db = await getDb();
  const deviceId = await getDeviceId();
  let applied = 0;

  for (const r of remotes) {
    const existing = await db.getFirstAsync<SessionRow>(
      'SELECT * FROM sessions WHERE id = ? LIMIT 1',
      [r.id],
    );
    const overrides = JSON.stringify(r.priceOverrides ?? {});

    if (!existing) {
      // locationId nulo: el backend crea sesiones mínimas durante el sync de
      // pedidos. Sin ubicación no se puede listar bien, así que se descarta.
      if (!r.locationId) continue;
      await db.runAsync(
        `INSERT INTO sessions
           (id, location_id, date, status, price_overrides, created_at,
            session_code, opened_at, auto_close_at, closed_at, device_id,
            notes, updated_at, sync_status, deleted_at, origin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?)`,
        [
          r.id, r.locationId, r.date, r.status, overrides, r.createdAt,
          r.sessionCode, r.openedAt, r.autoCloseAt, r.closedAt, r.deviceId,
          r.notes, r.updatedAt ?? r.createdAt, r.deletedAt,
          r.deviceId && r.deviceId === deviceId ? 'local' : 'remote',
        ],
      );
      applied++;
      continue;
    }

    const local = mapSession(existing);
    if (local.syncStatus !== 'synced') continue;

    const remoteAt = Date.parse(r.updatedAt ?? r.createdAt);
    const localAt = Date.parse(local.updatedAt);
    if (!Number.isFinite(remoteAt) || remoteAt <= localAt) continue;

    await db.runAsync(
      `UPDATE sessions
          SET location_id = COALESCE(?, location_id),
              date = ?, status = ?, price_overrides = ?,
              session_code = ?, opened_at = ?, auto_close_at = ?, closed_at = ?,
              device_id = COALESCE(?, device_id),
              notes = ?, updated_at = ?, deleted_at = ?, sync_status = 'synced'
        WHERE id = ?`,
      [
        r.locationId, r.date, r.status, overrides,
        r.sessionCode, r.openedAt, r.autoCloseAt, r.closedAt,
        r.deviceId, r.notes, r.updatedAt ?? r.createdAt, r.deletedAt, r.id,
      ],
    );
    applied++;
  }

  return applied;
}

/**
 * Marca las sesiones que el backend rechazó. Siguen entrando en
 * `getUnsyncedSessions` (se reintentan); el estado 'error' es solo para que la
 * UI pueda señalarlas. Misma guarda de `updated_at` que `markSessionsSynced`.
 */
export async function markSessionsSyncError(
  failed: Array<{ id: string; updatedAt: string }>,
): Promise<void> {
  if (failed.length === 0) return;
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const { id, updatedAt } of failed) {
      await txn.runAsync(
        "UPDATE sessions SET sync_status = 'error' WHERE id = ? AND updated_at = ?",
        [id, updatedAt],
      );
    }
  });
}

// ---------------------------------------------------------------------------
// TEXT PRESETS (mensajes de ticket + batería de nombres)
// ---------------------------------------------------------------------------

type TextPresetRow = {
  id: string;
  kind: string;
  text: string;
  slot: string | null;
  enabled: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  sync_status: string;
  deleted_at: string | null;
  origin: string;
};

function mapTextPreset(row: TextPresetRow): TextPreset {
  return {
    id: row.id,
    kind: row.kind as TextPresetKind,
    text: row.text,
    slot: (row.slot ?? null) as TicketSlot | null,
    enabled: row.enabled === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status as SyncStatus,
    deletedAt: row.deleted_at ?? null,
    origin: (row.origin as TextPreset['origin']) ?? 'local',
  };
}

/** Todos los presets NO borrados, ordenados por sortOrder dentro de su grupo. */
export async function getTextPresets(): Promise<TextPreset[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<TextPresetRow>(
    `SELECT * FROM text_presets WHERE deleted_at IS NULL
     ORDER BY sort_order ASC, created_at ASC`,
  );
  return rows.map(mapTextPreset);
}

/** Alta de un preset. Queda 'pending' para el próximo push. */
export async function insertTextPreset(params: {
  kind: TextPresetKind;
  text: string;
  slot: TicketSlot | null;
}): Promise<TextPreset> {
  const db = await getDb();
  const now = new Date().toISOString();
  const id = generateId();
  // sortOrder al final dentro de su kind/slot (slot IS ? cubre también NULL).
  const maxRow = await db.getFirstAsync<{ m: number | null }>(
    `SELECT MAX(sort_order) as m FROM text_presets WHERE kind = ? AND slot IS ?`,
    [params.kind, params.slot],
  );
  const sortOrder = (maxRow?.m ?? 0) + 1;
  await db.runAsync(
    `INSERT INTO text_presets
       (id, kind, text, slot, enabled, sort_order, created_at, updated_at, sync_status, deleted_at, origin)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'pending', NULL, 'local')`,
    [id, params.kind, params.text, params.slot, sortOrder, now, now],
  );
  return {
    id, kind: params.kind, text: params.text, slot: params.slot,
    enabled: true, sortOrder, createdAt: now, updatedAt: now,
    syncStatus: 'pending', deletedAt: null, origin: 'local',
  };
}

/** Edita el texto. Bump updated_at + 'pending' (necesita push). */
export async function updateTextPresetText(id: string, text: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE text_presets SET text = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
    [text, now, id],
  );
}

/**
 * Activa/desactiva un preset. LOCAL: NO cambia updated_at ni sync_status (el
 * `enabled` no viaja al backend). Ver plan §2.
 */
export async function setTextPresetEnabled(id: string, enabled: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE text_presets SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
}

/** Soft delete. Bump updated_at + 'pending' para propagar el borrado. */
export async function softDeleteTextPreset(id: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE text_presets SET deleted_at = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
    [now, now, id],
  );
}

// ── sync support (services/textPresetsApi.ts) ───────────────────────────────

/** Presets con cambios locales sin confirmar por el backend (incluye borrados). */
export async function getUnsyncedTextPresets(): Promise<TextPreset[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<TextPresetRow>(
    `SELECT * FROM text_presets WHERE sync_status != 'synced' ORDER BY created_at ASC`,
  );
  return rows.map(mapTextPreset);
}

export async function markTextPresetsSynced(
  confirmed: Array<{ id: string; updatedAt: string }>,
): Promise<void> {
  if (confirmed.length === 0) return;
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const { id, updatedAt } of confirmed) {
      await txn.runAsync(
        "UPDATE text_presets SET sync_status = 'synced' WHERE id = ? AND updated_at = ?",
        [id, updatedAt],
      );
    }
  });
}

export async function markTextPresetsSyncError(
  failed: Array<{ id: string; updatedAt: string }>,
): Promise<void> {
  if (failed.length === 0) return;
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const { id, updatedAt } of failed) {
      await txn.runAsync(
        "UPDATE text_presets SET sync_status = 'error' WHERE id = ? AND updated_at = ?",
        [id, updatedAt],
      );
    }
  });
}

/**
 * Fusiona en SQLite los presets bajados del backend. **Nunca toca `enabled`**
 * (es local) ni pisa filas con cambios locales pendientes. LWW por updatedAt
 * (instante). Un preset nuevo entra enabled=1 (opt-out). Devuelve cuántas filas
 * se insertaron o actualizaron.
 */
export async function upsertTextPresetsFromBackend(remotes: ApiTextPreset[]): Promise<number> {
  if (remotes.length === 0) return 0;
  const db = await getDb();
  let applied = 0;
  for (const r of remotes) {
    const existing = await db.getFirstAsync<TextPresetRow>(
      'SELECT * FROM text_presets WHERE id = ? LIMIT 1', [r.id],
    );
    if (!existing) {
      await db.runAsync(
        `INSERT INTO text_presets
           (id, kind, text, slot, enabled, sort_order, created_at, updated_at, sync_status, deleted_at, origin)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'synced', ?, 'remote')`,
        [r.id, r.kind, r.text, r.slot, r.sortOrder, r.createdAt, r.updatedAt ?? r.createdAt, r.deletedAt],
      );
      applied++;
      continue;
    }
    const local = mapTextPreset(existing);
    if (local.syncStatus !== 'synced') continue; // cambios locales pendientes: manda el push
    const remoteAt = Date.parse(r.updatedAt ?? r.createdAt);
    const localAt = Date.parse(local.updatedAt);
    if (!Number.isFinite(remoteAt) || remoteAt <= localAt) continue;
    // Actualiza el contenido SIN tocar `enabled` (columna local).
    await db.runAsync(
      `UPDATE text_presets
          SET kind = ?, text = ?, slot = ?, sort_order = ?, updated_at = ?, deleted_at = ?, sync_status = 'synced'
        WHERE id = ?`,
      [r.kind, r.text, r.slot, r.sortOrder, r.updatedAt ?? r.createdAt, r.deletedAt, r.id],
    );
    applied++;
  }
  return applied;
}

// ---------------------------------------------------------------------------
// PRODUCTS
// ---------------------------------------------------------------------------

export async function getProducts(): Promise<Product[]> {
  const db = await getDb();
  const productRows = await db.getAllAsync<ProductRow>('SELECT * FROM products WHERE is_active = 1 ORDER BY rowid ASC');
  const modifierRows = await db.getAllAsync<ModifierRow>('SELECT * FROM modifiers');

  return productRows.map((p) => {
    const mods = modifierRows
      .filter((m) => m.product_id === p.id)
      .map(mapModifier);
    return mapProduct(p, mods);
  });
}

/**
 * Como getProducts() pero SIN el filtro is_active: devuelve TODOS los productos
 * locales (activos e inactivos). Se usa para calcular qué productos desaparecen
 * en una sincronización de catálogo (el reemplazo borra activos e inactivos por
 * igual), y para reinsertar los "supervivientes" que el usuario decida conservar.
 */
export async function getAllLocalProducts(): Promise<Product[]> {
  const db = await getDb();
  const productRows = await db.getAllAsync<ProductRow>('SELECT * FROM products ORDER BY rowid ASC');
  const modifierRows = await db.getAllAsync<ModifierRow>('SELECT * FROM modifiers');

  return productRows.map((p) => {
    const mods = modifierRows
      .filter((m) => m.product_id === p.id)
      .map(mapModifier);
    return mapProduct(p, mods);
  });
}

export async function getProductById(id: string): Promise<Product | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<ProductRow>('SELECT * FROM products WHERE id = ?', [id]);
  if (!row) return null;
  const modifierRows = await db.getAllAsync<ModifierRow>('SELECT * FROM modifiers WHERE product_id = ?', [id]);
  return mapProduct(row, modifierRows.map(mapModifier));
}

export async function insertProduct(product: Omit<Product, 'modifiers'>): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO products (id, name, base_price, category, category_order, profile, is_custom, is_active, always_show_modifiers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [product.id, product.name, product.basePrice, product.category, product.categoryOrder ?? null, product.profile ?? 'burger', product.isCustom ? 1 : 0, product.isActive ? 1 : 0, product.alwaysShowModifiers ? 1 : 0],
  );
}

export async function updateProductActive(id: string, isActive: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE products SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, id]);
}

export async function updateProductBasePrice(id: string, basePrice: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE products SET base_price = ? WHERE id = ?', [basePrice, id]);
}

/**
 * Reemplaza TODO el catálogo local de products + modifiers con el recibido del
 * backend, en una sola transacción. No toca tickets/orders/order_items.
 *
 * - Reemplazo total (no merge): más simple y robusto para un catálogo pequeño.
 * - Los modifiers se insertan con id scopeado `${productId}-${modifier.id}`,
 *   igual que el seed local (INITIAL_MODIFIERS) — así ESC/POS, etiquetas y
 *   order_items.selected_modifiers siguen resolviéndose igual.
 * - Se inserta respetando `sortOrder` (rowid creciente) para conservar el orden
 *   del grid, ya que getProducts() ordena por rowid.
 * - Si la transacción falla, SQLite hace rollback → el catálogo anterior queda
 *   intacto. La función relanza el error para que el llamador muestre feedback.
 */
export async function replaceProductCatalog(products: ApiProduct[]): Promise<void> {
  return replaceProductCatalogKeeping(products, []);
}

/**
 * Igual que replaceProductCatalog pero, además del catálogo del backend, vuelve a
 * insertar los productos locales `survivors` que el usuario decidió conservar
 * aunque el backend ya no los traiga (red de seguridad contra borrados por
 * sincronización — ver syncCatalogTask).
 *
 * Los supervivientes se insertan DESPUÉS de los del backend (rowid mayor → quedan
 * al final del grid). Es un caso raro (solo productos que el backend eliminó pero
 * el usuario quiere mantener), así que ese orden secundario es aceptable.
 *
 * CLAVE: los modifiers de un `survivor` ya llevan su id de BD scopeado
 * (`${productId}-${modifierId}`, tal y como los devuelve getAllLocalProducts) —
 * se reinsertan TAL CUAL, sin volver a prefijar, a diferencia de los del backend.
 */
export async function replaceProductCatalogKeeping(
  products: ApiProduct[],
  survivors: Product[],
): Promise<void> {
  const db = await getDb();

  // Ordenar por sortOrder para que el rowid de inserción marque el orden del grid.
  const ordered = [...products].sort(
    (a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999),
  );

  await db.execAsync('PRAGMA foreign_keys = OFF');
  await db.runAsync('DELETE FROM modifiers');
  await db.runAsync('DELETE FROM products');
  await db.execAsync('PRAGMA foreign_keys = ON');

  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const p of ordered) {
      await txn.runAsync(
        'INSERT INTO products (id, name, base_price, category, category_order, profile, is_custom, is_active, always_show_modifiers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          p.id,
          p.name,
          typeof p.basePrice === 'number' ? p.basePrice : parseFloat(String(p.basePrice)) || 0,
          p.category,
          p.categoryOrder ?? null,
          p.profile ?? 'burger',
          p.isCustom ? 1 : 0,
          p.isActive ? 1 : 0,
          p.alwaysShowModifiers ? 1 : 0,
        ],
      );
      for (const m of p.modifiers ?? []) {
        const priceAdd = typeof m.priceAdd === 'number'
          ? m.priceAdd
          : m.priceAdd != null ? parseFloat(String(m.priceAdd)) || 0 : 0;
        await txn.runAsync(
          'INSERT INTO modifiers (id, product_id, label, type, price_add, options, no_selection_label, section, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            `${p.id}-${m.id}`,
            p.id,
            m.label,
            m.type,
            priceAdd,
            JSON.stringify(m.options ?? []),
            m.noSelectionLabel ?? null,
            m.section ?? null,
            m.sortOrder ?? 999,
          ],
        );
      }
    }

    // Supervivientes: productos locales que el backend ya no trae pero el usuario
    // conserva. Su id de modifier ya viene scopeado → se inserta sin re-prefijar.
    for (const s of survivors) {
      await txn.runAsync(
        'INSERT INTO products (id, name, base_price, category, category_order, profile, is_custom, is_active, always_show_modifiers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          s.id,
          s.name,
          s.basePrice,
          s.category,
          s.categoryOrder ?? null,
          s.profile ?? 'burger',
          s.isCustom ? 1 : 0,
          s.isActive ? 1 : 0,
          s.alwaysShowModifiers ? 1 : 0,
        ],
      );
      for (const m of s.modifiers ?? []) {
        await txn.runAsync(
          'INSERT INTO modifiers (id, product_id, label, type, price_add, options, no_selection_label, section, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            m.id,
            s.id,
            m.label,
            m.type,
            m.priceAdd ?? 0,
            JSON.stringify(m.options ?? []),
            m.noSelectionLabel ?? null,
            m.section ?? null,
            m.order ?? 999,
          ],
        );
      }
    }
  });
}

// ---------------------------------------------------------------------------
// TICKETS
// ---------------------------------------------------------------------------

/**
 * Siguiente nº de comanda de ESTE dispositivo dentro de la sesión.
 * El correlativo es por (sesión, dispositivo): si dos móviles comparten sesión,
 * cada uno numera de forma independiente y el prefijo de dispositivo (impresión)
 * los distingue. Sin `deviceId` usa el de este dispositivo.
 */
export async function getNextTicketNumber(sessionId: string, deviceId?: string): Promise<number> {
  const db = await getDb();
  const dev = deviceId ?? await getDeviceId();
  const row = await db.getFirstAsync<{ max_num: number | null }>(
    'SELECT MAX(ticket_number) AS max_num FROM tickets WHERE session_id = ? AND (device_id IS NULL OR device_id = ?)',
    [sessionId, dev],
  );
  return (row?.max_num ?? 0) + 1;
}

export async function insertTicket(sessionId: string, ticketNumber: number): Promise<Ticket> {
  const t0 = Date.now();
  const db = await getDb();
  const ticket: Ticket = {
    id: generateId(),
    sessionId,
    ticketNumber,
    deviceId: await getDeviceId(),
    orders: [],
    printedAt: null,
    syncStatus: 'pending',
    createdAt: new Date().toISOString(),
    editedAt: null,
    editCount: 0,
  };
  await db.runAsync(
    'INSERT INTO tickets (id, session_id, ticket_number, device_id, printed_at, sync_status, created_at, edited_at, edit_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [ticket.id, ticket.sessionId, ticket.ticketNumber, ticket.deviceId, null, ticket.syncStatus, ticket.createdAt, null, 0],
  );
  console.log(`[DB] insertTicket #${ticketNumber}: ${Date.now()-t0}ms`);
  return ticket;
}

// ── soporte para el sync de comandas (ver services/ticketsApi.ts) ───────────

/** Comandas con cambios locales sin confirmar por el backend, con orders+items. */
export async function getUnsyncedTickets(): Promise<Ticket[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<TicketRow>(
    "SELECT * FROM tickets WHERE sync_status != 'synced' ORDER BY created_at ASC",
  );
  const tickets: Ticket[] = [];
  for (const row of rows) {
    const orders = await getOrdersByTicketId(row.id);
    tickets.push(mapTicket(row, orders));
  }
  return tickets;
}

/**
 * Marca como sincronizadas las comandas confirmadas por el backend, solo si su
 * `edit_count` no ha cambiado entre medias (si se editó otra vez, sigue pendiente
 * y se reintenta). Espejo de markSessionsSynced pero con `edit_count` de árbitro.
 */
export async function markTicketsSynced(
  confirmed: Array<{ id: string; editCount: number }>,
): Promise<void> {
  if (confirmed.length === 0) return;
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const { id, editCount } of confirmed) {
      await txn.runAsync(
        "UPDATE tickets SET sync_status = 'synced' WHERE id = ? AND edit_count = ?",
        [id, editCount],
      );
    }
  });
}

/** Marca como 'error' las comandas que el backend rechazó (siguen reintentándose). */
export async function markTicketsSyncError(
  failed: Array<{ id: string; editCount: number }>,
): Promise<void> {
  if (failed.length === 0) return;
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const { id, editCount } of failed) {
      await txn.runAsync(
        "UPDATE tickets SET sync_status = 'error' WHERE id = ? AND edit_count = ?",
        [id, editCount],
      );
    }
  });
}

/**
 * Fusiona en SQLite las comandas bajadas del backend. **No destruye datos
 * locales sin sincronizar**:
 *
 *  - Comanda cuya sesión no está aún en local → se salta (llegará tras sincronizar
 *    sesiones; nunca se rompe la FK).
 *  - Comanda borrada en el backend (`deletedAt`) → se ignora (el borrado de
 *    comandas no entra en este paso).
 *  - Comanda con cambios locales pendientes (`sync_status != 'synced'`) → se
 *    respeta lo local (el push de esta misma pasada ya la ha subido).
 *  - Resto → gana el `edit_count` mayor. Al ganar el remoto, se reemplazan sus
 *    orders+items en bloque y queda `synced`.
 *
 * Devuelve cuántas comandas se insertaron o actualizaron.
 */
export async function upsertTicketsFromBackend(remotes: ApiTicket[]): Promise<number> {
  if (remotes.length === 0) return 0;
  const db = await getDb();
  let applied = 0;

  for (const r of remotes) {
    if (r.deletedAt) continue;

    // La sesión debe existir en local (FK tickets.session_id → sessions.id).
    const ses = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM sessions WHERE id = ? LIMIT 1',
      [r.sessionId],
    );
    if (!ses) continue;

    const existing = await db.getFirstAsync<TicketRow>(
      'SELECT * FROM tickets WHERE id = ? LIMIT 1',
      [r.id],
    );

    if (existing) {
      if ((existing.sync_status as SyncStatus) !== 'synced') continue; // hay cambios locales sin subir
      if (r.editCount <= (existing.edit_count ?? 0)) continue;          // no es más nuevo
    }

    await db.withTransactionAsync(async () => {
      if (existing) {
        // Reemplazo de hijos (items antes que orders por las FK).
        const localOrders = await db.getAllAsync<{ id: string }>(
          'SELECT id FROM orders WHERE ticket_id = ?',
          [r.id],
        );
        for (const { id } of localOrders) {
          await db.runAsync('DELETE FROM order_items WHERE order_id = ?', [id]);
        }
        await db.runAsync('DELETE FROM orders WHERE ticket_id = ?', [r.id]);
        await db.runAsync(
          `UPDATE tickets
              SET session_id = ?, ticket_number = ?, device_id = ?, printed_at = ?,
                  created_at = ?, edited_at = ?, edit_count = ?, sync_status = 'synced'
            WHERE id = ?`,
          [
            r.sessionId, r.ticketNumber, r.deviceId, r.printedAt,
            r.createdAt ?? new Date().toISOString(), r.editedAt, r.editCount, r.id,
          ],
        );
      } else {
        await db.runAsync(
          `INSERT INTO tickets
             (id, session_id, ticket_number, device_id, printed_at, sync_status, created_at, edited_at, edit_count)
           VALUES (?, ?, ?, ?, ?, 'synced', ?, ?, ?)`,
          [
            r.id, r.sessionId, r.ticketNumber, r.deviceId, r.printedAt,
            r.createdAt ?? new Date().toISOString(), r.editedAt, r.editCount,
          ],
        );
      }

      for (const o of r.orders) {
        await db.runAsync(
          `INSERT INTO orders (id, ticket_id, client_name, price_profile, take_away, amount_paid, change, total, created_at)
           VALUES (?, ?, ?, ?, 0, NULL, NULL, ?, ?)`,
          [
            o.id, r.id, o.clientName ?? '', o.priceProfile ?? 'normal',
            o.total, o.createdAt ?? r.createdAt ?? new Date().toISOString(),
          ],
        );
        for (const it of o.items) {
          await db.runAsync(
            `INSERT INTO order_items (id, order_id, product_id, product_name, qty, unit_price, modifier_price_add, selected_modifiers, custom_label)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              it.id, o.id, it.productId, it.productName, it.qty, it.unitPrice,
              it.modifierPriceAdd ?? 0, JSON.stringify(it.selectedModifiers ?? []), it.customLabel,
            ],
          );
        }
      }
    });

    applied++;
  }

  return applied;
}

export async function markTicketPrinted(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE tickets SET printed_at = ? WHERE id = ?', [new Date().toISOString(), id]);
  // Checkpoint after each ticket is closed — keeps the journal small between tickets.
  // With journal_mode=DELETE this is a no-op on WAL but harmless; kept for safety
  // in case journal mode is ever changed back.
  try { await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
}

export async function updateTicketSyncStatus(id: string, status: SyncStatus): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE tickets SET sync_status = ? WHERE id = ?', [status, id]);
}

export async function getTicketById(id: string): Promise<Ticket | null> {
  const db = await getDb();
  const ticketRow = await db.getFirstAsync<TicketRow>('SELECT * FROM tickets WHERE id = ?', [id]);
  if (!ticketRow) return null;
  const orders = await getOrdersByTicketId(id);
  return mapTicket(ticketRow, orders);
}

export async function getTicketsBySession(sessionId: string): Promise<Ticket[]> {
  const db = await getDb();
  const ticketRows = await db.getAllAsync<TicketRow>(
    'SELECT * FROM tickets WHERE session_id = ? ORDER BY ticket_number ASC',
    [sessionId],
  );
  const tickets: Ticket[] = [];
  for (const row of ticketRows) {
    const orders = await getOrdersByTicketId(row.id);
    tickets.push(mapTicket(row, orders));
  }
  return tickets;
}

/**
 * Lightweight summary for a session: ticket count and total revenue.
 * Uses a single aggregated SQL query — no N+1, safe to call frequently.
 */
export async function getSessionSummary(
  sessionId: string,
): Promise<{ ticketCount: number; total: number; firstTicketAt: string | null; lastTicketAt: string | null }> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ ticket_count: number; total: number; first_at: string | null; last_at: string | null }>(
    `SELECT COUNT(DISTINCT t.id) AS ticket_count,
            COALESCE(SUM(o.total), 0) AS total,
            MIN(t.created_at) AS first_at,
            MAX(t.created_at) AS last_at
     FROM tickets t
     LEFT JOIN orders o ON o.ticket_id = t.id
     WHERE t.session_id = ?`,
    [sessionId],
  );
  return {
    ticketCount: row?.ticket_count ?? 0,
    total: row?.total ?? 0,
    firstTicketAt: row?.first_at ?? null,
    lastTicketAt: row?.last_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// ORDERS
// ---------------------------------------------------------------------------

export async function insertOrder(order: Omit<Order, 'items'>): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO orders (id, ticket_id, client_name, price_profile, take_away, amount_paid, change, total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [order.id, order.ticketId, order.clientName, order.priceProfile, order.takeAway ? 1 : 0, order.amountPaid, order.change, order.total, order.createdAt],
  );
}

export async function updateOrderPayment(id: string, amountPaid: number, change: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE orders SET amount_paid = ?, change = ? WHERE id = ?', [amountPaid, change, id]);
}

export async function getOrdersByTicketId(ticketId: string): Promise<Order[]> {
  const db = await getDb();
  const orderRows = await db.getAllAsync<OrderRow>(
    'SELECT * FROM orders WHERE ticket_id = ? ORDER BY created_at ASC',
    [ticketId],
  );
  const orders: Order[] = [];
  for (const row of orderRows) {
    const items = await getOrderItemsByOrderId(row.id);
    orders.push(mapOrder(row, items));
  }
  return orders;
}

// ---------------------------------------------------------------------------
// ORDER ITEMS
// ---------------------------------------------------------------------------

export async function insertOrderItem(item: OrderItem): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO order_items (id, order_id, product_id, product_name, qty, unit_price, modifier_price_add, selected_modifiers, custom_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [item.id, item.orderId, item.productId, item.productName, item.qty, item.unitPrice, item.modifierPriceAdd, JSON.stringify(item.selectedModifiers), item.customLabel],
  );
}

export async function getOrderItemsByOrderId(orderId: string): Promise<OrderItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<OrderItemRow>(
    'SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid ASC',
    [orderId],
  );
  return rows.map(mapOrderItem);
}

// ---------------------------------------------------------------------------
// FULL ORDER + ITEMS SAVE (atomic)
// ---------------------------------------------------------------------------

/**
 * Persists a complete Order with all its OrderItems in a single transaction.
 * Also enqueues the order for sync.
 */
export async function saveOrderWithItems(order: Order): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT INTO orders (id, ticket_id, client_name, price_profile, take_away, amount_paid, change, total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [order.id, order.ticketId, order.clientName, order.priceProfile, order.takeAway ? 1 : 0, order.amountPaid, order.change, order.total, order.createdAt],
    );
    for (const item of order.items) {
      await db.runAsync(
        'INSERT INTO order_items (id, order_id, product_id, product_name, qty, unit_price, modifier_price_add, selected_modifiers, custom_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [item.id, item.orderId, item.productId, item.productName, item.qty, item.unitPrice, item.modifierPriceAdd, JSON.stringify(item.selectedModifiers), item.customLabel],
      );
    }
  });
}

// ---------------------------------------------------------------------------
// TICKET EDIT (replace all orders + items in one transaction)
// ---------------------------------------------------------------------------

/**
 * Replaces all orders and order_items for a ticket with the provided data.
 * Updates edited_at, edit_count, and syncStatus atomically.
 *
 * syncStatus rules:
 *   'synced'  → 'pending_update'
 *   anything else → unchanged (stays 'pending' or 'error')
 */
export async function updateTicketWithOrders(ticket: Ticket): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  const wasAlreadySynced = ticket.syncStatus === 'synced';
  const newSyncStatus: SyncStatus = wasAlreadySynced ? 'pending_update' : ticket.syncStatus;

  await db.withTransactionAsync(async () => {
    // 1. Delete existing order_items and orders for this ticket
    const existingOrders = await db.getAllAsync<{ id: string }>(
      'SELECT id FROM orders WHERE ticket_id = ?',
      [ticket.id],
    );
    for (const { id } of existingOrders) {
      await db.runAsync('DELETE FROM order_items WHERE order_id = ?', [id]);
    }
    await db.runAsync('DELETE FROM orders WHERE ticket_id = ?', [ticket.id]);

    // 2. Re-insert orders and their items
    for (const order of ticket.orders) {
      await db.runAsync(
        'INSERT INTO orders (id, ticket_id, client_name, price_profile, take_away, amount_paid, change, total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [order.id, ticket.id, order.clientName, order.priceProfile ?? 'normal', order.takeAway ? 1 : 0, order.amountPaid, order.change, order.total, order.createdAt],
      );
      for (const item of order.items) {
        await db.runAsync(
          'INSERT INTO order_items (id, order_id, product_id, product_name, qty, unit_price, modifier_price_add, selected_modifiers, custom_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [item.id, item.orderId, item.productId, item.productName, item.qty, item.unitPrice, item.modifierPriceAdd, JSON.stringify(item.selectedModifiers), item.customLabel],
        );
      }
    }

    // 3. Update ticket metadata
    await db.runAsync(
      'UPDATE tickets SET edited_at = ?, edit_count = edit_count + 1, sync_status = ? WHERE id = ?',
      [now, newSyncStatus, ticket.id],
    );
  });
}

// ---------------------------------------------------------------------------
// APP LOG
// ---------------------------------------------------------------------------

export type LogLevel = 'info' | 'warn' | 'error' | 'perf';

export interface AppLogEntry {
  id: number;
  ts: string;
  level: LogLevel;
  tag: string;
  msg: string;
  ms: number | null;
}

const LOG_MAX_ROWS = 200;

export async function insertLog(
  level: LogLevel,
  tag: string,
  msg: string,
  ms?: number,
): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync(
      'INSERT INTO app_log (ts, level, tag, msg, ms) VALUES (?, ?, ?, ?, ?)',
      [new Date().toISOString(), level, tag, msg, ms ?? null],
    );
    // Keep only the last LOG_MAX_ROWS rows to avoid unbounded growth
    await db.runAsync(
      `DELETE FROM app_log WHERE id NOT IN (
         SELECT id FROM app_log ORDER BY id DESC LIMIT ${LOG_MAX_ROWS}
       )`,
    );
  } catch {
    // Logging must never throw — silently discard if DB is not ready
  }
}

export async function getLogs(): Promise<AppLogEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<AppLogEntry>(
    'SELECT * FROM app_log ORDER BY id DESC LIMIT 200',
  );
  return rows;
}

export async function clearLogs(): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM app_log');
}

export async function deleteTicket(id: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const orderRows = await db.getAllAsync<{ id: string }>(
      'SELECT id FROM orders WHERE ticket_id = ?',
      [id],
    );
    for (const { id: orderId } of orderRows) {
      await db.runAsync('DELETE FROM order_items WHERE order_id = ?', [orderId]);
    }
    await db.runAsync('DELETE FROM orders WHERE ticket_id = ?', [id]);
    await db.runAsync('DELETE FROM tickets WHERE id = ?', [id]);
  });
}
