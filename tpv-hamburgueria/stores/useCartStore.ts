import { create } from 'zustand';
import { generateId } from '../lib/utils';
import type { OrderItem, Product } from '../lib/types';
import { useSessionStore } from './useSessionStore';

interface CartState {
  // --- data ---
  clientName: string;
  items: OrderItem[];

  // --- client name ---
  setClientName: (name: string) => void;

  /**
   * Add a product to the cart. Resolves the effective price from useSessionStore.
   * If the same product+modifiers combo already exists, increments qty instead.
   */
  addProduct: (
    product: Product,
    selectedModifiers: string[],
    customLabel?: string,
  ) => void;

  /** Increment qty of an existing item. */
  incrementItem: (itemId: string) => void;

  /** Decrement qty; removes the item when qty reaches 0. */
  decrementItem: (itemId: string) => void;

  /** Hard-remove an item regardless of qty. */
  removeItem: (itemId: string) => void;

  /** Replace the selectedModifiers of an existing item. */
  updateModifiers: (itemId: string, selectedModifiers: string[]) => void;

  /** Total price of the current cart using effective session prices. */
  total: () => number;

  /** Reset cart (called after saving an Order). */
  clearCart: () => void;
}

export const useCartStore = create<CartState>((set, get) => ({
  clientName: '',
  items: [],

  setClientName: (name) => set({ clientName: name }),

  addProduct: (product, selectedModifiers, customLabel) => {
    const effectivePrice = useSessionStore
      .getState()
      .getEffectivePrice(product.id, product.basePrice);

    // Deduplicate: same product + same sorted modifier list
    const modKey = [...selectedModifiers].sort().join(',');
    const existing = get().items.find(
      (i) =>
        i.productId === product.id &&
        [...i.selectedModifiers].sort().join(',') === modKey &&
        i.customLabel === (customLabel ?? null),
    );

    if (existing) {
      set((s) => ({
        items: s.items.map((i) =>
          i.id === existing.id ? { ...i, qty: i.qty + 1 } : i,
        ),
      }));
      return;
    }

    const newItem: OrderItem = {
      id: generateId(),
      orderId: '',            // filled in when the Order is saved
      productId: product.id,
      productName: product.name,
      qty: 1,
      unitPrice: effectivePrice,
      selectedModifiers,
      customLabel: customLabel ?? null,
    };

    set((s) => ({ items: [...s.items, newItem] }));
  },

  incrementItem: (itemId) =>
    set((s) => ({
      items: s.items.map((i) =>
        i.id === itemId ? { ...i, qty: i.qty + 1 } : i,
      ),
    })),

  decrementItem: (itemId) =>
    set((s) => {
      const item = s.items.find((i) => i.id === itemId);
      if (!item) return s;
      if (item.qty <= 1) {
        return { items: s.items.filter((i) => i.id !== itemId) };
      }
      return {
        items: s.items.map((i) =>
          i.id === itemId ? { ...i, qty: i.qty - 1 } : i,
        ),
      };
    }),

  removeItem: (itemId) =>
    set((s) => ({ items: s.items.filter((i) => i.id !== itemId) })),

  updateModifiers: (itemId, selectedModifiers) =>
    set((s) => ({
      items: s.items.map((i) =>
        i.id === itemId ? { ...i, selectedModifiers } : i,
      ),
    })),

  total: () => {
    const items = get().items;
    const sum = items.reduce((acc, i) => acc + i.unitPrice * i.qty, 0);
    return Math.round(sum * 100) / 100;
  },

  clearCart: () => set({ clientName: '', items: [] }),
}));
