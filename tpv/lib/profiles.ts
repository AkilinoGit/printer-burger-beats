// Lista de perfiles de carta para el selector de "carta activa en venta".
//
// Un perfil ya NO es un enum cerrado en código: la app descubre los perfiles
// disponibles en tiempo de ejecución, sin literales hardcodeados. Hay dos
// fuentes, por orden de prioridad:
//
//   1. La entidad `profiles` del catálogo (backend/admin) → autoritativa:
//      incluye perfiles aún sin productos, con nombre/icono/orden del admin.
//   2. Si el backend no la envía (respuesta antigua u offline sin ese dato),
//      se derivan de los productos cargados: un perfil por cada valor distinto
//      de `Product.profile` entre los productos no-custom.
//
// OTROS (isCustom) es transversal a todas las cartas, así que NO cuenta como
// perfil propio. La lista nunca queda vacía: garantiza el perfil por defecto.

import type { Product, Profile } from './types';

export const DEFAULT_PROFILE = 'burger';

export interface ProfileMeta {
  value: string;   // slug guardado en Product.profile y en AsyncStorage
  label: string;   // nombre visible en el selector
  icon?: string;   // icono MaterialCommunityIcons (opcional)
  order: number;   // orden en el selector (menor = antes)
}

/**
 * Metadatos de los perfiles históricamente hardcodeados. Sirven de respaldo
 * para conservar etiqueta e icono conocidos aunque el backend todavía no sirva
 * la entidad `profiles`. Cualquier perfil NUEVO no necesita entrada aquí:
 * hereda una etiqueta legible (prettify) y aparece igualmente.
 */
const KNOWN_PROFILE_META: Record<string, { label: string; icon: string; order: number }> = {
  burger: { label: 'Burger', icon: 'hamburger', order: 0 },
  cafe: { label: 'Cafetería', icon: 'coffee', order: 1 },
};

/** Etiqueta de último recurso a partir del slug: 'menu-dia' -> 'Menu dia'. */
function prettify(slug: string): string {
  const s = slug.replace(/[-_]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : slug;
}

/**
 * Construye la lista de perfiles para el selector. Nunca lanza y nunca devuelve
 * un array vacío. Ordena por `order` y, a igualdad, alfabéticamente.
 */
export function buildProfileList(products: Product[], backendProfiles?: Profile[]): ProfileMeta[] {
  let metas: ProfileMeta[];

  if (backendProfiles && backendProfiles.length > 0) {
    // Fuente autoritativa: la entidad del backend/admin.
    metas = backendProfiles.map((p, i) => ({
      value: p.id,
      label: p.name || prettify(p.id),
      icon: p.icon ?? KNOWN_PROFILE_META[p.id]?.icon,
      order: p.sortOrder ?? i,
    }));
  } else {
    // Derivar de los productos: un perfil por cada valor distinto (no-custom),
    // conservando el orden de primera aparición para los desconocidos.
    const firstSeen = new Map<string, number>();
    products.forEach((p, i) => {
      if (p.isCustom) return;
      if (!firstSeen.has(p.profile)) firstSeen.set(p.profile, i);
    });
    metas = [...firstSeen.entries()].map(([value, appearance]) => {
      const known = KNOWN_PROFILE_META[value];
      return {
        value,
        label: known?.label ?? prettify(value),
        icon: known?.icon,
        // Conocidos primero (orden fijo), luego los nuevos por aparición.
        order: known?.order ?? 100 + appearance,
      };
    });
  }

  if (metas.length === 0) {
    const known = KNOWN_PROFILE_META[DEFAULT_PROFILE];
    metas = [{ value: DEFAULT_PROFILE, label: known.label, icon: known.icon, order: 0 }];
  }

  return metas.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}
