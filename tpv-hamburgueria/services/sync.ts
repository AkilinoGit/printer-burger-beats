// Sync logic — SQLite-first, fire-and-forget network sync
// No API configured → everything stays 'pending' in queue, no errors shown to user.

import {
  getPendingSyncEntries,
  updateSyncEntryStatus,
  clearSyncedEntries,
  updateTicketSyncStatus,
  getTicketById,
} from './db';
import type { SyncQueueEntry, Ticket } from '../lib/types';

// ---------------------------------------------------------------------------
// Config — set API_BASE_URL when backend is ready
// ---------------------------------------------------------------------------

const API_BASE_URL: string | null = null; // e.g. 'https://api.example.com'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function syncEntry(entry: SyncQueueEntry): Promise<void> {
  if (!API_BASE_URL) return; // No backend configured — leave in queue silently

  if (entry.entity_type === 'ticket') {
    const ticket = await getTicketById(entry.entity_id);
    if (!ticket) return;

    if (entry.action === 'update') {
      await syncTicketUpdate(entry, ticket);
    } else {
      await syncTicketCreate(entry, ticket);
    }
  } else if (entry.entity_type === 'order') {
    // order sync: always POST (orders are never updated individually)
    await syncOrderCreate(entry);
  }
}

async function syncTicketCreate(entry: SyncQueueEntry, ticket: Ticket): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ticket),
  });
  if (!res.ok) throw new Error(`POST /api/tickets failed: ${res.status}`);
  await updateSyncEntryStatus(entry.id, 'synced');
  await updateTicketSyncStatus(entry.entity_id, 'synced');
}

async function syncTicketUpdate(entry: SyncQueueEntry, ticket: Ticket): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/tickets/${entry.entity_id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ticket),
  });
  if (!res.ok) throw new Error(`PUT /api/tickets/${entry.entity_id} failed: ${res.status}`);
  await updateSyncEntryStatus(entry.id, 'synced');
  await updateTicketSyncStatus(entry.entity_id, 'synced');
}

async function syncOrderCreate(entry: SyncQueueEntry): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId: entry.entity_id }),
  });
  if (!res.ok) throw new Error(`POST /api/orders failed: ${res.status}`);
  await updateSyncEntryStatus(entry.id, 'synced');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attempts to sync all pending/error entries in the queue.
 * Fire-and-forget: never throws, never blocks UI.
 * If no API is configured, returns immediately without side effects.
 */
export async function syncPendingEntries(): Promise<void> {
  if (!API_BASE_URL) return;

  let entries: SyncQueueEntry[];
  try {
    entries = await getPendingSyncEntries();
  } catch {
    return; // DB read failed — safe to ignore
  }

  for (const entry of entries) {
    try {
      await syncEntry(entry);
    } catch {
      // Mark as error but keep in queue for retry
      try {
        await updateSyncEntryStatus(entry.id, 'error');
      } catch {
        // ignore — will retry on next sync cycle
      }
    }
  }

  // Housekeeping: remove synced entries
  try {
    await clearSyncedEntries();
  } catch {
    // non-critical
  }
}
