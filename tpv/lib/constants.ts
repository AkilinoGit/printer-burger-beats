import type { Modifier, Product, PresetSlot, TextPresetKind } from './types';

// --- VERDURA (verde) ---
const SIN_CEBOLLA:      Modifier = { id: 'sin-cebolla',        label: 'Sin cebolla',        type: 'remove', section: 'verdura',     order: 1 };
const SIN_LECHUGA:      Modifier = { id: 'sin-lechuga',        label: 'Sin lechuga',        type: 'remove', section: 'verdura',     order: 2 };
const SIN_TOMATE:       Modifier = { id: 'sin-tomate',         label: 'Sin tomate',         type: 'remove', section: 'verdura',     order: 3 };
const SIN_VERDURA:      Modifier = { id: 'sin-verdura',        label: 'Sin verdura',        type: 'remove', section: 'verdura',     order: 4 };
const SIN_CEB_CRISPY:   Modifier = { id: 'sin-cebolla-crispy', label: 'Sin cebolla crispy', type: 'remove', section: 'verdura',     order: 5 };

// --- QUESO Y SALSA (naranja) ---
const SIN_QUESO:        Modifier = { id: 'sin-queso',          label: 'Sin queso',          type: 'remove', section: 'queso-salsa', order: 1 };
const SIN_SALSA:        Modifier = { id: 'sin-salsa',          label: 'Sin salsa',          type: 'remove', section: 'queso-salsa', order: 2 };

// --- CARNE (rojo) ---
const SIN_BACON:        Modifier = { id: 'sin-bacon',          label: 'Sin bacon',          type: 'remove', section: 'carne',       order: 1 };
const SIN_CARNE_MECH:   Modifier = { id: 'sin-carne-mechada',  label: 'Sin carne mechada',  type: 'remove', section: 'carne',       order: 2 };
const SIN_UNA_CARNE:    Modifier = { id: 'sin-una-carne',      label: 'Sin una carne',      type: 'remove', section: 'carne',       order: 3, priceAdd: -1.50 };

// --- EXTRA (morado) ---
const CEBOLLA_CARAM:    Modifier = { id: 'cebolla-caramelizada', label: 'Cebolla Caram.',   type: 'add',    section: 'extra',       order: 1 };

// --- EXTRAS de carne (rojo, dentro de sección 'carne') ---
const EXTRA_CARNE:      Modifier = { id: 'extra-carne',         label: 'Extra de carne',    type: 'add',    section: 'carne',       order: 10, priceAdd: 1.00 };
const EXTRA_BACON:      Modifier = { id: 'extra-bacon',         label: 'Extra bacon',       type: 'add',    section: 'carne',       order: 11, priceAdd: 1.00 };

export const INITIAL_MODIFIERS: Modifier[] = [
  SIN_QUESO, SIN_LECHUGA, SIN_CEBOLLA, SIN_TOMATE, SIN_BACON,
  SIN_SALSA, SIN_VERDURA, SIN_CEB_CRISPY, SIN_CARNE_MECH,
  SIN_UNA_CARNE, CEBOLLA_CARAM, EXTRA_CARNE, EXTRA_BACON,
];

const SALSA_RADIO_NINO: Modifier = {
  id: 'nino-salsa',
  label: 'Salsa',
  type: 'radio',
  section: 'queso-salsa',
  order: 10,
  noSelectionLabel: 'Sin salsa',
  options: [
    { id: 'salsa-sin-nada', label: 'Sin nada' },
    { id: 'salsa-ketchup',  label: 'Ketchup'  },
    { id: 'salsa-ali-oli',  label: 'Ali Oli'  },
    { id: 'salsa-mostaza',  label: 'Mostaza'  },
    { id: 'salsa-bbq',      label: 'BBQ'      },
    { id: 'salsa-fat',      label: 'Fat'      },
    { id: 'salsa-ben',      label: 'Ben'      },
    { id: 'salsa-doble',    label: 'Doble'    },
  ],
};

