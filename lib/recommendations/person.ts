// ─── Who the recommendations are for ─────────────────────────────────────
// Everything pickTrips needs to know about one signed-in person, read from
// rows we hold: their quiz answers, the group they last planned with and
// its members' answers, the towns they already have plans for, what they
// said "not for me" to, and where they are starting from.
//
// Read-only. Nothing here writes.
import type { SupabaseClient } from '@supabase/supabase-js';
import { latestPerItem, type Feedback, type Verdict } from '../recommendation-memory.ts';
import { nameKey } from '../discovery/regions.ts';
import { locate } from '../discovery/geocode.ts';
import { today } from '../calendar.ts';
import { milesBetween, plannedKeys, type Candidate, type Person, type Taste } from './trip-picks.ts';

/** The quiz columns a member's answers are read from. Never returned to anybody. */
const TASTE = 'id, favorite_activities, cuisines, music_genres, nightlife_style, drink_style, no_way_jose, budget_range';

export const TRIP_REF = 'trip:';

export interface PersonRead {
  person: Person;
  /** How the card names where distances were measured from. */
  from: string | null;
}

export async function personFor(
  db: SupabaseClient,
  userId: string,
  opts: { at?: { lat: number; lng: number } | null; city?: string | null; candidates: Candidate[] },
): Promise<PersonRead> {
  // select('*') so quiz v3's traveler_profile is read when its migration has
  // run and simply absent when it has not — naming the column would fail the
  // whole read until then (42703), and the v2 answers are the fallback.
  const { data: me, error: meErr } = await db.from('users').select('*').eq('id', userId).maybeSingle();
  if (meErr) console.error('[trip-picks] could not read the person', { code: meErr.code });
  const row = (me ?? {}) as Record<string, unknown> & Taste;

  // Groups they are in, and everybody in them.
  const { data: mine } = await db.from('group_members').select('group_id').eq('user_id', userId);
  const groupIds = [...new Set((mine ?? []).map(r => String(r.group_id)))];
  const [membersRes, groupsRes, plansRes] = groupIds.length
    ? await Promise.all([
      db.from('group_members').select('group_id, user_id').in('group_id', groupIds),
      db.from('groups').select('id, name').in('id', groupIds),
      db.from('plans').select('id, group_id, destination_city, destination_country, status, type, start_date, created_at').in('group_id', groupIds),
    ])
    : [{ data: [] }, { data: [] }, { data: [] }] as const;
  const members = (membersRes.data ?? []) as Array<{ group_id: string; user_id: string }>;
  const groups = (groupsRes.data ?? []) as Array<{ id: string; name: string | null }>;
  const plans = (plansRes.data ?? []) as Array<{ group_id: string; destination_city: string | null; destination_country: string | null; status: string | null; type: string | null; start_date: string | null; created_at: string | null }>;

  // Who they have planned with: the group with other people in it whose
  // newest plan is the newest. A group nobody has planned anything in is
  // not yet somebody they go places with.
  const others = (gid: string) => members.filter(m => m.group_id === gid && m.user_id !== userId).map(m => m.user_id);
  const latest = (gid: string) => plans
    .filter(p => p.group_id === gid && p.status !== 'cancelled')
    .map(p => String(p.created_at ?? ''))
    .sort().pop() ?? '';
  const withPeople = groups
    .filter(g => others(g.id).length > 0 && latest(g.id))
    .sort((a, b) => latest(b.id).localeCompare(latest(a.id)) || a.id.localeCompare(b.id));
  let group: Person['group'] = null;
  if (withPeople[0]) {
    const g = withPeople[0];
    const ids = others(g.id);
    const { data: rows, error } = await db.from('users').select(TASTE).in('id', ids);
    if (error) console.error('[trip-picks] could not read the group', { code: error.code });
    group = { id: g.id, name: String(g.name || 'your group'), members: (rows ?? []) as Taste[] };
    // Somebody whose row could not be read still counts as going.
    while (group.members.length < ids.length) group.members.push({});
  }

  // What they said "not for me" to. The latest verdict per card wins.
  const { data: fb, error: fbErr } = await db
    .from('recommendation_feedback')
    .select('item_ref, verdict, created_at')
    .eq('user_id', userId)
    .like('item_ref', `${TRIP_REF}%`);
  if (fbErr && !/recommendation_feedback|PGRST205/i.test(`${fbErr.code} ${fbErr.message}`)) {
    console.error('[trip-picks] could not read what was dismissed', { code: fbErr.code });
  }
  const feedback: Feedback[] = (fb ?? []).map(r => ({
    itemRef: String(r.item_ref), vertical: 'trip', verdict: r.verdict as Verdict, at: String(r.created_at),
  }));
  const dismissed = new Set<string>();
  for (const f of latestPerItem(feedback).values()) {
    if (f.verdict === 'not_interested') dismissed.add(f.itemRef.slice(TRIP_REF.length));
  }

  // Where from: this device, when it said; otherwise the home city.
  const homeCity = typeof row.home_city === 'string' ? row.home_city.trim() : '';
  let home = opts.at ?? null;
  let from: string | null = home ? ((opts.city || '').trim() || homeCity || null) : null;
  if (!home && homeCity) {
    const town = nameKey(homeCity.split(',')[0]);
    const known = opts.candidates.find(c => nameKey(c.name) === town);
    if (known) home = { lat: known.lat, lng: known.lng };
    else {
      const placed = await locate(homeCity).catch(() => null);
      if (placed) home = { lat: placed.lat, lng: placed.lng };
    }
    if (home) from = homeCity;
  }

  // Their country is the nearest town we know's, which is enough to tell a
  // flight abroad from one at home.
  const nearest = home
    ? opts.candidates.filter(c => c.country).map(c => ({ c, d: milesBetween(home!, c) })).sort((a, b) => a.d - b.d)[0]
    : null;
  const homeCountry = nearest && nearest.d <= 150 ? nearest.c.country : null;

  return {
    person: {
      home,
      homeCountry,
      homeAirport: typeof row.home_airport === 'string' && /^[A-Z]{3}$/i.test(row.home_airport) ? row.home_airport.toUpperCase() : null,
      me: row,
      group,
      planned: plannedKeys(plans, today()),
      dismissed,
    },
    from,
  };
}
