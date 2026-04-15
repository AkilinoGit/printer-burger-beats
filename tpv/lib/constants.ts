import type { Modifier, Product } from './types';

const SIN_QUESO:        Modifier = { id: 'sin-queso',        label: 'Sin queso',        type: 'remove' };
const SIN_LECHUGA:      Modifier = { id: 'sin-lechuga',      label: 'Sin lechuga',      type: 'remove' };
const SIN_CEBOLLA:      Modifier = { id: 'sin-cebolla',      label: 'Sin cebolla',      type: 'remove' };
const SIN_TOMATE:       Modifier = { id: 'sin-tomate',       label: 'Sin tomate',       type: 'remove' };
const SIN_BACON:        Modifier = { id: 'sin-bacon',        label: 'Sin bacon',        type: 'remove' };
const SIN_SALSA:        Modifier = { id: 'sin-salsa',        label: 'Sin salsa',        type: 'remove' };
const SIN_VERDURA:      Modifier = { id: 'sin-verdura',      label: 'Sin verdura',      type: 'remove' };
const SIN_CEB_CRISPY:   Modifier = { id: 'sin-cebolla-crispy', label: 'Sin cebolla crispy', type: 'remove' };
const SIN_CARNE_MECH:   Modifier = { id: 'sin-carne-mechada',  label: 'Sin carne mechada',  type: 'remove' };
const SIN_UNA_CARNE:    Modifier = { id: 'sin-una-carne',    label: 'Sin una carne',    type: 'remove', priceAdd: -1.50 };
const EXTRA_CARNE:      Modifier = { id: 'extra-carne',      label: 'Extra de carne',   type: 'add',    priceAdd:  1.00 };
const EXTRA_BACON:      Modifier = { id: 'extra-bacon',      label: 'Extra bacon',      type: 'add',    priceAdd:  1.00 };

export const INITIAL_MODIFIERS: Modifier[] = [
  SIN_QUESO, SIN_LECHUGA, SIN_CEBOLLA, SIN_TOMATE, SIN_BACON,
  SIN_SALSA, SIN_VERDURA, SIN_CEB_CRISPY, SIN_CARNE_MECH,
  SIN_UNA_CARNE, EXTRA_CARNE, EXTRA_BACON,
];

const SALSA_RADIO_NINO: Modifier = {
  id: 'nino-salsa',
  label: 'Salsa',
  type: 'radio',
  noSelectionLabel: 'Sin salsa',
  options: [
    { id: 'salsa-sin-nada', label: 'Sin nada' },
    { id: 'salsa-ketchup',  label: 'Ketchup'  },
    { id: 'salsa-ali-oli',  label: 'Ali Oli'  },
    { id: 'salsa-mostaza',  label: 'Mostaza'  },
    { id: 'salsa-fat',      label: 'Fat'      },
    { id: 'salsa-ben',      label: 'Ben'      },
    { id: 'salsa-doble',    label: 'Doble'    },
  ],
};

const SALSA_RADIO_ALITAS: Modifier = {
  id: 'alitas-salsa',
  label: 'Salsa',
  type: 'radio',
  noSelectionLabel: 'Sin salsa',
  options: [
    { id: 'salsa-sin-nada', label: 'Sin nada' },
    { id: 'salsa-ketchup',  label: 'Ketchup'  },
    { id: 'salsa-ali-oli',  label: 'Ali Oli'  },
    { id: 'salsa-mostaza',  label: 'Mostaza'  },
    { id: 'salsa-fat',      label: 'Fat'      },
    { id: 'salsa-ben',      label: 'Ben'      },
    { id: 'salsa-doble',    label: 'Doble'    },
    { id: 'salsa-mango',    label: 'Mango'    },
  ],
};

const SALSA_RADIO_TEKENOS: Modifier = {
  id: 'tekenos-salsa',
  label: 'Salsa',
  type: 'radio',
  noSelectionLabel: 'Sin salsa',
  options: [
    { id: 'salsa-sin-nada', label: 'Sin nada' },
    { id: 'salsa-ketchup',  label: 'Ketchup'  },
    { id: 'salsa-ali-oli',  label: 'Ali Oli'  },
    { id: 'salsa-mostaza',  label: 'Mostaza'  },
    { id: 'salsa-fat',      label: 'Fat'      },
    { id: 'salsa-ben',      label: 'Ben'      },
    { id: 'salsa-doble',    label: 'Doble'    },
  ],
};

const SIN_GLUTEN: Modifier = { id: 'mod_sin_gluten', label: 'Sin Gluten', type: 'remove', priceAdd: 0 };

const MOD_FAT_FURIOUS: Modifier[] = [
  SIN_GLUTEN, SIN_QUESO, SIN_CEB_CRISPY, SIN_SALSA, SIN_CARNE_MECH, SIN_UNA_CARNE, EXTRA_CARNE,
];

const MOD_BEN_MUERDE: Modifier[] = [
  SIN_GLUTEN, SIN_QUESO, SIN_CEBOLLA, SIN_SALSA, SIN_BACON, SIN_UNA_CARNE, EXTRA_BACON,
];

