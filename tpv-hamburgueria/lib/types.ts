export type SyncStatus = 'pending' | 'synced' | 'error';

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
}

export interface Modifier {
  id: string;
  label: string;
  type: 'remove' | 'add';
}

export interface Product {
  id: string;
  name: string;
  basePrice: number;
  category: 'burger' | 'side' | 'drink' | 'custom';
  modifiers: Modifier[];
  isCustom: boolean;
  isActive: boolean;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  qty: number;
  unitPrice: number;
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
}

export interface SyncQueueEntry {
  id: string;
  entity_type: 'order' | 'ticket';
  entity_id: string;
  status: SyncStatus;
  attempts: number;
  created_at: string;
}
