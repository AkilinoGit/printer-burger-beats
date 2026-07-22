import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import type { TextPreset, TextPresetKind, TicketSlot } from '../lib/types';
import {
  getTextPresets,
  initDb,
  insertTextPreset,
  setTextPresetEnabled,
  softDeleteTextPreset,
  updateTextPresetText,
} from '../services/db';
import { syncTextPresets } from '../services/textPresetsApi';

const MODES_KEY = 'tpv:textPresetModes';

/** Objetivo de un modo de impresión: los dos slots de mensaje + los nombres. */
export type ModeTarget = 'header' | 'footer' | 'orderName';

/**
 * Modo de un objetivo:
 *  - 'random' → sortea uno entre los candidatos activos (enabled).
 *  - 'fixed'  → usa siempre `fixedId` (aunque esté desactivado); si no existe,
 *    no imprime nada.
 */
export interface SlotMode {
  mode: 'random' | 'fixed';
  fixedId: string | null;
}

type ModesConfig = Record<ModeTarget, SlotMode>;

const DEFAULT_MODES: ModesConfig = {
  header: { mode: 'random', fixedId: null },
  footer: { mode: 'random', fixedId: null },
  orderName: { mode: 'random', fixedId: null },
};

interface TextPresetsState {
  presets: TextPreset[];         // solo NO borrados
  modes: ModesConfig;
  loaded: boolean;

  /** Carga presets de SQLite y modos de AsyncStorage. Llamar al arrancar. */
  load: () => Promise<void>;
  /** Recarga solo los presets desde SQLite (tras una mutación). */
  reload: () => Promise<void>;

  addPreset: (kind: TextPresetKind, slot: TicketSlot | null, text: string) => Promise<void>;
  updateText: (id: string, text: string) => Promise<void>;
  toggleEnabled: (id: string, enabled: boolean) => Promise<void>;
  removePreset: (id: string) => Promise<void>;
  setMode: (target: ModeTarget, mode: SlotMode) => Promise<void>;

  // --- resolvers (usan el estado actual) ---
  resolveHeaderMessage: () => string | null;
  resolveFooterMessage: () => string | null;
  resolveOrderName: () => string | null;
}

/** Reglas kind/slot por objetivo. */
function targetFilter(target: ModeTarget): { kind: TextPresetKind; slot: TicketSlot | null } {
  if (target === 'header') return { kind: 'ticket_message', slot: 'header' };
  if (target === 'footer') return { kind: 'ticket_message', slot: 'footer' };
  return { kind: 'order_name', slot: null };
}

/** Resuelve el texto a imprimir para un objetivo según su modo. */
function resolveTarget(presets: TextPreset[], target: ModeTarget, cfg: SlotMode): string | null {
  const { kind, slot } = targetFilter(target);
  const pool = presets.filter((p) => p.kind === kind && p.slot === slot);

  if (cfg.mode === 'fixed') {
    const fixed = cfg.fixedId ? pool.find((p) => p.id === cfg.fixedId) : undefined;
    return fixed ? fixed.text : null;
  }
  // random: uno al azar entre los candidatos activos.
  const candidates = pool.filter((p) => p.enabled);
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)].text;
}

export const useTextPresetsStore = create<TextPresetsState>((set, get) => ({
  presets: [],
  modes: DEFAULT_MODES,
  loaded: false,

  load: async () => {
    try {
      await initDb();
      const [presets, storedModes] = await Promise.all([
        getTextPresets(),
        AsyncStorage.getItem(MODES_KEY),
      ]);
      let modes = DEFAULT_MODES;
      if (storedModes) {
        try {
          const parsed = JSON.parse(storedModes) as Partial<ModesConfig>;
          modes = {
            header: parsed.header ?? DEFAULT_MODES.header,
            footer: parsed.footer ?? DEFAULT_MODES.footer,
            orderName: parsed.orderName ?? DEFAULT_MODES.orderName,
          };
        } catch {
          modes = DEFAULT_MODES;
        }
      }
      set({ presets, modes, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  reload: async () => {
    try {
      const presets = await getTextPresets();
      set({ presets });
    } catch {
      // silently ignore
    }
  },

  addPreset: async (kind, slot, text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    await insertTextPreset({ kind, slot, text: trimmed });
    await get().reload();
    void syncTextPresets().catch(() => {});
  },

  updateText: async (id, text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    await updateTextPresetText(id, trimmed);
    await get().reload();
    void syncTextPresets().catch(() => {});
  },

  toggleEnabled: async (id, enabled) => {
    await setTextPresetEnabled(id, enabled);
    await get().reload(); // enabled es local: no se sincroniza
  },

  removePreset: async (id) => {
    await softDeleteTextPreset(id);
    // Si el preset borrado era el fijo de algún objetivo, limpia esa referencia.
    const modes = get().modes;
    let changed = false;
    const next: ModesConfig = { ...modes };
    (Object.keys(next) as ModeTarget[]).forEach((t) => {
      if (next[t].fixedId === id) {
        next[t] = { ...next[t], fixedId: null };
        changed = true;
      }
    });
    if (changed) {
      set({ modes: next });
      void AsyncStorage.setItem(MODES_KEY, JSON.stringify(next)).catch(() => {});
    }
    await get().reload();
    void syncTextPresets().catch(() => {});
  },

  setMode: async (target, mode) => {
    const next: ModesConfig = { ...get().modes, [target]: mode };
    set({ modes: next });
    try {
      await AsyncStorage.setItem(MODES_KEY, JSON.stringify(next));
    } catch {
      // silently ignore
    }
  },

  resolveHeaderMessage: () => resolveTarget(get().presets, 'header', get().modes.header),
  resolveFooterMessage: () => resolveTarget(get().presets, 'footer', get().modes.footer),
  resolveOrderName: () => resolveTarget(get().presets, 'orderName', get().modes.orderName),
}));
