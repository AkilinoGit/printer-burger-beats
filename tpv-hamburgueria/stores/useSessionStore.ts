import { create } from 'zustand';
import type { Session, Location, Product } from '../lib/types';

interface SessionState {
  activeLocation: Location | null;
  activeSession: Session | null;
  products: Product[];
  setActiveLocation: (location: Location) => void;
  setActiveSession: (session: Session) => void;
  setProducts: (products: Product[]) => void;
  getEffectivePrice: (productId: string, basePrice: number) => number;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  activeLocation: null,
  activeSession: null,
  products: [],
  setActiveLocation: (location) => set({ activeLocation: location }),
  setActiveSession: (session) => set({ activeSession: session }),
  setProducts: (products) => set({ products }),
  getEffectivePrice: (productId, basePrice) => {
    const overrides = get().activeSession?.priceOverrides ?? {};
    return overrides[productId] ?? basePrice;
  },
}));
