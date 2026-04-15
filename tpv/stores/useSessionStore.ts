import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import type { Location, Product, Session } from '../lib/types';
import { DEFAULT_FERIANTE_PRICES } from '../lib/constants';
import { closeSession, getActiveSession, getNextTicketNumber, getProducts, initDb } from '../services/db';

const FERIANTE_PRICES_KEY = 'tpv:feriantePrices';

interface SessionState {
  // --- data ---
  activeLocation: Location | null;
  activeSession: Session | null;
  products: Product[];
  isLoadingProducts: boolean;
  feriantePrices: Record<string, number>;
  /** Last ticket number used in the active session. Incremented in-memory — no DB query needed. */
  lastTicketNumber: number;

  // --- setters ---
  setActiveLocation: (location: Location) => void;
  setActiveSession: (session: Session) => void;
  setProducts: (products: Product[]) => void;

  /**
   * Override the price of a product for the active session (in-memory + persisted
   * via updateSessionPriceOverrides from db.ts — caller is responsible for the DB call).
   */
  setPriceOverride: (productId: string, price: number) => void;

  /**
   * Returns the effective price for a product: session override if present, basePrice otherwise.
   */
  getEffectivePrice: (productId: string, basePrice: number) => number;

  /**
   * Recovers any active session from DB on app start.
   * Sets activeSession and loads products if a valid session exists.
   */
  initSession: () => Promise<void>;

  /**
   * Loads products from DB (always calls initDb first).
   * Sets isLoadingProducts to false when done, whether it succeeds or fails.
   * Safe to call multiple times — use as the "retry" action.
   */
  loadProducts: () => Promise<void>;

  /**
   * Closes the current active session in DB and clears the store.
   */
  closeCurrentSession: () => Promise<void>;

  /** Returns the next ticket number and increments the in-memory counter. No DB query. */
  nextTicketNumber: () => number;

  // --- feriante prices ---
  /** Load persisted feriante prices from AsyncStorage. Call once on app start. */
  loadFeriantePrices: () => Promise<void>;
  /** Update feriante prices and persist to AsyncStorage. */
  setFeriantePrices: (prices: Record<string, number>) => Promise<void>;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  activeLocation: null,
  activeSession: null,
  products: [],
  isLoadingProducts: true,
  feriantePrices: DEFAULT_FERIANTE_PRICES,
  lastTicketNumber: 0,

  setActiveLocation: (location) => set({ activeLocation: location }),

  setActiveSession: (session) => set({ activeSession: session }),

  setProducts: (products) => set({ products }),

  setPriceOverride: (productId, price) => {
    const session = get().activeSession;
    if (!session) return;
    set({
      activeSession: {
        ...session,
        priceOverrides: { ...session.priceOverrides, [productId]: price },
      },
    });
  },

  getEffectivePrice: (productId, basePrice) => {
    const overrides = get().activeSession?.priceOverrides ?? {};
    return overrides[productId] ?? basePrice;
  },

  loadProducts: async () => {
    set({ isLoadingProducts: true });
    try {
      await initDb();
      const products = await getProducts();
      set({ products, isLoadingProducts: false });
    } catch {
      set({ isLoadingProducts: false });
    }
  },

  initSession: async () => {
    set({ isLoadingProducts: true });
    try {
      await initDb();
      const [session, products] = await Promise.all([getActiveSession(), getProducts()]);
      if (session) {
        const lastNum = await getNextTicketNumber(session.id) - 1;
        set({ products, isLoadingProducts: false, activeSession: session, lastTicketNumber: lastNum });
      } else {
        set({ products, isLoadingProducts: false });
      }
    } catch {
      set({ isLoadingProducts: false });
    }
  },

  closeCurrentSession: async () => {
    const session = useSessionStore.getState().activeSession;
    if (!session) return;
    try {
      await closeSession(session.id);
    } catch {
      // DB error — still clear the store so UI stays consistent
    }
    set({ activeSession: null, lastTicketNumber: 0 });
  },

  nextTicketNumber: () => {
    const next = get().lastTicketNumber + 1;
    set({ lastTicketNumber: next });
    return next;
  },

  loadFeriantePrices: async () => {
    try {
      const stored = await AsyncStorage.getItem(FERIANTE_PRICES_KEY);
      if (stored) {
        set({ feriantePrices: JSON.parse(stored) as Record<string, number> });
      }
    } catch {
      // silently ignore — defaults to DEFAULT_FERIANTE_PRICES
    }
  },

  setFeriantePrices: async (prices) => {
    set({ feriantePrices: prices });
    try {
      await AsyncStorage.setItem(FERIANTE_PRICES_KEY, JSON.stringify(prices));
    } catch {
      // silently ignore
    }
  },
}));
