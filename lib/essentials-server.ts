// ─── Reading travel essentials out of the database ───────────────────────
// lib/essentials.ts decides what is missing; this reads the rows. It is the
// only place that selects these columns for a group, so there is one place to
// check when asking "can anyone else see my date of birth" — and the answer
// it returns has none in it.
import type { SupabaseClient } from '@supabase/supabase-js';
import { readinessOf, blockingMessage, type Readiness } from '@/lib/essentials';

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
 * Nothing is lost: the details go to the provider from this request in the
 * same breath, and approval reads them fresh from the users table, which is
 * also the only way a booking made tomorrow uses the passport somebody
 * corrected today.
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
export async function groupReadiness(db: SupabaseClient, groupId: string): Promise<GroupReadiness> {
  const full = await db
    .from('group_members')
    .select('user_id, users(id, name, first_name, last_name, date_of_birth, gender)')
    .eq('group_id', groupId);

  // gender arrives in sql/travel-essentials-2026-09-18.sql. Until it is run,
  // naming it fails the whole select — and a plan screen that cannot list its
  // own travellers is a worse answer than one saying the gender is missing,
  // which it is: the column does not exist, so nobody has filled it in.
  const fallback = full.error && /gender/.test(full.error.message || '')
    ? await db
      .from('group_members')
      .select('user_id, users(id, name, first_name, last_name, date_of_birth)')
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

  const travelers = (data ?? []).map(m => {
    const row = m as Record<string, unknown>;
    const u = joined(row);
    return readinessOf(String(row.user_id), displayName(u), {
      firstName: u.first_name as string | null,
      lastName: u.last_name as string | null,
      dateOfBirth: u.date_of_birth as string | null,
      gender: u.gender as string | null,
    });
  });

  return { travelers, ready: travelers.every(t => t.ready), blocking: blockingMessage(travelers) };
}
