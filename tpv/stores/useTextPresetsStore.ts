import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import type { PresetSlot, PromoSlot, TextPreset, TextPresetKind } from '../lib/types';
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
const PROMO_SELECTION_KEY = 'tpv:promoSelection';
const PROMO_NUMBERING_KEY = 'tpv:promoNumbering';

/** Objetivo de un modo de impresión: los dos slots de mensaje + los nombres. */
export type ModeTarget = 'header' | 'footer' | 'orderName';

/** Slots de selección única del folleto (radio: como mucho un preset elegido). */
export type SinglePromoSlot = 'title' | 'validity' | 'farewell';

/**
 * Preset(s) elegido(s) para cada parte del folleto.
 * A diferencia de los mensajes de ticket, el folleto se elige explícitamente al
 * imprimirlo, así que en vez de modo aleatorio/fijo se guarda el id elegido.
 * Es LOCAL de cada dispositivo (AsyncStorage), como `modes`.
 *
 * `title`/`validity`/`farewell` son selección única (id o null = "ninguno").
 * `other` es selección MÚLTIPLE (checkboxes): se guarda un array de ids y se
 * imprimen TODOS los seleccionados, en el orden en que aparecen en `presets`.
 */
export interface PromoSelection {
  title: string | null;
  validity: string | null;
  farewell: string | null;
  other: string[];
}

const DEFAULT_PROMO_SELECTION: PromoSelection = { title: null, validity: null, farewell: null, other: [] };

const SINGLE_PROMO_SLOTS: SinglePromoSlot[] = ['title', 'validity', 'farewell'];

/**
 * Numeración de los cupones del folleto. LOCAL de cada dispositivo (AsyncStorage).
 *  - `enabled`: si se imprime un número bajo el logo.
 *  - `next`: próximo número a imprimir. Tras un lote se avanza (+copias) para que
 *    la siguiente tanda continúe sin repetir. Editable a mano en cualquier momento.
 */
export interface PromoNumbering {
  enabled: boolean;
  next: number;
}

const DEFAULT_PROMO_NUMBERING: PromoNumbering = { enabled: false, next: 1 };

/** Normaliza el próximo número a un entero >= 0. */
function normalizeNext(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Elección inicial cuando aún no hay nada guardado: primer preset de cada
 * slot de selección única; 'other' arranca vacío (es contenido extra, no algo
 * que deba imprimirse por defecto).
 */
function initialPromoSelection(presets: TextPreset[]): PromoSelection {
  const pickFirst = (slot: SinglePromoSlot): string | null =>
    presets.find((p) => p.kind === 'promo' && p.slot === slot)?.id ?? null;
  return { title: pickFirst('title'), validity: pickFirst('validity'), farewell: pickFirst('farewell'), other: [] };
}

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
  promoSelection: PromoSelection;
  promoNumbering: PromoNumbering;
  loaded: boolean;

  /** Carga presets de SQLite y modos de AsyncStorage. Llamar al arrancar. */
  load: () => Promise<void>;
  /** Recarga solo los presets desde SQLite (tras una mutación). */
  reload: () => Promise<void>;

  addPreset: (kind: TextPresetKind, slot: PresetSlot | null, text: string) => Promise<void>;
  updateText: (id: string, text: string) => Promise<void>;
  toggleEnabled: (id: string, enabled: boolean) => Promise<void>;
  removePreset: (id: string) => Promise<void>;
  setMode: (target: ModeTarget, mode: SlotMode) => Promise<void>;

  /** Fija qué preset se imprime en una parte de selección única del folleto (id o null = ninguno). */
  setPromoSelection: (slot: SinglePromoSlot, id: string | null) => Promise<void>;
  /** Añade/quita un preset 'other' de la selección múltiple del folleto. */
  toggleOtherSelection: (id: string) => Promise<void>;

  /** Activa/desactiva la numeración de los cupones. */
  setPromoNumberingEnabled: (enabled: boolean) => Promise<void>;
  /** Fija el próximo número a imprimir (se normaliza a entero >= 0). */
  setPromoNextNumber: (next: number) => Promise<void>;

  // --- resolvers (usan el estado actual) ---
  resolveHeaderMessage: () => string | null;
  resolveFooterMessage: () => string | null;
  resolveOrderName: () => string | null;

  /**
   * Textos del folleto listos para imprimir según `promoSelection`, con el
   * placeholder `{fecha}` sustituido por `dateStr`. null = esa parte no se imprime.
   * `others` incluye el texto de TODOS los presets 'other' marcados, en el
   * orden en que aparecen en `presets` (puede ser un array vacío).
   */
  resolvePromoLines: (dateStr: string) => {
    title: string | null;
    validity: string | null;
    farewell: string | null;
    others: string[];
  };
}

