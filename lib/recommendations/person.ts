// ─── Who the recommendations are for ─────────────────────────────────────
// Everything pickTrips needs to know about one signed-in person, read from
// rows we hold: their quiz answers, the group they last planned with and
// its members' answers, the towns they already have plans for, what they
// said "not for me" to, and where they are starting from.
//
// Read-only. Nothing here writes. The taste profile it reads stays inside
// the ranking (see Person.profile).
import type { SupabaseClient } from '@supabase/supabase-js';
import { latestPerItem, type Feedback, type Verdict } from '../recommendation-memory.ts';
import { locate } from '../discovery/geocode.ts';
import { today } from '../calendar.ts';
import { readProfile } from '../taste-profile.ts';
import { homeTownOf, milesBetween, plannedKeys, startingAirport, type Candidate, type Person, type Taste } from './trip-picks.ts';

/** The quiz columns a member's answers are read from. Never returned to anybody. */
const TASTE = 'id, favorite_activities, cuisines, music_genres, nightlife_style, drink_style, no_way_jose, budget_range';

export const TRIP_REF = 'trip:';

/** The most a home-city lookup may take before Home goes without it. */
const LOCATE_MS = 1500;

export interface PersonRead {
  person: Person;
  /** How the card names where distances were measured from. */
  from: string | null;
}

export async function personFor(
  db: SupabaseClient,
  userId: string,
  opts: { at?: { lat: number; lng: number } | null; city?: string | null; airport?: string | null; candidates: Candidate[] | Promise<Candidate[]> },
): Promise<PersonRead> {
  // select('*') so quiz v3's traveler_profile is read when its migration has
  // run and simply absent when it has not — naming the column would fail the
  // whole read until then (42703), and the v2 answers are the fallback.
  // The three reads that need nothing from each other go together: one
  // round trip, not three, on every Home load.
  // The profile is read alongside and dropped below if they turned
  // personalised recommendations off: a read thrown away is cheaper than a
  // round trip waited for. The candidates may still be loading (the route
  // starts both at once); they are awaited only where they are needed.
  const profileRead = readProfile(db, userId);
  const [meRes, mineRes, fbRes] = await Promise.all([
    db.from('users').select('*').eq('id', userId).maybeSingle(),
    db.from('group_members').select('group_id').eq('user_id', userId),
    db.from('recommendation_feedback')
      .select('item_ref, verdict, created_at')
      .eq('user_id', userId)
      .like('item_ref', `${TRIP_REF}%`),
  ]);
  const { data: me, error: meErr } = meRes;
  if (meErr) console.error('[trip-picks] could not read the person', { code: meErr.code });
  const row = (me ?? {}) as Record<string, unknown> & Taste;

  // Groups they are in, and everybody in them.
  const { data: mine } = mineRes;
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
    // Their names too, for "For you and Ali" — never the group's own name,
    // which is usually an occasion (see whoFor). Split off at once so a
    // name never rides along inside somebody's answers.
    const { data: rows, error } = await db.from('users').select(`${TASTE}, name`).in('id', ids);
    if (error) console.error('[trip-picks] could not read the group', { code: error.code });
    const read = (rows ?? []) as Array<Taste & { name?: string | null }>;
    group = {
      id: g.id, name: String(g.name || 'your group'),
      members: read.map(({ name: _n, ...taste }) => taste as Taste),
      names: read.map(r => (typeof r.name === 'string' ? r.name : null)),
    };
    // Somebody whose row could not be read still counts as going.
    while (group.members.length < ids.length) group.members.push({});
  }

  // What they said "not for me" to. The latest verdict per card wins.
  const { data: fb, error: fbErr } = fbRes;
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
    // The whole string decides, state or country included: "Athens,
    // Georgia" is not the Athens on the world list (homeTownOf).
    const known = homeTownOf(homeCity, await opts.candidates);
    if (known) home = { lat: known.lat, lng: known.lng };
    else {
      // Home's cards answer in a few seconds; a geocoder allowed eight
      // would spend them all. Past the limit they get no cards measured
      // from home this time, which pickTrips says as no_location.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const placed = await Promise.race([
        locate(homeCity).catch(() => null),
        new Promise<null>(r => { timer = setTimeout(() => r(null), LOCATE_MS); }),
      ]).finally(() => clearTimeout(timer));
      if (placed) home = { lat: placed.lat, lng: placed.lng };
    }
    if (home) from = homeCity;
  }

  // What the daily distill learned about them (lib/taste-profile.ts). Only
  // when they have not turned personalised recommendations off — an absent
  // answer is on, as Profile shows it — and null on any failure, which is
  // the ranking Home had before the profile existed. Never returned to
  // anybody: pickTrips reads it to order towns and puts none of it on a card.
  const read = await profileRead;
  const profile = row.consent_personalized === false ? null : read;
  const list = await opts.candidates;

  // Their country is the nearest town we know's, which is enough to tell a
  // flight abroad from one at home.
  const nearest = home
    ? list.filter(c => c.country).map(c => ({ c, d: milesBetween(home!, c) })).sort((a, b) => a.d - b.d)[0]
    : null;
  const homeCountry = nearest && nearest.d <= 150 ? nearest.c.country : null;

  return {
    person: {
      home,
      homeCountry,
      // The airport of wherever the miles are measured from (startingAirport).
      homeAirport: startingAirport({ at: opts.at ?? null, sent: opts.airport, homeAirport: row.home_airport }),
      me: row,
      group,
      planned: plannedKeys(plans, today()),
      dismissed,
      profile,
    },
    from,
  };
}
