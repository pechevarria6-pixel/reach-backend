// ─── Reading travel essentials out of the database ───────────────────────
// lib/essentials.ts decides what is missing; this reads the rows. It is the
// only place that selects these columns for a group, so there is one place to
// check when asking "can anyone else see my date of birth" — and the answer
// it returns has none in it.
import type { SupabaseClient } from '@supabase/supabase-js';
import { readinessOf, blockingMessage, type Readiness } from '@/lib/essentials';
import { onTheTrip, type Person } from '@/lib/booking/approval';

export interface GroupReadiness {
  travelers: Readiness[];
  ready: boolean;
  blocking: string | null;
}

/** Supabase types a to-one join as an array; the row comes back as one. */
export function joined(row: Record<string, unknown>, key = 'users'): Record<string, unknown> {
  const raw = row[key] as Record<string, unknown> | Record<string, unknown>[] | null;
  return ((Array.isArray(raw) ? raw[0] : raw) ?? {}) as Record<string, unknown>;
}

export function displayName(u: Record<string, unknown>): string {
  return String(u.name || [u.first_name, u.last_name].filter(Boolean).join(' ') || 'A traveller');
}

/**
 * A booking request with the traveller details taken out, for storing.
 *
 * `bookings.request_payload` holds whatever was sent to the provider, and
 * GET /api/bookings returns every column to every member of the plan. A date
 * of birth written there would be readable by the whole group — so it is not
 * written there. Names and emails stay, because a group already sees those
 * on its own member list.
 *
 * Nothing is lost, because nothing here is needed later. A quote names
 * nobody. Approval builds the travellers itself, from every member on that
 * booking, out of the users table (bookingTravellers below) — so a booking
 * made tomorrow uses the passport somebody corrected today, and never a copy
 * of it from this column.
 */
export function withoutTravelerDetails<T extends { travelers?: unknown[] }>(item: T): T {
  if (!Array.isArray(item.travelers) || !item.travelers.length) return item;
  return {
    ...item,
    travelers: item.travelers.map(t => {
      const { dateOfBirth, gender, knownTravelerNumber, phone, ...rest } =
        (t ?? {}) as Record<string, unknown>;
      return rest;
    }),
  };
}

/**
 * Who in this group could be ticketed today. Throws nothing and hides
 * nothing: a database failure comes back as everyone unready with an
 * explanation, because the safe answer to "is everyone ready" when we cannot
 * tell is no.
 */
export async function groupReadiness(
  db: SupabaseClient, groupId: string,
  /** Only these people — a solo plan's traveller (see tripTravellerIds). */
  only?: string[] | null,
): Promise<GroupReadiness> {
  // A solo plan whose traveller is gone from the record: nobody can be put on
  // a flight, and an empty list is not "everyone is ready".
  if (only && only.length === 0) {
    return { travelers: [], ready: false, blocking: 'Nobody on this trip can be named on a booking.' };
  }
  const full = await db
    .from('group_members')
    .select('user_id, users(id, name, first_name, last_name, date_of_birth, gender, phone)')
    .eq('group_id', groupId);

  // gender arrives in sql/travel-essentials-2026-09-18.sql. Until it is run,
  // naming it fails the whole select — and a plan screen that cannot list its
  // own travellers is a worse answer than one saying the gender is missing,
  // which it is: the column does not exist, so nobody has filled it in.
  const fallback = full.error && /gender/.test(full.error.message || '')
    ? await db
      .from('group_members')
      .select('user_id, users(id, name, first_name, last_name, date_of_birth, phone)')
      .eq('group_id', groupId)
    : null;

  const data = (fallback ?? full).data as Record<string, unknown>[] | null;
  const error = (fallback ?? full).error;

  if (error) {
    // The code, not the object: this select reads dates of birth and a
    // PostgREST error can quote the row it failed on.
    console.error('[readiness] could not read the group', { groupId, code: error.code });
    return { travelers: [], ready: false, blocking: 'We could not check who is ready to fly just now.' };
  }

  const keep = only ? new Set(only) : null;
  const travelers = (data ?? [])
    .filter(m => !keep || keep.has(String((m as Record<string, unknown>).user_id)))
    .map(m => {
    const row = m as Record<string, unknown>;
    const u = joined(row);
    return readinessOf(String(row.user_id), displayName(u), {
      firstName: u.first_name as string | null,
      lastName: u.last_name as string | null,
      dateOfBirth: u.date_of_birth as string | null,
      gender: u.gender as string | null,
      phone: u.phone as string | null,
    });
  });

  return { travelers, ready: travelers.every(t => t.ready), blocking: blockingMessage(travelers) };
}

/**
 * Everybody on a booking, with what a provider needs to book them.
 *
 * Approval used to book under whoever pressed the button, because the quote
 * named nobody — one lead guest for a room of four, one passenger for a
 * flight of three. This reads every member of the group except the people
 * sitting this booking out, from the same columns groupReadiness reads, plus
 * the email a confirmation goes to.
 *
 * Server-only and never stored: the result goes to the provider and nowhere
 * else. A read that fails throws, because booking a smaller party than the
 * one going is not a safe fallback.
 */
export async function bookingTravellers(
  db: SupabaseClient, groupId: string, sittingOut: string[] = [],
): Promise<Person[]> {
  const cols = 'user_id, users(id, name, first_name, last_name, date_of_birth, gender, phone, email)';
  const full = await db.from('group_members').select(cols).eq('group_id', groupId);
  // As in groupReadiness: before sql/travel-essentials-2026-09-18.sql the
  // gender column does not exist, and nobody has one to send.
  const res = full.error && /gender/.test(full.error.message || '')
    ? await db.from('group_members').select(cols.replace(' gender,', '')).eq('group_id', groupId)
    : full;
  if (res.error) {
    console.error('[travellers] could not read the group', { groupId, code: res.error.code });
    throw new Error('Could not read who is travelling');
  }
  const out = new Set(sittingOut);
  return ((res.data ?? []) as unknown as Record<string, unknown>[])
    .filter(m => !out.has(String(m.user_id)))
    .map(m => {
      const u = joined(m);
      const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
      return {
        userId: String(m.user_id),
        name: displayName(u),
        firstName: s(u.first_name),
        lastName: s(u.last_name),
        dateOfBirth: s(u.date_of_birth),
        gender: s(u.gender),
        phone: s(u.phone),
        email: s(u.email),
      };
    });
}

type TripPlan = { group_id?: unknown; solo_mode?: unknown; created_by?: unknown };

/**
 * The people a plan's bookings are for, from their saved details: the group,
 * less anybody sitting this one out — or, on a solo plan, its creator alone
 * (onTheTrip in lib/booking/approval.ts says why). The one reader for quote,
 * stale check and approval, so they cannot disagree about who is going.
 */
export async function travellersFor(
  db: SupabaseClient, plan: TripPlan, sittingOut: string[] = [],
): Promise<Person[]> {
  return onTheTrip(plan, await bookingTravellers(db, String(plan.group_id), sittingOut));
}

/** For groupReadiness: only the solo traveller on a solo plan, else everyone. */
export function tripTravellerIds(plan: TripPlan): string[] | null {
  if (plan.solo_mode !== true) return null;
  return typeof plan.created_by === 'string' && plan.created_by ? [plan.created_by] : [];
}
