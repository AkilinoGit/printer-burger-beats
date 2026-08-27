/**
 * Formats a number as a euro price string.
 * e.g. 13.4 → "13,40 €"
 */
export function formatPrice(amount: number): string {
  return amount.toFixed(2).replace('.', ',') + ' €';
}

/**
 * Aplica el descuento de jornada (0/15/30 %) a un total de sesión,
 * redondeando a céntimos.
 */
export function applySessionDiscount(total: number, pct: number): number {
  if (!pct) return total;
  return Math.round(total * (100 - pct)) / 100;
}

/**
 * Calculates the change to return to a customer.
 * Returns null if amountPaid < total (shouldn't happen in UI, but guard anyway).
 */
export function calcChange(total: number, amountPaid: number): number | null {
  const change = amountPaid - total;
  return change >= 0 ? Math.round(change * 100) / 100 : null;
}

/**
 * Generates a UUID v4 string (RFC4122).
 * Uses crypto.getRandomValues when available (React Native >= 0.73 exposes it globally).
 */
export function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Returns current ISO date string YYYY-MM-DD.
 */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Returns current time as HH:MM string.
 */
export function currentTime(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export const SESSION_STALE_HOURS = 20;

/**
 * Returns true if a session's openedAt timestamp is older than SESSION_STALE_HOURS.
 * Used to warn the user they may be writing tickets onto yesterday's session.
 */
export function isSessionStale(openedAt: string | null): boolean {
  if (!openedAt) return false;
  return Date.now() - new Date(openedAt).getTime() >= SESSION_STALE_HOURS * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Verdura modifier collapsing
// ---------------------------------------------------------------------------

// Verdura "sin" modifiers, by short suffix. Modifiers may be stored with
// a productId prefix (e.g. "doble-subwoofer-sin-cebolla") or bare ("sin-cebolla").
const VERDURA_SUFFIX_LABEL: Record<string, string> = {
  'sin-cebolla': 'Cebolla',
  'sin-lechuga': 'Lechuga',
  'sin-tomate':  'Tomate',
};
const VERDURA_SUFFIXES = Object.keys(VERDURA_SUFFIX_LABEL);

/** Returns the verdura suffix matched in `id`, or null. */
function _verduraSuffix(id: string): string | null {
  for (const suf of VERDURA_SUFFIXES) {
    if (id === suf || id.endsWith('-' + suf)) return suf;
  }
  return null;
}

/**
 * Sentinel id injected at print/preview time only — never persisted.
 * When 2 of the 3 verdura "sin" modifiers are selected, the pair is collapsed
 * into a single "Solo X" line where X is the remaining verdura.
 * The label is provided alongside via `extraLabels`.
 */
export const SOLO_VERDURA_ID = '__solo_verdura__';

/**
 * Returns the modifier id list to render for a single item, applying the
 * verdura collapse rule. Pure presentation — does not mutate the item.
 *
 * Rule: if selectedModifiers contains exactly 2 of the verdura "sin"
 * modifiers (sin-cebolla / sin-lechuga / sin-tomate, with or without product
 * prefix), drop those 2 ids and insert SOLO_VERDURA_ID in place of the first
 * one, labelled "Solo <remaining>".
 */
export function collapseVerduraModifiers(
  selectedModifiers: readonly string[],
): { ids: string[]; extraLabels: Record<string, string> } {
  const presentSuffixes: string[] = [];
  for (const id of selectedModifiers) {
    const suf = _verduraSuffix(id);
    if (suf && !presentSuffixes.includes(suf)) presentSuffixes.push(suf);
  }
  if (presentSuffixes.length !== 2) {
    return { ids: [...selectedModifiers], extraLabels: {} };
  }
  const remainingSuf = VERDURA_SUFFIXES.find((s) => !presentSuffixes.includes(s))!;
  const label = 'Solo ' + VERDURA_SUFFIX_LABEL[remainingSuf];

  const firstMatchIdx = selectedModifiers.findIndex((id) => _verduraSuffix(id) !== null);
  const ids: string[] = [];
  for (let i = 0; i < selectedModifiers.length; i++) {
    const id = selectedModifiers[i];
    if (_verduraSuffix(id) !== null) {
      if (i === firstMatchIdx) ids.push(SOLO_VERDURA_ID);
      continue;
    }
    ids.push(id);
  }
  return { ids, extraLabels: { [SOLO_VERDURA_ID]: label } };
}
