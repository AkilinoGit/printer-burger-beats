import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import type { Location, Product, ProductProfile, Profile, Session } from '../lib/types';
import { DEFAULT_FERIANTE_PRICES } from '../lib/constants';
import { closeSession, getActiveSession, getNextTicketNumber, getProducts, initDb } from '../services/db';
import { syncSessions } from '../services/sessionsApi';

const FERIANTE_PRICES_KEY = 'tpv:feriantePrices';
const PRINT_MODE_KEY = 'tpv:printMode';
const ACTIVE_PRODUCT_PROFILE_KEY = 'tpv:activeProductProfile';
const CATALOG_PROFILES_KEY = 'tpv:catalogProfiles';

export type PrintCopies = 'x1' | 'x2';

interface SessionState {
  // --- data ---
  activeLocation: Location | null;
  activeSession: Session | null;
  products: Product[];
  isLoadingProducts: boolean;
  feriantePrices: Record<string, number>;
  /** Red toggle in the order summary: when true the "Imprimir" action saves the order but does NOT print. */
  printNoPrint: boolean;
  /** Blue toggle in the order summary: how many copies to print when printNoPrint is false. */
  printCopies: PrintCopies;
  /** Last ticket number used in the active session. Incremented in-memory — no DB query needed. */
  lastTicketNumber: number;
  /** Product profile shown in the sales grid. Persisted in AsyncStorage. */
  activeProductProfile: ProductProfile;
  /**
   * Perfiles de carta servidos por el backend (entidad). Fuente autoritativa
   * del selector de "carta activa". Vacío ⇒ los perfiles se derivan de los
   * productos. Persistido en AsyncStorage tras cada sync de catálogo.
   */
  catalogProfiles: Profile[];

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

  // --- active product profile (sales grid filter) ---
  /** Load persisted active product profile from AsyncStorage. Call once on app start. */
  loadActiveProductProfile: () => Promise<void>;
  /** Update the active product profile and persist to AsyncStorage. */
  setActiveProductProfile: (profile: ProductProfile) => Promise<void>;
  /** Load persisted backend profiles list from AsyncStorage. Call once on app start. */
  loadCatalogProfiles: () => Promise<void>;

  /** Load persisted print mode (red/blue toggles) from AsyncStorage. Call once on app start. */
  loadPrintMode: () => Promise<void>;
  /** Activate the red "no print" toggle (deactivates the blue copies toggle). */
  setPrintNoPrint: () => Promise<void>;
  /**
   * Press the blue copies toggle: if "no print" was active it resumes the last copies value;
   * otherwise it alternates between x1 and x2. Always deactivates the red toggle.
   */
  togglePrintCopies: () => Promise<void>;
  /**
   * Reset the print toggles to the default after saving an order: deactivate the red
   * "no print" toggle and go back to "print twice" (x2). Called once a ticket is saved
   * so "no print" never carries over to the next order.
   */
  resetPrintMode: () => Promise<void>;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  activeLocation: null,
  activeSession: null,
  products: [],
  isLoadingProducts: true,
  feriantePrices: DEFAULT_FERIANTE_PRICES,
  printNoPrint: false,
  printCopies: 'x1',
  lastTicketNumber: 0,
  activeProductProfile: 'burger',
  catalogProfiles: [],

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
      // Restore persisted feriante prices — fire-and-forget, defaults to DEFAULT_FERIANTE_PRICES
      void get().loadFeriantePrices();
      // Restore persisted print mode (red/blue toggles) — fire-and-forget
      void get().loadPrintMode();
      // Restore persisted active product profile — fire-and-forget, defaults to 'burger'
      void get().loadActiveProductProfile();
      // Restore persisted backend profiles list — fire-and-forget, defaults to []
      void get().loadCatalogProfiles();
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
    // Empuje silencioso al backend: el cierre es un cambio de estado que otros
    // dispositivos deben ver (deja de ofrecerse para "unirse" y entra en el
    // historial). Cubre el cierre manual y los auto-cierres de _layout.tsx.
    // Fire-and-forget: nunca bloquea ni revierte el cierre local.
    void syncSessions().catch(() => {});
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

  loadActiveProductProfile: async () => {
    try {
      const stored = await AsyncStorage.getItem(ACTIVE_PRODUCT_PROFILE_KEY);
      // Acepta cualquier slug no vacío (el conjunto de perfiles es abierto).
      // Si el perfil ya no existe en el catálogo, la pantalla de venta lo
      // reconcilia al primer perfil disponible (ver reconciliación en index).
      if (stored) {
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

  loadCatalogProfiles: async () => {
    try {
      const stored = await AsyncStorage.getItem(CATALOG_PROFILES_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Profile[];
        if (Array.isArray(parsed)) set({ catalogProfiles: parsed });
      }
    } catch {
      // silently ignore — defaults to [] (perfiles derivados de productos)
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

  resetPrintMode: async () => {
    set({ printNoPrint: false, printCopies: 'x2' });
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
