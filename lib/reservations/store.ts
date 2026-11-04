// ─── The reservation assistant's rows, in Supabase ──────────────────────
// Every limit the assistant keeps is held by the database, not by a read
// before a write (CLAUDE.md: a double-tap is two concurrent requests):
//
//   one call per reservation  — unique (booking_id, mode)
//   fifty a day               — unique (call_day, day_slot), slot 1..50;
//                               a released claim's slot is taken again
//   one settle per call       — update … where settled_at is null
//
// Before sql/reservation-calls-2026-11-04.sql runs, every read says
// 'not_migrated' and the route refuses to call, naming the file.
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyUsers, type Sender } from '../notify-user.ts';
import type { CallRow, Claim, Store } from './call.ts';
import { DAILY_CAP } from './call.ts';
import { withMark } from './reserve-state.ts';

export const MIGRATION = 'sql/reservation-calls-2026-11-04.sql';

type PgError = { code?: string; message?: string; details?: string } | null;
const missing = (e: PgError) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table/i.test(e.message || ''));
const fail = (e: PgError, what: string) => {
  if (missing(e)) return { ok: false as const, why: 'not_migrated' as const };
  console.error(`[reservation calls] ${what}`, { code: e?.code, message: e?.message });
  return { ok: false as const, why: 'error' as const };
};

const COLUMNS = 'id, booking_id, plan_id, requested_by, mode, provider, provider_call_id, dialed_number, venue_phone, call_day, day_slot, status, request, opening, outcome, staff_quote, outcome_detail, disclosed, created_at';

export function supabaseStore(db: SupabaseClient, send: Sender | null): Store {
  return {
    async anyUndisclosed(sinceISO) {
      const { data, error } = await db.from('reservation_calls').select('id').eq('disclosed', false).gte('created_at', sinceISO).limit(1);
      if (error) return fail(error, 'could not read past calls');
      return { ok: true, value: (data ?? []).length > 0 };
    },

    async onDoNotCall(phone) {
      const { data, error } = await db.from('reservation_do_not_call').select('phone').eq('phone', phone).maybeSingle();
      if (error) return fail(error, 'could not read the do-not-call list');
      return { ok: true, value: !!data };
    },

    async callFor(bookingId, mode) {
      const { data, error } = await db.from('reservation_calls').select(COLUMNS).eq('booking_id', bookingId).eq('mode', mode).maybeSingle();
      if (error) return fail(error, 'could not read the call for a booking');
      return { ok: true, value: (data as CallRow | null) ?? null };
    },

    async claim(row): Promise<Claim> {
      // The lowest free slot of the day. Not count + 1: a claim the provider
      // refused is deleted (release), and the hole it leaves must be reused,
      // or five holes below the top would fail every later call that day.
      // Two requests may read the same free slot; the unique index lets one
      // have it, and the other remembers it as taken and reads again.
      const lost = new Set<number>();
      for (let attempt = 0; attempt < 8; attempt++) {
        const { data: taken, error: readErr } = await db.from('reservation_calls')
          .select('day_slot').eq('call_day', row.call_day);
        if (readErr) { const f = fail(readErr, 'could not read today\'s calls'); return { ok: false, why: f.why }; }
        const used = new Set<number>([...lost, ...(taken ?? []).map(r => Number((r as { day_slot: unknown }).day_slot))]);
        let slot = 1;
        while (used.has(slot)) slot++;
        if (slot > DAILY_CAP) return { ok: false, why: 'cap' };
        const { data, error } = await db.from('reservation_calls')
          .insert({ ...row, day_slot: slot, status: 'placing' }).select(COLUMNS).single();
        if (!error && data) return { ok: true, row: data as CallRow };
        const text = `${error?.message ?? ''} ${error?.details ?? ''}`;
        if (error?.code === '23505' && /one_per_booking/.test(text)) return { ok: false, why: 'already' };
        if (error?.code === '23505' && /day_slot/.test(text)) { lost.add(slot); continue; }
        const f = fail(error, 'could not claim a call');
        return { ok: false, why: f.why };
      }
      return { ok: false, why: 'error' };
    },

    async markPlaced(id, providerCallId) {
      const { error } = await db.from('reservation_calls')
        .update({ status: 'calling', provider_call_id: providerCallId, placed_at: new Date().toISOString() })
        .eq('id', id).eq('status', 'placing');
      return !error;
    },

    async markUnknown(id, detail) {
      const { error } = await db.from('reservation_calls')
        .update({ status: 'unknown', outcome_detail: { placing: detail }, placed_at: new Date().toISOString() })
        .eq('id', id).eq('status', 'placing');
      return !error;
    },

    async release(id) {
      const { error } = await db.from('reservation_calls').delete().eq('id', id).eq('status', 'placing');
      return !error;
    },

    async find(provider, providerCallId, callId) {
      if (providerCallId) {
        const { data, error } = await db.from('reservation_calls').select(COLUMNS)
          .eq('provider', provider).eq('provider_call_id', providerCallId).maybeSingle();
        if (error) return fail(error, 'could not find a call by the provider id');
        if (data) return { ok: true, value: data as CallRow };
      }
      if (callId && /^[0-9a-f-]{36}$/i.test(callId)) {
        const { data, error } = await db.from('reservation_calls').select(COLUMNS)
          .eq('id', callId).eq('provider', provider).maybeSingle();
        if (error) return fail(error, 'could not find a call by our id');
        return { ok: true, value: (data as CallRow | null) ?? null };
      }
      return { ok: true, value: null };
    },

    async settleOnce(id, fields) {
      const { data, error } = await db.from('reservation_calls')
        .update(fields).eq('id', id).is('settled_at', null).select(COLUMNS).maybeSingle();
      if (error) return fail(error, 'could not settle a call');
      return { ok: true, value: (data as CallRow | null) ?? null };
    },

    async addDoNotCall(phone, reason, callId) {
      // Already listed is listed: the first reason stands.
      const { error } = await db.from('reservation_do_not_call')
        .upsert({ phone, reason, call_id: callId }, { onConflict: 'phone', ignoreDuplicates: true });
      return !error;
    },

    async moveBooking(bookingId, from, to) {
      const { mark, ...cols } = to;
      const patch: Record<string, unknown> = { ...cols, updated_at: new Date().toISOString() };
      if (mark) {
        // The rest of the payload is kept: only the reservation's mark changes.
        // The write below is still conditional on the status, so a row somebody
        // moved meanwhile is left as they left it.
        const { data: now, error: readErr } = await db.from('bookings').select('response_payload').eq('id', bookingId).maybeSingle();
        if (readErr) console.error('[reservation calls] could not read a booking to mark it', { bookingId, code: readErr.code });
        patch.response_payload = withMark((now as { response_payload?: unknown } | null)?.response_payload, mark);
      }
      const { data, error } = await db.from('bookings')
        .update(patch)
        .eq('id', bookingId).in('status', from).select('id');
      if (error) { console.error('[reservation calls] could not move a booking', { bookingId, code: error.code }); return false; }
      return (data ?? []).length > 0;
    },

    async planMembers(_planId, groupId) {
      if (!groupId) return [];
      const { data, error } = await db.from('group_members').select('user_id').eq('group_id', groupId);
      if (error) { console.error('[reservation calls] could not read the group', { groupId, code: error.code }); return []; }
      return (data ?? []).map(r => String((r as { user_id: unknown }).user_id));
    },

    async notify(userIds, note) {
      const delivery = await notifyUsers(db, userIds, note, send);
      if (!delivery.stored) console.error('[reservation calls] the bell was not written', { kind: note.kind, planId: note.planId });
    },
  };
}
