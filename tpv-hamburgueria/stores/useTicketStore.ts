import { create } from 'zustand';
import { generateId } from '../lib/utils';
import type { Order, OrderItem, PriceProfile, Ticket } from '../lib/types';

interface TicketState {
  // --- data ---
  activeTicket: Ticket | null;
  pendingPrintTickets: Ticket[];

  /**
   * Open a brand-new ticket (called before the first Order of a sale).
   * Returns the created Ticket so the caller can persist it in SQLite.
   */
  openTicket: (sessionId: string, ticketNumber: number) => Ticket;

  /**
   * Build an Order from cart data and append it to the active ticket.
   * Returns the Order so the caller can persist it in SQLite.
   * Stamps each OrderItem with the real orderId.
   */
  addOrder: (params: {
    clientName: string;
    items: Omit<OrderItem, 'orderId'>[];
    total: number;
    priceProfile: PriceProfile;
    amountPaid?: number;
    change?: number;
  }) => Order;

  /**
   * Mark the active ticket as printed (sets printedAt).
   * Does NOT clear the ticket — caller clears after successful BT print.
   */
  markPrinted: () => void;

  /** Dispose of the active ticket after it has been fully saved & printed. */
  clearActiveTicket: () => void;

  /**
   * Move activeTicket into pendingPrintTickets and set activeTicket to null.
   * No-op if there is no active ticket.
   */
  commitTicketToPending: () => void;

  /** Reset activeTicket and pendingPrintTickets to their initial values. */
  clearAll: () => void;

  // --- selectors ---
  /** Total across all orders in the active ticket. */
  ticketTotal: () => number;
}

export const useTicketStore = create<TicketState>((set, get) => ({
  activeTicket: null,
  pendingPrintTickets: [],

  openTicket: (sessionId, ticketNumber) => {
    const ticket: Ticket = {
      id: generateId(),
      sessionId,
      ticketNumber,
      orders: [],
      printedAt: null,
      syncStatus: 'pending',
      createdAt: new Date().toISOString(),
    };
    set({ activeTicket: ticket });
    return ticket;
  },

  addOrder: ({ clientName, items, total, priceProfile, amountPaid, change }) => {
    const ticket = get().activeTicket;
    if (!ticket) {
      throw new Error('addOrder called with no active ticket');
    }

    const orderId = generateId();

    const stampedItems: OrderItem[] = items.map((i) => ({ ...i, orderId }));

    const order: Order = {
      id: orderId,
      ticketId: ticket.id,
      clientName,
      priceProfile,
      items: stampedItems,
      amountPaid: amountPaid ?? null,
      change: change ?? null,
      total,
      createdAt: new Date().toISOString(),
    };

    set({
      activeTicket: {
        ...ticket,
        orders: [...ticket.orders, order],
      },
    });

    return order;
  },

  markPrinted: () => {
    const ticket = get().activeTicket;
    if (!ticket) return;
    set({
      activeTicket: { ...ticket, printedAt: new Date().toISOString() },
    });
  },

  clearActiveTicket: () => set({ activeTicket: null }),

  commitTicketToPending: () => {
    const ticket = get().activeTicket;
    if (!ticket) return;
    set({
      pendingPrintTickets: [...get().pendingPrintTickets, ticket],
      activeTicket: null,
    });
  },

  clearAll: () => set({ activeTicket: null, pendingPrintTickets: [] }),

  ticketTotal: () => {
    const orders = get().activeTicket?.orders ?? [];
    const sum = orders.reduce((acc, o) => acc + o.total, 0);
    return Math.round(sum * 100) / 100;
  },
}));
