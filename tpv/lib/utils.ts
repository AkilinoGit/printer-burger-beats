/**
 * Formats a number as a euro price string.
 * e.g. 13.4 → "13,40 €"
 */
export function formatPrice(amount: number): string {
  return amount.toFixed(2).replace('.', ',') + ' €';
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

// ---------------------------------------------------------------------------
// Verdura modifier collapsing
// ---------------------------------------------------------------------------

const VERDURA_SIN_IDS = ['sin-cebolla', 'sin-lechuga', 'sin-tomate'] as const;
const VERDURA_LABEL: Record<(typeof VERDURA_SIN_IDS)[number], string> = {
  'sin-cebolla': 'Cebolla',
  'sin-lechuga': 'Lechuga',
  'sin-tomate':  'Tomate',
};

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
 * Rule: if selectedModifiers contains exactly 2 of {sin-cebolla, sin-lechuga,
 * sin-tomate}, drop those 2 ids and insert SOLO_VERDURA_ID (with a dynamic
 * label "Solo <remaining>") in place of the first one.
 */
export function collapseVerduraModifiers(
  selectedModifiers: readonly string[],
): { ids: string[]; extraLabels: Record<string, string> } {
  const present = VERDURA_SIN_IDS.filter((id) => selectedModifiers.includes(id));
  if (present.length !== 2) {
    return { ids: [...selectedModifiers], extraLabels: {} };
  }
  const remaining = VERDURA_SIN_IDS.find((id) => !present.includes(id))!;
  const label = 'Solo ' + VERDURA_LABEL[remaining];

  const firstIdx = selectedModifiers.findIndex((id) => present.includes(id as typeof present[number]));
  const ids: string[] = [];
  let inserted = false;
  for (let i = 0; i < selectedModifiers.length; i++) {
    const id = selectedModifiers[i];
    if (present.includes(id as typeof present[number])) {
      if (i === firstIdx && !inserted) {
        ids.push(SOLO_VERDURA_ID);
        inserted = true;
      }
      continue;
    }
    ids.push(id);
  }
  return { ids, extraLabels: { [SOLO_VERDURA_ID]: label } };
}
