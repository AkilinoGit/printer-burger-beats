// Estado de UI de los pedidos web: qué acaba de entrar y qué quedó sin imprimir.
//
// El trabajo de verdad (poll, claim, impresión, ACK) está en services/webOrders.ts;
// este store solo guarda lo que las pantallas necesitan pintar. Ver
// tpv-web-orders-plan.md §4.

import { Vibration } from 'react-native';
import { create } from 'zustand';

import type { Ticket } from '../lib/types';

/** Un pedido web ya procesado, para el banner de aviso. */
export interface IncomingWebOrder {
  webOrderId: string;
  ticketId: string;
  ticketNumber: number;
  customerName: string;
  customerPhone: string | null;
  total: number;
  /** false = entró pero la impresora falló; está en la bandeja. */
  printed: boolean;
  at: string;
}

/** Cuántos avisos recientes se conservan (el banner muestra el último). */
const MAX_RECENT = 20;

/**
 * Patrón de vibración del aviso. Sin sonido: la app no tiene expo-av/expo-audio
 * instalado y añadirlo obliga a recompilar el development build. La vibración
 * funciona con el binario actual.
 */
const ALERT_PATTERN = [0, 400, 200, 400];

interface WebOrdersState {
  /** Pedidos procesados en esta sesión de la app, del más reciente al más antiguo. */
  recent: IncomingWebOrder[];
  /** Comandas web guardadas cuya impresión falló — pendientes de reimprimir. */
  unprinted: Ticket[];
  /** El poller está activo (hay jornada abierta y app en primer plano). */
  isPolling: boolean;
  /** Último error de red del poller. Informativo: no se muestra como alerta. */
  lastError: string | null;
  /** El banner de "pedido nuevo" sigue sin descartar. */
  bannerVisible: boolean;

  pushIncoming: (order: IncomingWebOrder) => void;
  setUnprinted: (tickets: Ticket[]) => void;
  setPolling: (value: boolean) => void;
  setLastError: (error: string | null) => void;
  dismissBanner: () => void;

  /** Último pedido entrante, o null. */
  latest: () => IncomingWebOrder | null;
}

export const useWebOrdersStore = create<WebOrdersState>((set, get) => ({
  recent: [],
  unprinted: [],
  isPolling: false,
  lastError: null,
  bannerVisible: false,

  pushIncoming: (order) => {
    // Vibración + banner: en cocina, un aviso solo visual pasa desapercibido.
    Vibration.vibrate(ALERT_PATTERN);

    set((state) => ({
      recent: [order, ...state.recent].slice(0, MAX_RECENT),
      bannerVisible: true,
    }));
  },

  setUnprinted: (tickets) => set({ unprinted: tickets }),

  setPolling: (value) => set({ isPolling: value }),

  setLastError: (error) => set({ lastError: error }),

  dismissBanner: () => set({ bannerVisible: false }),

  latest: () => get().recent[0] ?? null,
}));
