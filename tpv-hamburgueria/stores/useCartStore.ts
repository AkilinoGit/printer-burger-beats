import { create } from 'zustand';
import type { OrderItem } from '../lib/types';

interface CartState {
  clientName: string;
  items: OrderItem[];
  setClientName: (name: string) => void;
  addItem: (item: OrderItem) => void;
  removeItem: (itemId: string) => void;
  updateItem: (itemId: string, patch: Partial<OrderItem>) => void;
  clearCart: () => void;
}

export const useCartStore = create<CartState>((set) => ({
  clientName: '',
  items: [],
  setClientName: (name) => set({ clientName: name }),
  addItem: (item) => set((s) => ({ items: [...s.items, item] })),
  removeItem: (itemId) =>
    set((s) => ({ items: s.items.filter((i) => i.id !== itemId) })),
  updateItem: (itemId, patch) =>
    set((s) => ({
      items: s.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
    })),
  clearCart: () => set({ clientName: '', items: [] }),
}));
