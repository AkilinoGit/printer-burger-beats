import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import type { Location, Product, ProductProfile, Session } from '../lib/types';
import { DEFAULT_FERIANTE_PRICES } from '../lib/constants';
import { closeSession, getActiveSession, getNextTicketNumber, getProducts, initDb } from '../services/db';

const FERIANTE_PRICES_KEY = 'tpv:feriantePrices';
const FORCE_PRINT_TWICE_KEY = 'tpv:forcePrintTwice';
const PRINT_MODE_KEY = 'tpv:printMode';
const ACTIVE_PRODUCT_PROFILE_KEY = 'tpv:activeProductProfile';

export type PrintCopies = 'x1' | 'x2';

interface SessionState {
  // --- data ---
  activeLocation: Location | null;
  activeSession: Session | null;
  products: Product[];
  isLoadingProducts: boolean;
  feriantePrices: Record<string, number>;
  /** When true, every print is forced to emit two copies (as if "Imprimir 2x" were always on). */
  forcePrintTwice: boolean;
  /** Red toggle in the order summary: when true the "Imprimir" action saves the order but does NOT print. */
  printNoPrint: boolean;
  /** Blue toggle in the order summary: how many copies to print when printNoPrint is false. */
  printCopies: PrintCopies;
  /** Last ticket number used in the active session. Incremented in-memory — no DB query needed. */
  lastTicketNumber: number;
  /** Product profile shown in the sales grid. Persisted in AsyncStorage. */
  activeProductProfile: ProductProfile;

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

  // --- force print twice ---
  /** Load persisted forcePrintTwice flag from AsyncStorage. Call once on app start. */
  loadForcePrintTwice: () => Promise<void>;
  /** Update forcePrintTwice flag and persist to AsyncStorage. */
  setForcePrintTwice: (value: boolean) => Promise<void>;

  // --- print mode (order summary toggles) ---
  // --- active product profile (sales grid filter) ---
  /** Load persisted active product profile from AsyncStorage. Call once on app start. */
  loadActiveProductProfile: () => Promise<void>;
  /** Update the active product profile and persist to AsyncStorage. */
  setActiveProductProfile: (profile: ProductProfile) => Promise<void>;

  /** Load persisted print mode (red/blue toggles) from AsyncStorage. Call once on app start. */
  loadPrintMode: () => Promise<void>;
  /** Activate the red "no print" toggle (deactivates the blue copies toggle). */
  setPrintNoPrint: () => Promise<void>;
  /**
   * Press the blue copies toggle: if "no print" was active it resumes the last copies value;
   * otherwise it alternates between x1 and x2. Always deactivates the red toggle.
   */
  togglePrintCopies: () => Promise<void>;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  activeLocation: null,
  activeSession: null,
  products: [],
  isLoadingProducts: true,
  feriantePrices: DEFAULT_FERIANTE_PRICES,
  forcePrintTwice: false,
  printNoPrint: false,
  printCopies: 'x1',
  lastTicketNumber: 0,
  activeProductProfile: 'burger',

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
      // Restore persisted forcePrintTwice flag — fire-and-forget, defaults to false
      void get().loadForcePrintTwice();
      // Restore persisted print mode (red/blue toggles) — fire-and-forget
      void get().loadPrintMode();
      // Restore persisted active product profile — fire-and-forget, defaults to 'burger'
      void get().loadActiveProductProfile();
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
    // Let the error propagate so the caller can show feedback.
    // Never clear the store unless the DB write succeeds — otherwise memory
    // and disk diverge and the session appears "open" again on next launch.
    await closeSession(session.id);
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

  loadForcePrintTwice: async () => {
    try {
      const stored = await AsyncStorage.getItem(FORCE_PRINT_TWICE_KEY);
      if (stored !== null) {
        set({ forcePrintTwice: stored === 'true' });
      }
    } catch {
      // silently ignore — defaults to false
    }
  },

  setForcePrintTwice: async (value) => {
    set({ forcePrintTwice: value });
    try {
      await AsyncStorage.setItem(FORCE_PRINT_TWICE_KEY, value ? 'true' : 'false');
    } catch {
      // silently ignore
    }
  },

  loadActiveProductProfile: async () => {
    try {
      const stored = await AsyncStorage.getItem(ACTIVE_PRODUCT_PROFILE_KEY);
      if (stored === 'burger' || stored === 'cafe') {
        set({ activeProductProfile: stored });
      }
    } catch {
      // silently ignore — defaults to 'burger'
    }
  },

  setActiveProductProfile: async (profile) => {
    set({ activeProductProfile: profile });
    try {
      await AsyncStorage.setItem(ACTIVE_PRODUCT_PROFILE_KEY, profile);
    } catch {
      // silently ignore
    }
  },

  loadPrintMode: async () => {
    try {
      const stored = await AsyncStorage.getItem(PRINT_MODE_KEY);
      if (stored !== null) {
        const parsed = JSON.parse(stored) as { noPrint?: boolean; copies?: PrintCopies };
        set({
          printNoPrint: parsed.noPrint === true,
          printCopies: parsed.copies === 'x2' ? 'x2' : 'x1',
        });
      }
    } catch {
      // silently ignore — defaults to { noPrint: false, copies: 'x1' }
    }
  },

  setPrintNoPrint: async () => {
    set({ printNoPrint: true });
    await persistPrintMode(get);
  },

  togglePrintCopies: async () => {
    const { printNoPrint, printCopies } = get();
    // Resume previous copies value when coming back from "no print"; otherwise flip x1<->x2.
    const nextCopies: PrintCopies = printNoPrint ? printCopies : (printCopies === 'x1' ? 'x2' : 'x1');
    set({ printNoPrint: false, printCopies: nextCopies });
    await persistPrintMode(get);
  },
}));

async function persistPrintMode(get: () => SessionState): Promise<void> {
  const { printNoPrint, printCopies } = get();
  try {
    await AsyncStorage.setItem(PRINT_MODE_KEY, JSON.stringify({ noPrint: printNoPrint, copies: printCopies }));
  } catch {
    // silently ignore
  }
}
