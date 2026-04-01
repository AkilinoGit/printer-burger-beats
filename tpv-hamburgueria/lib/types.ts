export type SyncStatus = 'pending' | 'synced' | 'error' | 'pending_update';

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

export interface Modifier {
  id: string;
  label: string;
  type: 'remove' | 'add' | 'radio';
  priceAdd?: number;          // extra cost when selected (e.g. +1 for bacon)
  options?: ModifierOption[]; // only for type 'radio' — user picks exactly one
  noSelectionLabel?: string;  // printed when no option is chosen (e.g. "Sin salsa")
}

export interface Product {
  id: string;
  name: string;
  basePrice: number;
  category: 'burger' | 'side' | 'drink' | 'custom';
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
