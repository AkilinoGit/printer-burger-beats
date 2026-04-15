/**
 * Lightweight in-app logger — memory-first, zero SQLite writes on the hot path.
 *
 * Entries accumulate in a JS array (capped at MAX_BUFFER).
 * They are flushed to SQLite only when explicitly requested (e.g. "Ver logs").
 * This keeps the critical sale path completely free of DB contention.
 */

import type { LogLevel } from './db';

export type { LogLevel };

// ---------------------------------------------------------------------------
// In-memory buffer
// ---------------------------------------------------------------------------

const MAX_BUFFER = 300;

interface BufferedEntry {
  ts: string;
  level: LogLevel;
  tag: string;
  msg: string;
  ms?: number;
}

const _buffer: BufferedEntry[] = [];

function write(level: LogLevel, tag: string, msg: string, extra?: unknown, ms?: number): void {
  const full = extra !== undefined ? `${msg} | ${JSON.stringify(extra)}` : msg;
  const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  consoleFn(`[${tag}] ${full}${ms !== undefined ? ` (${ms}ms)` : ''}`);

  _buffer.push({ ts: new Date().toISOString(), level, tag, msg: full, ms });
  if (_buffer.length > MAX_BUFFER) _buffer.shift();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const log = {
  info:  (tag: string, msg: string, extra?: unknown) => write('info',  tag, msg, extra),
  warn:  (tag: string, msg: string, extra?: unknown) => write('warn',  tag, msg, extra),
  error: (tag: string, msg: string, extra?: unknown) => write('error', tag, msg, extra),
};

export const perf = {
  start: (tag: string, label: string): (() => void) => {
    const t0 = Date.now();
    return () => {
      const ms = Date.now() - t0;
      write('perf', tag, label, undefined, ms);
    };
  },
};

/**
 * Flush buffered entries to SQLite and return them.
 * Call this only from the log viewer in Settings — never on the sale path.
 */
export async function flushAndGetLogs(): Promise<BufferedEntry[]> {
  if (_buffer.length === 0) return [];

  // Lazy import to avoid circular dep at module load time
  const { insertLog } = await import('./db');
  const snapshot = [..._buffer];
  for (const e of snapshot) {
    await insertLog(e.level, e.tag, e.msg, e.ms);
  }
  _buffer.length = 0;
  return snapshot;
}
