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
