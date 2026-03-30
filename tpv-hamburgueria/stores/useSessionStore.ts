import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import type { Location, Product, Session } from '../lib/types';

const TEST_MODE_KEY = 'tpv:testMode';

interface SessionState {
  // --- data ---
  activeLocation: Location | null;
  activeSession: Session | null;
  products: Product[];
  testMode: boolean;

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

  // --- test mode ---
  /** Load persisted test-mode value from AsyncStorage. Call once on app start. */
  loadTestMode: () => Promise<void>;
  /** Toggle test mode and persist the new value. */
  setTestMode: (enabled: boolean) => Promise<void>;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  activeLocation: null,
  activeSession: null,
  products: [],
  testMode: false,

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
}));