const SALSA_RADIO_ALITAS: Modifier = {
  id: 'alitas-salsa',
  label: 'Salsa',
  type: 'radio',
  section: 'queso-salsa',
  order: 10,
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
  section: 'queso-salsa',
  order: 10,
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

const SIN_GLUTEN: Modifier = { id: 'mod_sin_gluten', label: 'Sin Gluten', type: 'remove', section: 'otros', order: 1, priceAdd: 0 };

const MOD_FAT_FURIOUS: Modifier[] = [
  SIN_GLUTEN, SIN_QUESO, SIN_CEB_CRISPY, SIN_SALSA, SIN_CARNE_MECH, SIN_UNA_CARNE, CEBOLLA_CARAM, EXTRA_CARNE,
];

const MOD_BEN_MUERDE: Modifier[] = [
  SIN_GLUTEN, SIN_QUESO, SIN_CEBOLLA, SIN_SALSA, SIN_BACON, SIN_UNA_CARNE, CEBOLLA_CARAM, EXTRA_BACON,
];

const MOD_DOBLE_SUBWOOFER: Modifier[] = [
  SIN_GLUTEN, SIN_QUESO, SIN_VERDURA, SIN_SALSA, SIN_TOMATE, SIN_LECHUGA, SIN_CEBOLLA, SIN_BACON, SIN_UNA_CARNE, CEBOLLA_CARAM, EXTRA_BACON,
];

// Extras compartidos por PATATAS y SALCHIPAPAS (+1 EUR cada uno)
const CON_BACON: Modifier = { id: 'con-bacon', label: 'Con Bacon', type: 'add', section: 'carne',       order: 10, priceAdd: 1.00 };
const CON_QUESO: Modifier = { id: 'con-queso', label: 'Con Queso', type: 'add', section: 'queso-salsa', order: 20, priceAdd: 1.00 };

const MOD_PATATAS: Modifier[] = [
  { id: 'patatas-sin-nada',       label: 'Sin nada',       type: 'add', section: 'queso-salsa', order: 1 },
  { id: 'patatas-con-todo',       label: 'Con todo',       type: 'add', section: 'queso-salsa', order: 2 },
  { id: 'patatas-ketchup',        label: 'Ketchup',        type: 'add', section: 'queso-salsa', order: 3 },
  { id: 'patatas-mostaza-dulce',  label: 'Mostaza dulce',  type: 'add', section: 'queso-salsa', order: 4 },
  { id: 'patatas-ali-oli',        label: 'Ali Oli',        type: 'add', section: 'queso-salsa', order: 5 },
  CON_QUESO,
  CON_BACON,
];

const MOD_BURGER_VEGET: Modifier[] = [
  SIN_CEBOLLA, SIN_TOMATE, SIN_LECHUGA, SIN_SALSA,
  { id: 'veget-bacon',           label: 'Con bacon',           type: 'add', section: 'carne', order: 10 },
  { id: 'veget-cebolla-caram',   label: 'Con cebolla caram.',  type: 'add', section: 'extra', order: 1 },
];

const MOD_BURGER_NINO: Modifier[] = [
  SIN_GLUTEN,
  SIN_BACON,
  SALSA_RADIO_NINO,
  { id: 'nino-queso',   label: 'Queso',   type: 'add', section: 'queso-salsa', order: 20 },
  { id: 'nino-bacon',   label: 'Bacon',   type: 'add', section: 'carne',       order: 10 },
  { id: 'nino-lechuga', label: 'Lechuga', type: 'add', section: 'verdura',     order: 10 },
  { id: 'nino-tomate',  label: 'Tomate',  type: 'add', section: 'verdura',     order: 11 },
  { id: 'nino-cebolla', label: 'Cebolla', type: 'add', section: 'verdura',     order: 12 },
];

/**
 * Id de PERRITO en el backend. Es un UUID (el producto nacio en el admin web,
 * no en esta semilla) frente a los slugs del resto de la carta. Se declara
 * aparte porque lo usan INITIAL_PRODUCTS, DEFAULT_FERIANTE_PRICES y la
 * migracion v35 (fusion del duplicado local 'perrito').
 */
export const PERRITO_ID = '0f8ebf22-5885-4221-8321-f2cf87917f3c';

/** Id que tuvo PERRITO en la semilla v33/v34, antes de alinearlo con el backend. */
export const LEGACY_PERRITO_ID = 'perrito';

export const INITIAL_PRODUCTS: Product[] = [
  { id: 'fat-furious',     name: 'FAT & FURIOUS',   basePrice: 13.40, category: 'HAMBURGUESAS', categoryOrder: 0, profile: 'burger', modifiers: MOD_FAT_FURIOUS,   isCustom: false, isActive: true },
  { id: 'ben-muerde',      name: 'BEN Y MUERDE',    basePrice: 12.00, category: 'HAMBURGUESAS', categoryOrder: 0, profile: 'burger', modifiers: MOD_BEN_MUERDE,      isCustom: false, isActive: true },
  { id: 'doble-subwoofer', name: 'DOBLE SUBWOOFER', basePrice: 12.00, category: 'HAMBURGUESAS', categoryOrder: 0, profile: 'burger', modifiers: MOD_DOBLE_SUBWOOFER, isCustom: false, isActive: true },
  { id: 'burger-nino',     name: 'BURGER NIÑO',      basePrice:  8.00, category: 'HAMBURGUESAS', categoryOrder: 0, profile: 'burger', modifiers: MOD_BURGER_NINO,   isCustom: false, isActive: true },
  { id: 'patatas',         name: 'PATATAS',          basePrice:  6.00, category: 'ACOMPAÑANTES', categoryOrder: 1, profile: 'burger', modifiers: MOD_PATATAS, isCustom: false, isActive: true },
  { id: 'salchipapas',     name: 'SALCHIPAPAS',      basePrice:  7.00, category: 'ACOMPAÑANTES', categoryOrder: 1, profile: 'burger', modifiers: MOD_PATATAS, isCustom: false, isActive: true },
  { id: 'alitas',          name: 'ALITAS',           basePrice:  8.00, category: 'ACOMPAÑANTES', categoryOrder: 1, profile: 'burger', modifiers: [SALSA_RADIO_ALITAS],  isCustom: false, isActive: true },
  { id: 'tekenos',         name: 'TEKEÑOS',          basePrice:  8.00, category: 'ACOMPAÑANTES', categoryOrder: 1, profile: 'burger', modifiers: [SALSA_RADIO_TEKENOS], isCustom: false, isActive: true },
  { id: 'gyozas-pollo',    name: 'GYOZAS POLLO',     basePrice:  8.00, category: 'ACOMPAÑANTES', categoryOrder: 1, profile: 'burger', modifiers: [], isCustom: false, isActive: true },
  { id: 'gyozas-verdura',  name: 'GYOZAS VERDURA',   basePrice:  8.00, category: 'ACOMPAÑANTES', categoryOrder: 1, profile: 'burger', modifiers: [], isCustom: false, isActive: true },
  // PERRITO se dio de alta en el backend (admin web) y recibio ALLI su id (UUID).
  // La semilla usa ESE id, no un slug propio, para que semilla y catalogo remoto
  // sean la MISMA fila: si no, el sync no las empareja y salen dos PERRITO.
  { id: PERRITO_ID,        name: 'PERRITO',          basePrice:  6.00, category: 'ACOMPAÑANTES', categoryOrder: 1, profile: 'burger', modifiers: [], isCustom: false, isActive: true },
  { id: 'bebida',          name: 'BEBIDA',           basePrice:  2.00, category: 'BEBIDAS',      categoryOrder: 2, profile: 'burger', modifiers: [], isCustom: false, isActive: true },
  { id: 'agua',            name: 'AGUA',             basePrice:  1.00, category: 'BEBIDAS',      categoryOrder: 2, profile: 'burger', modifiers: [], isCustom: false, isActive: true },
  { id: 'cerveza',         name: 'CERVEZA',          basePrice:  2.50, category: 'BEBIDAS',      categoryOrder: 2, profile: 'burger', modifiers: [], isCustom: false, isActive: true },
  { id: 'burger-veget',    name: 'BURGER VEGETARIANA', basePrice: 13.50, category: 'OTROS',      categoryOrder: 3, profile: 'burger', modifiers: MOD_BURGER_VEGET, isCustom: false, isActive: true },
  { id: 'otros',           name: 'OTROS',            basePrice:  0.00, category: 'OTROS',        categoryOrder: 3, profile: 'burger', modifiers: [], isCustom: true,  isActive: true },
];

export const DEFAULT_LOCATION_NAME = 'Local principal';

export const DEFAULT_FERIANTE_PRICES: Record<string, number> = {
  'fat-furious': 11,
  'ben-muerde': 10,
  'doble-subwoofer': 10,
  'alitas': 6,
  'tekenos': 6,
  'gyozas-pollo': 6,
  'gyozas-verdura': 6,
  'patatas': 5,
  'salchipapas': 5,
  [PERRITO_ID]: 5,
};

// ---------------------------------------------------------------------------
// Text presets — semilla inicial (migración v29)
// ---------------------------------------------------------------------------

/**
 * Forma reducida de un preset para la semilla: la migración v29 rellena
 * `enabled`/`createdAt`/`updatedAt`/`syncStatus`/`deletedAt`/`origin`.
 */
export interface SeedTextPreset {
  id: string;
  kind: TextPresetKind;
  text: string;
  slot: PresetSlot | null;
  sortOrder: number;
}

/**
 * Presets iniciales. Sustituyen a los textos que estaban hardcodeados en
 * `escpos.ts` (mensaje de catering en la cabecera y despedida en el pie) y
 * aportan una batería de nombres para pedidos sin nombre.
 */
export const INITIAL_TEXT_PRESETS: SeedTextPreset[] = [
  {
    id: 'msg-catering',
    kind: 'ticket_message',
    slot: 'header',
    sortOrder: 1,
    text:
      'Escríbenos para reservar tu pedido o servicio de catering para eventos ' +
      'privados o comidas populares (paellas, almuerzo segador, bocadillos, etc ...)',
  },
  {
    id: 'msg-gracias',
    kind: 'ticket_message',
    slot: 'footer',
    sortOrder: 1,
    text: 'GRACIAS POR VENIR :)',
  },
  // ── Folleto / cupón (kind 'promo') ─────────────────────────────────────────
  // Titular grande (menú elegible), línea de validez y despedida. La validez
  // admite el placeholder {fecha}, sustituido al imprimir por la fecha elegida.
  {
    id: 'promo-title-1',
    kind: 'promo',
    slot: 'title',
    sortOrder: 1,
    text: '2X1 EN HAMBURGUESAS',
  },
  {
    id: 'promo-title-2',
    kind: 'promo',
    slot: 'title',
    sortOrder: 2,
    text: '10% DE DESCUENTO',
  },
  {
    id: 'promo-validity-1',
    kind: 'promo',
    slot: 'validity',
    sortOrder: 1,
    text: 'Válido únicamente el día {fecha}',
  },
  {
    id: 'promo-farewell-1',
    kind: 'promo',
    slot: 'farewell',
    sortOrder: 1,
    text: 'Gracias por su visita',
  },
  ...[
    'ARYA', 'BRIENNE', 'CERSEI', 'DAENERYS', 'EDDARD', 'GENDRY', 'HODOR',
    'JAIME', 'JON', 'MARGAERY', 'MISSANDEI', 'OBERYN', 'PODRICK', 'RENLY',
    'SANSA', 'THEON', 'TORMUND', 'TYRION', 'VARYS', 'YARA',
  ].map<SeedTextPreset>((name, i) => ({
    id: `name-${String(i + 1).padStart(2, '0')}`,
    kind: 'order_name',
    slot: null,
    sortOrder: i + 1,
    text: name,
  })),
];

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
