export type SyncStatus = 'pending' | 'synced' | 'error' | 'pending_update';

export type PriceProfile = 'normal' | 'feriante' | 'invitacion';

/** Perfil de carta al que pertenece un producto. Filtra la vista de venta. */
export type ProductProfile = 'burger' | 'cafe';

export interface Location {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
}

export interface Session {
  id: string;
  locationId: string;
  date: string;
  status: 'open' | 'closed';
  priceOverrides: Record<string, number>;
  createdAt: string;
  sessionCode: string | null;    // "LUN-2806"
  openedAt: string | null;       // ISO datetime de apertura real
  autoCloseAt: string | null;    // ISO datetime — 12:00 del día siguiente
  closedAt: string | null;       // null = sesión abierta
  deviceId: string | null;       // identificador del dispositivo que la abrió
}

export interface ModifierOption {
  id: string;
  label: string;
}

export type ModifierSection = 'verdura' | 'queso-salsa' | 'carne' | 'extra' | 'otros';

export interface Modifier {
  id: string;
  label: string;
  type: 'remove' | 'add' | 'radio';
  priceAdd?: number;          // extra cost when selected (e.g. +1 for bacon)
  options?: ModifierOption[]; // only for type 'radio' — user picks exactly one
  noSelectionLabel?: string;  // printed when no option is chosen (e.g. "Sin salsa")
  section?: ModifierSection;  // grouping & color in ModifierSheet
  order?: number;             // fixed position within its section
}

export interface Product {
  id: string;
  name: string;
  basePrice: number;
  category: string;            // sección/encabezado libre en la vista de venta (el valor ES el título)
  categoryOrder?: number;      // orden de la category entre las demás (menor = antes)
  profile: ProductProfile;     // carta a la que pertenece: 'burger' | 'cafe' (redundante con category, se mantiene)
  modifiers: Modifier[];
  isCustom: boolean;
  isActive: boolean;
  alwaysShowModifiers?: boolean; // open modifier sheet on tap (not long press)
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  qty: number;
  unitPrice: number;          // base price (session override or basePrice)
  modifierPriceAdd: number;   // sum of priceAdd from selected modifiers
  selectedModifiers: string[];
  customLabel: string | null;
}

export interface Order {
  id: string;
  ticketId: string;
  clientName: string;
  priceProfile: PriceProfile;
  takeAway?: boolean;
  items: OrderItem[];
  amountPaid: number | null;
  change: number | null;
  total: number;
  createdAt: string;
}

export interface Ticket {
  id: string;
  sessionId: string;
  ticketNumber: number;
  orders: Order[];
  printedAt: string | null;
  syncStatus: SyncStatus;
  createdAt: string;
  editedAt: string | null;       // null si nunca se editó
  editCount: number;             // veces que se ha editado
}

export interface SyncQueueEntry {
  id: string;
  entity_type: 'order' | 'ticket';
  entity_id: string;
  action: 'create' | 'update';
  status: SyncStatus;
  attempts: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Backend catalog API (GET /api/v1/tpv/products)
// Shape recibido del backend. DECIMAL puede llegar como number o string
// (ver tpv-backend-integration-plan.md §3.2) — se normaliza a number al parsear.
// ---------------------------------------------------------------------------

export interface ApiModifierOption {
  id: string;
  label: string;
}

export interface ApiModifier {
  id: string;
  label: string;
  type: 'remove' | 'add' | 'radio';
  priceAdd?: number | string;
  section?: string | null;
  sortOrder?: number;
  noSelectionLabel?: string | null;
  options?: ApiModifierOption[];
}

export interface ApiProduct {
  id: string;
  name: string;
  basePrice: number | string;
  category: string;           // texto libre: es el encabezado de sección en la vista de venta
  categoryOrder?: number;     // orden de la category; opcional (fallback: orden de aparición)
  profile?: ProductProfile;   // opcional: si el backend no lo envía, la app asume 'burger'
  isCustom: boolean;
  isActive: boolean;
  alwaysShowModifiers?: boolean;
  sortOrder?: number;
  modifiers: ApiModifier[];
}

export interface ProductCatalogResponse {
  version: string | null;
  products: ApiProduct[];
}