/** Reglas kind/slot por objetivo. */
function targetFilter(target: ModeTarget): { kind: TextPresetKind; slot: PresetSlot | null } {
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
  promoSelection: DEFAULT_PROMO_SELECTION,
  promoNumbering: DEFAULT_PROMO_NUMBERING,
  loaded: false,

  load: async () => {
    try {
      await initDb();
      const [presets, storedModes, storedPromo, storedNumbering] = await Promise.all([
        getTextPresets(),
        AsyncStorage.getItem(MODES_KEY),
        AsyncStorage.getItem(PROMO_SELECTION_KEY),
        AsyncStorage.getItem(PROMO_NUMBERING_KEY),
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
      // Sin selección guardada (primer arranque) → primer preset de cada slot, para
      // que el folleto imprima algo por defecto. Si ya hay clave, respeta los null.
      let promoSelection: PromoSelection = initialPromoSelection(presets);
      if (storedPromo) {
        try {
          const parsed = JSON.parse(storedPromo) as Partial<PromoSelection>;
          promoSelection = {
            title: parsed.title ?? null,
            validity: parsed.validity ?? null,
            farewell: parsed.farewell ?? null,
            other: Array.isArray(parsed.other) ? parsed.other.filter((x): x is string => typeof x === 'string') : [],
          };
        } catch {
          promoSelection = initialPromoSelection(presets);
        }
      }
      let promoNumbering: PromoNumbering = DEFAULT_PROMO_NUMBERING;
      if (storedNumbering) {
        try {
          const parsed = JSON.parse(storedNumbering) as Partial<PromoNumbering>;
          promoNumbering = {
            enabled: parsed.enabled === true,
            next: normalizeNext(parsed.next ?? DEFAULT_PROMO_NUMBERING.next),
          };
        } catch {
          promoNumbering = DEFAULT_PROMO_NUMBERING;
        }
      }
      set({ presets, modes, promoSelection, promoNumbering, loaded: true });
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
    // Igual para la selección del folleto: si el borrado era el elegido, a null
    // (slots únicos) o se quita del array (slot 'other').
    const promo = get().promoSelection;
    let promoChanged = false;
    const nextPromo: PromoSelection = { ...promo };
    SINGLE_PROMO_SLOTS.forEach((slot) => {
      if (nextPromo[slot] === id) {
        nextPromo[slot] = null;
        promoChanged = true;
      }
    });
    if (nextPromo.other.includes(id)) {
      nextPromo.other = nextPromo.other.filter((otherId) => otherId !== id);
      promoChanged = true;
    }
    if (promoChanged) {
      set({ promoSelection: nextPromo });
      void AsyncStorage.setItem(PROMO_SELECTION_KEY, JSON.stringify(nextPromo)).catch(() => {});
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

  setPromoSelection: async (slot, id) => {
    const next: PromoSelection = { ...get().promoSelection, [slot]: id };
    set({ promoSelection: next });
    try {
      await AsyncStorage.setItem(PROMO_SELECTION_KEY, JSON.stringify(next));
    } catch {
      // silently ignore
    }
  },

  toggleOtherSelection: async (id) => {
    const current = get().promoSelection;
    const other = current.other.includes(id)
      ? current.other.filter((otherId) => otherId !== id)
      : [...current.other, id];
    const next: PromoSelection = { ...current, other };
    set({ promoSelection: next });
    try {
      await AsyncStorage.setItem(PROMO_SELECTION_KEY, JSON.stringify(next));
    } catch {
      // silently ignore
    }
  },

  setPromoNumberingEnabled: async (enabled) => {
    const next: PromoNumbering = { ...get().promoNumbering, enabled };
    set({ promoNumbering: next });
    try {
      await AsyncStorage.setItem(PROMO_NUMBERING_KEY, JSON.stringify(next));
    } catch {
      // silently ignore
    }
  },

  setPromoNextNumber: async (n) => {
    const next: PromoNumbering = { ...get().promoNumbering, next: normalizeNext(n) };
    set({ promoNumbering: next });
    try {
      await AsyncStorage.setItem(PROMO_NUMBERING_KEY, JSON.stringify(next));
    } catch {
      // silently ignore
    }
  },

  resolveHeaderMessage: () => resolveTarget(get().presets, 'header', get().modes.header),
  resolveFooterMessage: () => resolveTarget(get().presets, 'footer', get().modes.footer),
  resolveOrderName: () => resolveTarget(get().presets, 'orderName', get().modes.orderName),

  resolvePromoLines: (dateStr) => {
    const { presets, promoSelection } = get();
    const pick = (slot: SinglePromoSlot): string | null => {
      const id = promoSelection[slot];
      if (!id) return null;
      const preset = presets.find((p) => p.id === id && p.kind === 'promo' && p.slot === slot);
      if (!preset) return null;
      return preset.text.replace(/\{fecha\}/g, dateStr);
    };
    const others = promoSelection.other
      .map((id) => presets.find((p) => p.id === id && p.kind === 'promo' && p.slot === 'other'))
      .filter((p): p is TextPreset => !!p)
      .map((p) => p.text.replace(/\{fecha\}/g, dateStr));
    return { title: pick('title'), validity: pick('validity'), farewell: pick('farewell'), others };
  },
}));
