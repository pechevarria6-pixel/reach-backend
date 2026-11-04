// ─── reserve.ts's writes, in Supabase ───────────────────────────────────
// Every write is conditional on the row as it was read — its status and its
// updated_at — so two requests that both read "open" cannot both act: the
// second matches nothing and is told the row changed. The platform steps'
// own writes (lib/booking/tables/flow.ts: the hold, the claim, the booking)
// are conditional on updated_at alone, through `flow`.
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyUsers, type Sender } from '../notify-user.ts';
import { atVersion } from '../booking/claim.ts';
import type { TableStore } from './reserve.ts';

/** The one-live-booking-per-thing index refusing a second live row for the same line. */
const duplicate = (e: { code?: string } | null) => !!e && e.code === '23505';

export function supabaseTableStore(db: SupabaseClient, send: Sender | null): TableStore {
  return {
    async reopen(id, from, version, patch) {
      const { data, error } = await atVersion(db.from('bookings')
        .update({ ...patch, status: 'awaiting_approval' })
        .eq('id', id).eq('status', from), version)
        .select('id, updated_at');
      if (error) {
        if (!duplicate(error)) console.error('[reserve] could not reopen a booking', { id, code: error.code });
        return { ok: false, taken: true };
      }
      const row = (data ?? [])[0] as { updated_at?: string | null } | undefined;
      return row ? { ok: true, version: row.updated_at ?? null } : { ok: false, taken: true };
    },

    flow: {
      async write(id, version, patch) {
        const at = typeof patch.updated_at === 'string' ? patch.updated_at : new Date().toISOString();
        const { data, error } = await atVersion(db.from('bookings').update({ ...patch, updated_at: at }).eq('id', id), version).select('id');
        if (error) {
          console.error('[reserve] a platform step could not write the booking', { id, code: error.code });
          return { ok: false, taken: false, error: error.message };
        }
        return data?.length ? { ok: true, version: at } : { ok: false, taken: true };
      },
    },

    async write(id, from, version, patch) {
      const { data, error } = await atVersion(db.from('bookings')
        .update(patch)
        .eq('id', id).eq('status', from), version)
        .select()
        .maybeSingle();
      if (error) {
        console.error('[reserve] could not write a booking', { id, code: error.code });
        return null;
      }
      return (data as Record<string, unknown> | null) ?? null;
    },

    async callOpen(bookingId) {
      const { data, error } = await db.from('reservation_calls')
        .select('id').eq('booking_id', bookingId).eq('mode', 'live').neq('status', 'settled').limit(1);
      if (error) {
        // Before the calls migration there is no table and no call. Any other
        // failure is read as a call ringing: refusing to book is the safe side.
        const missing = error.code === '42P01' || error.code === 'PGRST205';
        if (!missing) console.error('[reserve] could not check for a call in progress', { bookingId, code: error.code });
        return !missing;
      }
      return (data ?? []).length > 0;
    },

    async retime(itemId, from, to) {
      const q = db.from('itinerary_items').update({ scheduled_time: to }).eq('id', itemId);
      const { data, error } = await (from === null ? q.is('scheduled_time', null) : q.eq('scheduled_time', from)).select('id');
      if (error) { console.error('[reserve] could not move the line', { itemId, code: error.code }); return false; }
      return (data ?? []).length > 0;
    },

    async members(groupId) {
      if (!groupId) return [];
      const { data, error } = await db.from('group_members').select('user_id').eq('group_id', groupId);
      if (error) { console.error('[reserve] could not read the group', { groupId, code: error.code }); return []; }
      return (data ?? []).map(r => String((r as { user_id: unknown }).user_id));
    },

    async notify(userIds, note) {
      const delivery = await notifyUsers(db, userIds, note, send);
      if (!delivery.stored) console.error('[reserve] the bell was not written', { kind: note.kind, planId: note.planId });
    },
  };
}
