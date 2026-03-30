import { create } from 'zustand';
import type { Ticket, Order } from '../lib/types';

interface TicketState {
  activeTicket: Ticket | null;
  setActiveTicket: (ticket: Ticket) => void;
  addOrderToTicket: (order: Order) => void;
  clearActiveTicket: () => void;
}

export const useTicketStore = create<TicketState>((set) => ({
  activeTicket: null,
  setActiveTicket: (ticket) => set({ activeTicket: ticket }),
  addOrderToTicket: (order) =>
    set((s) => {
      if (!s.activeTicket) return s;
      return {
        activeTicket: {
          ...s.activeTicket,
          orders: [...s.activeTicket.orders, order],
        },
      };
    }),
  clearActiveTicket: () => set({ activeTicket: null }),
}));
