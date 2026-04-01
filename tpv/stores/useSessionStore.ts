import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import type { Location, Product, Session } from '../lib/types';
import { DEFAULT_FERIANTE_PRICES } from '../lib/constants';
import { closeSession, getActiveSession, getProducts, initDb } from '../services/db';

const TEST_MODE_KEY       = 'tpv:testMode';
const FERIANTE_PRICES_KEY = 'tpv:feriantePrices';

interface SessionState {
  // --- data ---
  activeLocation: Location | null;
  activeSession: Session | null;
  products: Product[];
  isLoadingProducts: boolean;
  testMode: boolean;
  feriantePrices: Record<string, number>;

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

  // --- test mode ---
  /** Load persisted test-mode value from AsyncStorage. Call once on app start. */
  loadTestMode: () => Promise<void>;
  /** Toggle test mode and persist the new value. */
  setTestMode: (enabled: boolean) => Promise<void>;

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
  testMode: false,
  feriantePrices: DEFAULT_FERIANTE_PRICES,

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
      set({ products, isLoadingProducts: false, ...(session ? { activeSession: session } : {}) });
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
    set({ activeSession: null });
  },

  loadTestMode: async () => {
    try {
      const stored = await AsyncStorage.getItem(TEST_MODE_KEY);
      set({ testMode: stored === 'true' });
    } catch {
      // silently ignore — defaults to false
    }
  },

  setTestMode: async (enabled) => {
    set({ testMode: enabled });
    try {
      await AsyncStorage.setItem(TEST_MODE_KEY, enabled ? 'true' : 'false');
    } catch {
      // silently ignore
    }
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
