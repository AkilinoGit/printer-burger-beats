import type { Modifier, Product } from './types';

export const INITIAL_MODIFIERS: Modifier[] = [
  { id: 'sin-lechuga',   label: 'Sin lechuga',   type: 'remove' },
  { id: 'sin-cebolla',   label: 'Sin cebolla',   type: 'remove' },
  { id: 'sin-tomate',    label: 'Sin tomate',    type: 'remove' },
  { id: 'sin-pepinillo', label: 'Sin pepinillo', type: 'remove' },
  { id: 'sin-bacon',     label: 'Sin bacon',     type: 'remove' },
  { id: 'extra-queso',   label: 'Extra queso',   type: 'add'    },
];

export const INITIAL_PRODUCTS: Product[] = [
  { id: 'fat-furious',     name: 'FAT & FURIOUS',   basePrice: 13.40, category: 'burger', modifiers: INITIAL_MODIFIERS, isCustom: false, isActive: true },
  { id: 'ben-muerde',      name: 'BEN Y MUERDE',    basePrice: 12.50, category: 'burger', modifiers: INITIAL_MODIFIERS, isCustom: false, isActive: true },
  { id: 'doble-subwoofer', name: 'DOBLE SUBWOOFER', basePrice: 11.00, category: 'burger', modifiers: INITIAL_MODIFIERS, isCustom: false, isActive: true },
  { id: 'burger-nino',     name: 'BURGER NIÑO',      basePrice:  8.00, category: 'burger', modifiers: INITIAL_MODIFIERS, isCustom: false, isActive: true },
  { id: 'tekenos',         name: 'TEKEÑOS',          basePrice:  8.00, category: 'side',   modifiers: [], isCustom: false, isActive: true },
  { id: 'alitas',          name: 'ALITAS',           basePrice:  8.00, category: 'side',   modifiers: [], isCustom: false, isActive: true },
  { id: 'gyozas',          name: 'GYOZAS',           basePrice:  8.00, category: 'side',   modifiers: [], isCustom: false, isActive: true },
  { id: 'patatas',         name: 'PATATAS',          basePrice:  6.00, category: 'side',   modifiers: [], isCustom: false, isActive: true },
  { id: 'bebida',          name: 'BEBIDA',           basePrice:  2.00, category: 'drink',  modifiers: [], isCustom: false, isActive: true },
  { id: 'agua',            name: 'AGUA',             basePrice:  1.00, category: 'drink',  modifiers: [], isCustom: false, isActive: true },
  { id: 'otros',           name: 'OTROS',            basePrice:  0.00, category: 'custom', modifiers: [], isCustom: true,  isActive: true },
];

export const DEFAULT_LOCATION_NAME = 'Local principal';
