import * as SQLite from 'expo-sqlite';
import { INITIAL_PRODUCTS, DEFAULT_LOCATION_NAME } from '../lib/constants';
import { generateId, todayISO } from '../lib/utils';
import type {
  Location,
  Session,
  Product,
  Modifier,
  Ticket,
  Order,
  OrderItem,
  SyncStatus,
  SyncQueueEntry,
} from '../lib/types';

// ---------------------------------------------------------------------------
// DB singleton
// ---------------------------------------------------------------------------

const DB_NAME = 'tpv_v8.db';
const SCHEMA_VERSION = 8;

let _db: SQLite.SQLiteDatabase | null = null;
let _initPromise: Promise<void> | null = null;

async function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync(DB_NAME);
  return _db;
}

async function getDb(): Promise<SQLite.SQLiteDatabase> {
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
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
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
        no_selection_label  TEXT
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
          'INSERT INTO modifiers (id, product_id, label, type, price_add, options, no_selection_label) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [`${p.id}-${m.id}`, p.id, m.label, m.type, m.priceAdd ?? 0, JSON.stringify(m.options ?? []), m.noSelectionLabel ?? null],
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
};

type ProductRow = {
  id: string;
  name: string;
  base_price: number;
  category: string;
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
};

type TicketRow = {
  id: string;
  session_id: string;
  ticket_number: number;
  printed_at: string | null;
  sync_status: string;
  created_at: string;
};

type OrderRow = {
  id: string;
  ticket_id: string;
  client_name: string;
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

type SyncQueueRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  status: string;
  attempts: number;
  created_at: string;
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
  };
}

function mapProduct(row: ProductRow, modifiers: Modifier[]): Product {
  return {
    id: row.id,
    name: row.name,
    basePrice: row.base_price,
    category: row.category as Product['category'],
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
  };
}

function mapTicket(row: TicketRow, orders: Order[]): Ticket {
  return {
    id: row.id,
    sessionId: row.session_id,
    ticketNumber: row.ticket_number,
    orders,
    printedAt: row.printed_at,
    syncStatus: row.sync_status as SyncStatus,
    createdAt: row.created_at,
  };
}

function mapOrder(row: OrderRow, items: OrderItem[]): Order {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    clientName: row.client_name,
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

function mapSyncQueueEntry(row: SyncQueueRow): SyncQueueEntry {
  return {
    id: row.id,
    entity_type: row.entity_type as SyncQueueEntry['entity_type'],
    entity_id: row.entity_id,
    status: row.status as SyncStatus,
    attempts: row.attempts,
    created_at: row.created_at,
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

// ---------------------------------------------------------------------------
// SESSIONS
// ---------------------------------------------------------------------------

export async function getSessionByDate(locationId: string, date: string): Promise<Session | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<SessionRow>(
    'SELECT * FROM sessions WHERE location_id = ? AND date = ? LIMIT 1',
    [locationId, date],
  );
  return row ? mapSession(row) : null;
}

export async function getOpenSession(locationId: string): Promise<Session | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<SessionRow>(
    "SELECT * FROM sessions WHERE location_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1",
    [locationId],
  );
  return row ? mapSession(row) : null;
}

export async function insertSession(locationId: string, priceOverrides: Record<string, number> = {}): Promise<Session> {
  const db = await getDb();
  const session: Session = {
    id: generateId(),
    locationId,
    date: todayISO(),
    status: 'open',
    priceOverrides,
    createdAt: new Date().toISOString(),
  };
  await db.runAsync(
    'INSERT INTO sessions (id, location_id, date, status, price_overrides, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [session.id, session.locationId, session.date, session.status, JSON.stringify(session.priceOverrides), session.createdAt],
  );
  return session;
}

export async function closeSession(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE sessions SET status = 'closed' WHERE id = ?", [id]);
}

export async function updateSessionPriceOverrides(id: string, overrides: Record<string, number>): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE sessions SET price_overrides = ? WHERE id = ?', [JSON.stringify(overrides), id]);
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
    'INSERT INTO products (id, name, base_price, category, is_custom, is_active, always_show_modifiers) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [product.id, product.name, product.basePrice, product.category, product.isCustom ? 1 : 0, product.isActive ? 1 : 0, product.alwaysShowModifiers ? 1 : 0],
  );
}

export async function updateProductActive(id: string, isActive: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE products SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, id]);
}

// ---------------------------------------------------------------------------
// TICKETS
// ---------------------------------------------------------------------------

export async function getNextTicketNumber(sessionId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ max_num: number | null }>(
    'SELECT MAX(ticket_number) AS max_num FROM tickets WHERE session_id = ?',
    [sessionId],
  );
  return (row?.max_num ?? 0) + 1;
}

export async function insertTicket(sessionId: string, ticketNumber: number): Promise<Ticket> {
  const db = await getDb();
  const ticket: Ticket = {
    id: generateId(),
    sessionId,
    ticketNumber,
    orders: [],
    printedAt: null,
    syncStatus: 'pending',
    createdAt: new Date().toISOString(),
  };
  await db.runAsync(
    'INSERT INTO tickets (id, session_id, ticket_number, printed_at, sync_status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [ticket.id, ticket.sessionId, ticket.ticketNumber, null, ticket.syncStatus, ticket.createdAt],
  );
  return ticket;
}

export async function markTicketPrinted(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE tickets SET printed_at = ? WHERE id = ?', [new Date().toISOString(), id]);
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

// ---------------------------------------------------------------------------
// ORDERS
// ---------------------------------------------------------------------------

export async function insertOrder(order: Omit<Order, 'items'>): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO orders (id, ticket_id, client_name, amount_paid, change, total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [order.id, order.ticketId, order.clientName, order.amountPaid, order.change, order.total, order.createdAt],
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
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      'INSERT INTO orders (id, ticket_id, client_name, amount_paid, change, total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [order.id, order.ticketId, order.clientName, order.amountPaid, order.change, order.total, order.createdAt],
    );
    for (const item of order.items) {
      await txn.runAsync(
        'INSERT INTO order_items (id, order_id, product_id, product_name, qty, unit_price, modifier_price_add, selected_modifiers, custom_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [item.id, item.orderId, item.productId, item.productName, item.qty, item.unitPrice, item.modifierPriceAdd, JSON.stringify(item.selectedModifiers), item.customLabel],
      );
    }
    // Enqueue for sync
    await txn.runAsync(
      'INSERT INTO sync_queue (id, entity_type, entity_id, status, attempts, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [generateId(), 'order', order.id, 'pending', 0, new Date().toISOString()],
    );
  });
}

// ---------------------------------------------------------------------------
// SYNC QUEUE
// ---------------------------------------------------------------------------

export async function getPendingSyncEntries(): Promise<SyncQueueEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SyncQueueRow>(
    "SELECT * FROM sync_queue WHERE status = 'pending' OR status = 'error' ORDER BY created_at ASC",
  );
  return rows.map(mapSyncQueueEntry);
}

export async function enqueueSyncEntry(entityType: 'order' | 'ticket', entityId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO sync_queue (id, entity_type, entity_id, status, attempts, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [generateId(), entityType, entityId, 'pending', 0, new Date().toISOString()],
  );
}

export async function updateSyncEntryStatus(id: string, status: SyncStatus): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE sync_queue SET status = ?, attempts = attempts + 1 WHERE id = ?',
    [status, id],
  );
}

export async function clearSyncedEntries(): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM sync_queue WHERE status = 'synced'");
}