const MOD_DOBLE_SUBWOOFER: Modifier[] = [
  SIN_GLUTEN, SIN_QUESO, SIN_VERDURA, SIN_SALSA, SIN_TOMATE, SIN_LECHUGA, SIN_CEBOLLA, SIN_UNA_CARNE, EXTRA_BACON,
];

const MOD_PATATAS: Modifier[] = [
  { id: 'patatas-sin-nada',       label: 'Sin nada',       type: 'add' },
  { id: 'patatas-con-todo',       label: 'Con todo',       type: 'add' },
  { id: 'patatas-ketchup',        label: 'Ketchup',        type: 'add' },
  { id: 'patatas-mostaza-dulce',  label: 'Mostaza dulce',  type: 'add' },
  { id: 'patatas-ali-oli',        label: 'Ali Oli',        type: 'add' },
];

const MOD_BURGER_NINO: Modifier[] = [
  SIN_GLUTEN,
  SALSA_RADIO_NINO,
  { id: 'nino-bacon',   label: 'Bacon',   type: 'add', priceAdd: 1.00 },
  { id: 'nino-verdura', label: 'Verdura', type: 'add', priceAdd: 0.50 },
];

export const INITIAL_PRODUCTS: Product[] = [
  { id: 'fat-furious',     name: 'FAT & FURIOUS',   basePrice: 13.40, category: 'burger', modifiers: MOD_FAT_FURIOUS,   isCustom: false, isActive: true },
  { id: 'ben-muerde',      name: 'BEN Y MUERDE',    basePrice: 12.50, category: 'burger', modifiers: MOD_BEN_MUERDE,      isCustom: false, isActive: true },
  { id: 'doble-subwoofer', name: 'DOBLE SUBWOOFER', basePrice: 11.00, category: 'burger', modifiers: MOD_DOBLE_SUBWOOFER, isCustom: false, isActive: true },
  { id: 'patatas',         name: 'PATATAS',          basePrice:  6.00, category: 'side',   modifiers: MOD_PATATAS, isCustom: false, isActive: true, alwaysShowModifiers: true },
  { id: 'alitas',          name: 'ALITAS',           basePrice:  8.00, category: 'side',   modifiers: [SALSA_RADIO_ALITAS],  isCustom: false, isActive: true },
  { id: 'tekenos',         name: 'TEKEÑOS',          basePrice:  8.00, category: 'side',   modifiers: [SALSA_RADIO_TEKENOS], isCustom: false, isActive: true },
  { id: 'gyozas',          name: 'GYOZAS',           basePrice:  8.00, category: 'side',   modifiers: [], isCustom: false, isActive: true },
  { id: 'bebida',          name: 'BEBIDA',           basePrice:  2.00, category: 'drink',  modifiers: [], isCustom: false, isActive: true },
  { id: 'agua',            name: 'AGUA',             basePrice:  1.00, category: 'drink',  modifiers: [], isCustom: false, isActive: true },
  { id: 'burger-nino',     name: 'BURGER NIÑO',      basePrice:  8.00, category: 'custom', modifiers: MOD_BURGER_NINO,   isCustom: false, isActive: true },
  { id: 'otros',           name: 'OTROS',            basePrice:  0.00, category: 'custom', modifiers: [], isCustom: true,  isActive: true },
];

export const DEFAULT_LOCATION_NAME = 'Local principal';

export const DEFAULT_FERIANTE_PRICES: Record<string, number> = {
  'fat-furious': 11,
  'ben-muerde': 10,
  'doble-subwoofer': 10,
  'alitas': 6,
  'tekenos': 6,
  'patatas': 5,
};

/**
 * Returns a flat map of id → label covering:
 * - all INITIAL_MODIFIERS
 * - all radio option ids from every product
 * Used by escpos.ts and ticket screen to resolve modifier ids to readable labels.
 */
export function buildModifierLabels(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of INITIAL_MODIFIERS) {
    map[m.id] = m.label;
  }
  for (const p of INITIAL_PRODUCTS) {
    for (const m of p.modifiers) {
      map[m.id] = m.label;
      for (const opt of m.options ?? []) {
        map[opt.id] = opt.label;
      }
    }
  }
  return map;
}

/**
 * Returns a map of radio modifier id → noSelectionLabel
 * Used by escpos.ts to print e.g. "Sin salsa" when no option was chosen.
 */
export function buildRadioNoSelectionLabels(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of INITIAL_PRODUCTS) {
    for (const m of p.modifiers) {
      if (m.type === 'radio' && m.noSelectionLabel) {
        map[m.id] = m.noSelectionLabel;
      }
    }
  }
  return map;
}

/**
 * Returns a map of radio modifier id → Set of option ids
 * Used by escpos.ts to detect which options belong to which radio group.
 */
export function buildRadioOptionSets(): Record<string, Set<string>> {
  const map: Record<string, Set<string>> = {};
  for (const p of INITIAL_PRODUCTS) {
    for (const m of p.modifiers) {
      if (m.type === 'radio') {
        map[m.id] = new Set((m.options ?? []).map((o) => o.id));
      }
    }
  }
  return map;
}
