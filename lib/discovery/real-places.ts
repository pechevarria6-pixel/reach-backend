// ─── The places that actually exist, handed over before anybody writes ───
// Until now the generator was asked to plan three days in a town and then,
// separately and afterwards, a verifier went and checked whether the places
// it had named were real. That order is backwards, and it is why "Cash only
// at Milt's" and a Milk Carton Kids gig at the wrong venue both shipped: by
// the time anything was checked, the sentence had already been written in
// Reach's voice, and the best a checker can do with an invented restaurant
// is take it away again.
//
// So the places come first. This reads the map and our own cache for the
// town somebody is going to, and hands the model a numbered list of real
// venues with their real names. The model arranges a day out of that list.
// It does not get to add to it.
//
// The important case is the empty one. A thin list is not a licence to fall
// back on invention — it is the honest shape of what we know about a small
// town, and the prompt says so plainly: name nothing you were not given.
// "Dinner somewhere near the venue" is a true sentence. "Dinner at El Charro
// Loco" is not, and we know it is not, because we looked.
import { today } from '../calendar.ts';
import { stillToCome, onTheDays } from './when.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Seeker } from './types.ts';
import { locate } from './geocode.ts';
import { noteArea, milesBetween } from './cache.ts';
import { canTurnUp } from './rules.ts';
import { normalise } from './verify.ts';
import { dialable } from './phone.ts';
import { closedThroughout, neverOpen, windowFor } from './hours.ts';
import { regionCountries } from './regions.ts';
import { siteTown } from './world-destinations.ts';

/** What the map calls somewhere to sleep, once underscores are spaces. */
const LODGING_KIND = /\b(hotel|guest ?house|hostel|motel|apartment)s?\b/i;

export interface RealPlace {
  /** What the model cites. Short on purpose — it is typed back to us. */
  ref: string;
  name: string;
  /** The food somebody asked for that this place serves, when it was pinned for that. */
  forFood?: string;
  /**
   * What is actually on here, in the venue's own words.
   *
   * "Pub Trivia Night, every Wednesday Night at 7 PM". Read off the venue's
   * own page by the harvest job and stored against it — so it is a fact
   * with a source, not a guess about what a pub is probably like.
   *
   * This existed and never reached a trip: the harvester wrote it, Discover
   * read it, and the itinerary menu only ever looked at the venue table. So
   * a plan could name a brewery and had no idea there was a quiz on.
   */
  whatsOn?: string[];
  /** "restaurant", "museum", "bar" — from the map's own tag, not guessed. */
  kind: string;
  /** The quiz's word for it — "mexican restaurants" — which is what the
   *  venue table stores and what says something about a town's food. */
  interest: string | null;
  /** Its own site, when the map records one. Null is common and fine. */
  url: string | null;
  city: string | null;
  /** Which source vouches for it, so a card can say where this came from. */
  source: string;
  /** "118 S Main St", as the map records it, when it does. */
  street?: string | null;
  /**
   * OpenStreetMap's opening_hours, exactly as mapped, when it has them.
   * Quoted to the model as the map's and never restated as our own: a
   * volunteer's note from last spring is not a promise about Friday.
   */
  hours?: string | null;
  /**
   * Whether it takes reservations, as mapped: OpenStreetMap's own
   * `reservation` tag. The model guessed this per line; a restaurant whose
   * map entry says "required" was sent as a walk-in. See takesBookings().
   */
  reservation?: Reservation;
  /** A number to ring, dialable, from the venue's row or its map entry. */
  phone?: string | null;
  /** Where to reserve, when the venue's own page names a booking page. */
  reserveUrl?: string | null;
}

export type Reservation = 'required' | 'recommended' | 'yes' | 'no' | null;

/** OpenStreetMap's reservation tag, as one of the values it documents, else null. */
export function takesBookings(tag: unknown): Reservation {
  const v = String(tag ?? '').trim().toLowerCase();
  return v === 'required' || v === 'recommended' || v === 'yes' || v === 'no' ? v : null;
}

/**
 * How far out to look, in miles, nearest first.
 *
 * A trip is not a Friday night: somebody in Moab will drive forty minutes to
 * a trailhead and think nothing of it, where Discover's tighter box is right
 * for "what is on near me tonight". So the menu reaches twenty-five miles —
 * but it gets there in steps.
 *
 * One twenty-five mile box capped at a few hundred rows was fine while the
 * table held a few dozen places a town. The weekly map load puts thousands
 * around a city, and a capped read of a box that size is an arbitrary few
 * hundred of them: Durham's breweries offered for dinner in downtown
 * Raleigh while the restaurant across the street was never read. There is
 * no PostGIS here to sort by distance in the database, so the boxes grow
 * instead, and each smaller box's rows are kept whole as the next is read.
 */
const RINGS_MILES = [2, 5, 12, 25];

/** Rows asked for per box when building a menu. */
const PER_BOX = 500;

/** Rows per page, and the most pages, when counting a whole radius. */
const PAGE = 1000;
const MAX_PAGES = 20;

/**
 * The kinds worth holding for any destination, in the vocabulary the venue
 * table actually stores — which is the quiz's, not a category system of my
 * own. Checked against the live table before it was written here.
 */
const ALWAYS_SWEPT = [
  // Dinner first, and without a cuisine attached: the cuisine lookups only
  // find restaurants tagged with one, which left Washington holding no
  // places to eat at all.
  'places to eat',
  'mexican restaurants', 'italian restaurants', 'japanese restaurants',
  'breweries', 'wine tasting', 'live music', 'museums & history',
  'art & galleries', 'outdoors', 'markets & food halls',
];

/**
 * Somewhere to sleep, as the venue table files it.
 *
 * The weekly load holds hotels so a stay can be checked against the map one
 * day. They are never on the menu: a hotel that also has a restaurant on
 * the same map point is still a hotel, nobody is sent to one for dinner,
 * and `bookingFor` below would have called a hotel off the map "Reach will
 * book this" when Reach books rooms through its own providers, not these.
 */
const STAY_INTEREST = 'places to stay';

/** At most this many of any one kind, so a city's restaurants cannot bury
 *  its one museum. The menu has to be able to furnish a whole day. */
const PER_KIND = 8;

/** One entry per real place, however the table spells it. */
function dedupe<T extends { name: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const r of rows) {
    const key = normalise(r.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(r);
  }
  return kept;
}

type VenueRow = {
  id: string; name: string; kind: string | null; interest: string | null; website: string | null;
  city: string | null; street: string | null; lat: number; lng: number;
  osm_tags?: Record<string, string> | null; opening_hours?: string | null;
  phone?: string | null; reservation_url?: string | null;
  /** The Geofabrik file the map load read it from; null for the sweep's rows. */
  region?: string | null;
};
type ReadError = { code?: string; message?: string } | null;
/** A held row as the menu uses it. */
type Shaped = {
  id: string; rawKind: string | null; name: string; kind: string; interest: string | null;
  url: string | null; city: string | null; street: string | null; hours: string | null;
  miles: number; cuisine: string;
  reservation: Reservation; phone: string | null; reserveUrl: string | null;
};

/**
 * Whether a held row is in another country from the trip, going by the
 * Geofabrik file the map load read it from.
 *
 * The load reads whole regions now, so Mexico's file puts Tijuana's
 * restaurants in the table beside San Diego's, and Ciudad Juárez's a mile
 * from downtown El Paso. The menu reads by distance, and a place across a
 * border is not "nearby" to somebody without a passport in their pocket.
 *
 * Only a certain answer drops a row: the trip's country known, the row's
 * region known, and none of the region's countries (as the geocoder names
 * them — Hong Kong is "cn" to Nominatim) the trip's. A sweep row (no
 * region) or a region nothing knows is kept, which is how the menu read
 * before any of this.
 */
export function acrossTheBorder(region: string | null | undefined, tripCountry: string | null | undefined): boolean {
  const cc = String(tripCountry || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc) || !region) return false;
  const countries = regionCountries(region);
  return countries.length > 0 && !countries.includes(cc);
}

/** The half-width of a box `miles` across, in degrees, at this latitude. */
function boxAround(lat: number, miles: number): { dLat: number; dLng: number } {
  return { dLat: miles / 69, dLng: miles / Math.max(1, 69 * Math.cos((lat * Math.PI) / 180)) };
}

/** A value PostgREST can take inside `in.(...)` without escaping. */
const listable = (v: string) => !/[",()\\]/.test(v);

/**
 * The live venues in a box, or the error that stopped the read.
 *
 * `except` leaves out kinds the menu already has enough of, so a wider box
 * spends its rows on what is still missing — the museum twelve miles out —
 * rather than on five hundred more restaurants. `all` pages through the
 * whole box, for a count.
 *
 * `gone_at` and the newer columns arrive in migrations. A missing column is
 * a pending migration, not an empty town, so the read is retried with the
 * columns every version of the table has, and without the gone filter —
 * which is exactly what the reader did before the column existed.
 */
async function venuesInBox(
  db: SupabaseClient,
  at: { lat: number; lng: number },
  miles: number,
  // `also` is told whether this attempt can see osm_tags, so a filter that
  // names the column can leave it out on the pending-migration retry rather
  // than failing all three attempts on the same missing column.
  opts: { except?: string[]; all?: boolean; also?: (q: any, tags: boolean) => any } = {},
): Promise<{ data: VenueRow[]; error: ReadError; floor?: boolean }> {
  const { dLat, dLng } = boxAround(at.lat, miles);
  const except = (opts.except ?? []).filter(listable);
  const also = opts.also ?? ((q: any) => q);
  const FULL = 'id, name, kind, interest, website, city, street, lat, lng, osm_tags, opening_hours, phone, reservation_url, region';
  const BASIC = 'id, name, kind, interest, website, city, street, lat, lng';
  const read = async (columns: string, live: boolean): Promise<{ data: VenueRow[]; error: ReadError; floor?: boolean }> => {
    const out: VenueRow[] = [];
    for (let page = 0; page < (opts.all ? MAX_PAGES : 1); page++) {
      let q = db.from('discovery_venues')
        .select(columns)
        .gte('lat', at.lat - dLat).lte('lat', at.lat + dLat)
        .gte('lng', at.lng - dLng).lte('lng', at.lng + dLng)
        .neq('interest', STAY_INTEREST);
      if (live) q = q.is('gone_at', null);
      // A null kind is filed by its interest and cannot be named here, so
      // it is always let through.
      if (except.length) q = q.or(`kind.is.null,kind.not.in.(${except.map(k => `"${k}"`).join(',')})`);
      q = also(q, columns === FULL);
      const { data, error } = await (opts.all
        ? q.order('id').range(page * PAGE, page * PAGE + PAGE - 1)
        : q.limit(PER_BOX)) as unknown as { data: VenueRow[] | null; error: ReadError };
      if (error) return { data: out, error };
      out.push(...(data ?? []));
      if (!opts.all || (data ?? []).length < PAGE) return { data: out, error: null };
    }
    console.error('[real-places] counted to the page limit — the number is a floor', { miles, rows: out.length });
    return { data: out, error: null, floor: true };
  };
  const pending = (e: ReadError) => !!e && (e.code === '42703' || /gone_at|osm_tags|opening_hours/.test(e.message || ''));
  const first = await read(FULL, true);
  if (!pending(first.error)) return first;
  // gone_at is the newest column, so it is the likeliest to be missing: keep
  // the hours and the cuisine and drop only the filter. Nothing has been
  // marked gone before the column exists, so the answer is the same.
  console.error('[real-places] reading venues without gone_at — run sql/world-data-phase1-2026-09-24.sql', { code: first.error?.code, message: first.error?.message });
  const second = await read(FULL, false);
  if (!pending(second.error)) return second;
  console.error('[real-places] reading venues without osm_tags or opening_hours — run sql/venue-hours-2026-09-23.sql', { code: second.error?.code, message: second.error?.message });
  return read(BASIC, false);
}

/**
 * Real places near where somebody is going.
 *
 * Read from our own table, which the sweep and the weekly map load fill.
 * Nearest first, in growing boxes (see RINGS_MILES), stopping at the first
 * box dense enough to fill the menu.
 *
 * Returns an empty list rather than throwing. Every caller has to handle
 * empty anyway — plenty of real towns have nothing mapped — and an empty
 * list has a correct behaviour, which is to name no venues at all.
 */
export async function placesFor(
  db: SupabaseClient,
  where: { city: string | null; country?: string | null; interests?: string[] },
  // A menu is capped so it can be read; a count must not be, or the number
  // is an artifact of the cap rather than a fact about the town. "10 places
  // to eat verified here" was true of the list and false of the place.
  //
  // `eveningOut` says the plan is a night out, so food and drink are checked
  // against the evening rather than the day (see windowFor). `counted` is
  // told whether a count reached the page limit, which makes every number
  // taken from it a floor.
  opts: {
    perKind?: number; max?: number; days?: { from: string; to: string } | null; wantFood?: string[];
    eveningOut?: boolean; counted?: { floor: boolean };
  } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<RealPlace[]> {
  const perKind = opts.perKind ?? PER_KIND;
  const max = opts.max ?? 60;
  const city = String(where.city || '').trim();
  if (!city) return [];

  // A wonder is not a town. "Machu Picchu" is read around Aguas Calientes,
  // the town at its foot that the map load seeds for it, rather than handed
  // to a geocoder that finds no settlement by that name (or, for "Petra", a
  // village in Mallorca) — the load would hold the venues and the menu
  // would look for them somewhere else.
  const site = siteTown(city, where.country ?? null);
  const at: Awaited<ReturnType<typeof locate>> = site
    ? { lat: site.lat, lng: site.lng, name: site.name, from: city, countryCode: site.country.toLowerCase(), subdivision: null }
    : await locate(city, where.country ?? null, fetchImpl).catch(() => null);
  if (!at) {
    console.error('[real-places] could not place', { city });
    return [];
  }

  // What the sweep should go and fetch for this town, in the quiz's own
  // words — which is the vocabulary discovery_venues.interest is stored in.
  // Whatever they answered, plus the kinds every itinerary needs: a trip has
  // dinner and a morning in it regardless of what anybody ticked.
  const seeker: Seeker = {
    lat: at.lat, lng: at.lng, city: site?.name ?? city,
    interests: [...new Set([...(where.interests ?? []).slice(0, 6), ...ALWAYS_SWEPT])],
    avoid: [],
  };

  // Our own rows only. Overpass was tried here first and measured, which is
  // the whole reason it is not here now:
  //
  //   Moab        1 place    6.2s   (three mirrors timed out)
  //   Washington  0 places  72.7s   (every mirror timed out, twice over)
  //   Charleston 13 places  39.2s   (answered, but only at a 4-mile box)
  //
  // Seventy-two seconds to be told nothing. So the map is read on a
  // schedule — /api/discovery/sweep nightly, the Geofabrik load weekly —
  // and this reads the table, which is instant.
  //
  // Read without an interest filter, unlike Discover. Discover is answering
  // "what is on near me that I would like", so it matches the quiz's own
  // words; a menu is answering "what exists here at all", and filtering it
  // to somebody's five answers returned six of Raleigh's eighty-seven
  // venues and not one restaurant. A day has a dinner in it whether or not
  // anybody listed food as an interest.
  //
  // What a held row is on the menu, or null when it cannot be on it: a
  // caterer, a hotel, a name already taken, or shut on the plan's days.
  // Remembered per row, because the rings re-read the same rows and the
  // hours are parsed once each.
  const countryCode = at.countryCode ?? where.country ?? null;
  const shaped = new Map<string, Shaped | null>();
  const shape = (v: VenueRow): Shaped | null => {
    const key = String(v.id);
    if (shaped.has(key)) return shaped.get(key)!;
    let out: Shaped | null = null;
    const kind = String(v.kind || v.interest || 'place').replace(/_/g, ' ').trim() || 'place';
    const usable = !!v.name && canTurnUp(String(v.name), [String(v.kind || '')])
      // Belt and braces for rows filed before lodging had an interest of its
      // own: whatever the interest says, a hotel is not dinner.
      && v.interest !== STAY_INTEREST && !LODGING_KIND.test(String(v.kind || ''))
      && !acrossTheBorder(v.region, countryCode);
    // Shut on the plan's own days, going by hours the map records and we
    // could parse. No date, no hours, or hours we cannot read: kept. See
    // lib/discovery/hours.ts for why the rule leans that way.
    //
    // Undated, the one thing hours can still settle is a place that is never
    // open: "off" or "closed" says shut whatever the date turns out to be.
    const here = { lat: at.lat, lng: at.lng, countryCode };
    const shut = opts.days
      ? closedThroughout(v.opening_hours, opts.days, windowFor(kind, v.interest, !!opts.eveningOut), here)
      : neverOpen(v.opening_hours, here);
    if (usable && !shut) {
      out = {
        id: v.id,
        rawKind: v.kind ?? null,
        name: String(v.name),
        kind,
        interest: (v.interest as string | null) || null,
        url: (v.website as string | null) || null,
        city: (v.city as string | null) ?? seeker.city ?? null,
        street: (v.street as string | null) || null,
        hours: (v.opening_hours as string | null) || null,
        miles: milesBetween(at.lat, at.lng, Number(v.lat), Number(v.lng)),
        cuisine: String((v.osm_tags ?? {}).cuisine ?? ''),
        reservation: takesBookings((v.osm_tags ?? {}).reservation),
        phone: dialable(v.phone || (v.osm_tags ?? {}).phone || (v.osm_tags ?? {})['contact:phone'], countryCode),
        reserveUrl: /^https?:\/\//i.test(String(v.reservation_url || '')) ? String(v.reservation_url) : null,
      };
    }
    shaped.set(key, out);
    return out;
  };
  const menuRows = () => dedupe(
    [...held.values()].map(shape).filter((r): r is Shaped => !!r).sort((a, b) => a.miles - b.miles),
  );

  // Nearest first, in growing boxes. After each box the kinds that already
  // have their share are left out of the next, and the growing stops once
  // the menu could be filled from what is held: everything further out
  // would sort behind it and never be chosen. A count (max Infinity) reads
  // the whole radius instead, every page of it.
  const held = new Map<string, VenueRow>();
  let readError: ReadError = null;
  const rings = Number.isFinite(max) ? RINGS_MILES : [RINGS_MILES[RINGS_MILES.length - 1]];
  for (const miles of rings) {
    const perKindNow = new Map<string, number>();
    const rawKinds = new Map<string, Set<string>>();
    for (const r of menuRows()) {
      perKindNow.set(r.kind, (perKindNow.get(r.kind) ?? 0) + 1);
      if (r.rawKind) rawKinds.set(r.kind, (rawKinds.get(r.kind) ?? new Set()).add(r.rawKind));
    }
    const fillable = [...perKindNow.values()].reduce((n, c) => n + Math.min(c, perKind), 0);
    if (fillable >= max) break;
    const except = [...perKindNow.entries()]
      .filter(([, c]) => c >= perKind)
      .flatMap(([k]) => [...(rawKinds.get(k) ?? [])]);
    const { data, error, floor } = await venuesInBox(db, at, miles, { except, all: !Number.isFinite(max) });
    if (error) { readError = error; break; }
    if (floor && opts.counted) opts.counted.floor = true;
    for (const v of data) if (!held.has(String(v.id))) held.set(String(v.id), v);
  }

  if (readError) {
    // A missing table means the migration has not been run, which looks
    // exactly like a town with nothing in it unless the log says otherwise.
    console.error('[real-places] could not read the venue table', { code: readError.code, message: readError.message });
    if (!held.size) return [];
  }

  // The food somebody asked for, looked for across the whole radius rather
  // than only in the boxes read above. Two birthday nights asked for Thai
  // and for Greek and both ended at a ramen bar: the menu was the eight
  // nearest restaurants and a Thai place further out was never read. Asked
  // by name and by the map's cuisine, because cuisine is often only in the
  // name ("Lemongrass Thai", filed as "places to eat").
  const wants = (opts.wantFood ?? []).map(w => w.toLowerCase().trim()).filter(Boolean);
  for (const want of wants) {
    const word = want.replace(/[^a-z\s-]/g, '').trim();
    if (word.length < 3) continue;
    // The cuisine clause only where the column exists: naming a missing
    // osm_tags in the filter failed every retry, and the food asked for was
    // quietly never looked for.
    const { data, error } = await venuesInBox(db, at, RINGS_MILES[RINGS_MILES.length - 1], {
      also: (q, tags) => q.or(`name.ilike.*${word}*,interest.ilike.*${word}*,kind.ilike.*${word}*${tags ? `,osm_tags->>cuisine.ilike.*${word}*` : ''}`),
    });
    if (error) console.error('[real-places] could not look for the food asked for', { want: word, code: error.code, message: error.message });
    for (const v of data) if (!held.has(String(v.id))) held.set(String(v.id), v);
  }

  // Tell the sweep this town is wanted. It writes an area row, the nightly
  // job works through them, and a destination asked for once is covered the
  // next time somebody asks. Never awaited into the answer: filling the
  // cache is for the next traveller, not this one.
  void noteArea(db, seeker).catch(() => {});

  const rows = menuRows();

  if (!rows.length) {
    console.log('[real-places] no verified venues held for this town yet — it will name none', { city: seeker.city });
  }

  const asPlace = (r: typeof rows[number], ref: string, forFood?: string): RealPlace => ({
    ref, name: r.name, kind: r.kind, interest: r.interest, url: r.url, city: r.city, source: 'osm',
    street: r.street, hours: r.hours,
    reservation: r.reservation, phone: r.phone, reserveUrl: r.reserveUrl,
    ...(forFood ? { forFood } : {}),
  });

  // A few of each kind, nearest first, so the menu can furnish a whole day
  // rather than sixty restaurants and nothing to do between them.
  const taken = new Map<string, number>();
  const places: RealPlace[] = [];
  // The food somebody asked for, found among everything read and put first,
  // outside the per-kind cap. Matched on the kind, the name and the map's
  // cuisine.
  const pinned = new Set<string>();
  for (const want of wants) {
    const re = new RegExp(`\\b${want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    for (const r of rows.filter(r => re.test(`${r.name} ${r.kind} ${r.interest ?? ''} ${r.cuisine}`)).slice(0, 2)) {
      if (pinned.has(r.name)) continue;
      pinned.add(r.name);
      places.push(asPlace(r, `p${places.length + 1}`, want));
    }
  }
  for (const r of rows) {
    if (pinned.has(r.name)) continue;
    const n = taken.get(r.kind) ?? 0;
    if (n >= perKind) continue;
    taken.set(r.kind, n + 1);
    places.push(asPlace(r, `p${places.length + 1}`));
    if (places.length >= max) break;
  }
  // What is on at those places, from their own pages.
  //
  // Not for a count. A count is every place in twenty-five miles — twenty
  // thousand of them in a city — and it wants numbers, not listings: asking
  // for their events put thousands of ids in one URL, which PostgREST
  // refuses as too long, and matched each row to its place with a scan of
  // the whole list, twenty thousand times over, for each of three trips.
  if (places.length && Number.isFinite(max)) {
    const byName = new Map(places.map(p => [p.name, p] as const));
    const ids = new Map<string, RealPlace>();
    for (const r of rows) {
      const p = byName.get(r.name);
      if (p && r.id) ids.set(String(r.id), p);
    }
    if (ids.size) {
      const { data: on, error: onErr } = await db
        .from('discovery_events')
        .select('venue_id, title, when_text, starts_on')
        .in('venue_id', [...ids.keys()])
        .gt('stale_after', new Date().toISOString())
        .limit(300);
      if (onErr) {
        console.error('[real-places] could not read what is on', { code: onErr.code });
      } else {
        for (const e of on ?? []) {
          const p = ids.get(String(e.venue_id));
          if (!p) continue;
          const when = e.when_text || e.starts_on;
          if (!when) continue;
          // The menu the itinerary is written from. A night that happened in
          // 2020 offered as what is on this week is the model being handed a
          // false fact, and it will repeat it faithfully.
          if (!stillToCome(e, today())) continue;
          // And on the plan's own days, when it has them.
          if (opts.days && !onTheDays(e, opts.days.from, opts.days.to)) continue;
          (p.whatsOn ??= []).push(`${e.title} — ${when}`);
        }
      }
    }
  }

  return places;
}

/**
 * The block the prompt carries, and the only venues a plan may name.
 *
 * Grouped by kind so the model can find a dinner without reading sixty
 * lines, and capped, because a list long enough to bury the instruction is
 * a list that gets ignored.
 */
export function placeMenu(places: RealPlace[]): string {
  if (!places.length) {
    return [
      'WE HAVE NO VERIFIED VENUES FOR THIS PLACE.',
      '',
      'Name no restaurants, bars, shops, venues or businesses at all — not',
      'one, however sure you feel. Write the plan in terms of what to do',
      '("dinner near the waterfront", "a morning walk along the cliff path")',
      'and leave the choosing to them. A made-up name is worse than no name:',
      'they will turn up at a door that is not there.',
    ].join('\n');
  }

  const byKind = new Map<string, RealPlace[]>();
  for (const p of places) {
    const list = byKind.get(p.kind) ?? [];
    list.push(p);
    byKind.set(p.kind, list);
  }

  const lines: string[] = [
    'THE REAL PLACES IN THIS TOWN. These exist — they are read from',
    'OpenStreetMap and our own verified venue table, not remembered.',
    '',
  ];
  for (const [kind, list] of byKind) {
    lines.push(`${kind}:`);
    // Places with something on first.
    //
    // A pub with a quiz on Wednesday is a better answer than a pub about
    // which we know only the name — it gives somebody a reason to pick a
    // night and somebody else a reason to come. They were being listed in
    // whatever order the table returned, so across six regenerated plans
    // not one of the venues with a known night was chosen.
    const ordered = [...list].sort((a, b) => (b.whatsOn?.length ?? 0) - (a.whatsOn?.length ?? 0));
    for (const p of ordered) {
      lines.push(`  [${p.ref}] ${p.name}`);
      // The map's hours, labelled as the map's. They let the plan put the
      // Sunday-closed restaurant on Saturday; they are not ours to promise.
      if (p.hours) lines.push(`        hours per OpenStreetMap: ${p.hours}`);
      // Whether it takes bookings, as mapped — the one fact that decides
      // "book ahead" or "walk in", so the model need not guess it.
      if (p.reservation) lines.push(`        reservations per OpenStreetMap: ${p.reservation}`);
      // What is actually on there, read off the venue's own page. Their
      // words, not ours — "every Wednesday Night at 7 PM" is the pub's own
      // phrasing and is worth repeating exactly, because it is checkable.
      for (const on of (p.whatsOn ?? []).slice(0, 3)) lines.push(`        · ${on}`);
    }
    lines.push('');
  }
  lines.push(
    'RULES, and they are absolute:',
    '- Every venue you name must be one of these, spelled exactly as written,',
    '  with its [ref] in the slot\'s place_ref field.',
    '- You may not name any other business. Not one you are confident about,',
    '  not a famous one, not an "obvious" one. If it is not on this list we',
    '  have not checked it and we will not put it in front of anybody.',
    '- A slot that needs no venue — a walk, a drive, a morning off — sets',
    '  place_ref to null and names nothing. That is a good answer.',
    '- Do not describe what a place is like inside, what it is known for,',
    '  what it costs or how busy it gets. The list gives you a name, a kind,',
    '  sometimes its hours and sometimes what is on there.',
    '  That is everything we know about it.',
    '- "hours per OpenStreetMap" is what volunteers mapped, and may be out of',
    '  date. Use it to put a place on a day it is open. If you mention the',
    '  hours at all, say they are per OpenStreetMap; never state them as',
    '  certain, and never give hours for a place that has none listed.',
    '- Places with something listed under them come first in each group, and',
    '  they are the better answer where one fits: a night somebody can plan',
    '  around beats a name on its own.',
    '- Where a place has something listed under it — "· Pub Trivia Night —',
    '  every Wednesday Night at 7 PM" — that is read off the venue\'s own',
    '  page and you may say it, in those words. It is the most useful thing',
    '  on this list: it is a real reason to be somewhere on a particular',
    '  night. Do not change the day, the time or the name of it, and do not',
    '  invent one for a place that has none.',
  );
  return lines.join('\n');
}

/**
 * A citation, or null — and null for anything that is not one.
 *
 * A live run put "http://null" in this field, which resolves to nothing and
 * so was harmless, but it is not a reference and it must not travel any
 * further as if it might be one. Only the shape we handed out is accepted.
 */
export function citedPlace(ref: unknown, places: RealPlace[]): RealPlace | null {
  const want = cleanRef(ref);
  return want ? places.find(p => p.ref === want) ?? null : null;
}

/** The ref if it looks like one of ours, otherwise null. */
export function cleanRef(ref: unknown): string | null {
  if (typeof ref !== 'string') return null;
  const want = ref.trim().toLowerCase().replace(/[[\]]/g, '');
  return /^p\d+$/.test(want) ? want : null;
}

// ─── The check, because a prompt rule is a request ───────────────────────
// Everything above asks the model not to invent. Asking has a good success
// rate and a good success rate is not the standard: one invented restaurant
// in fifty is still somebody standing outside a building that is a laundrette.
// So the output is read back, and a name we cannot source does not ship.

/**
 * Words that are capitalised because a sentence started, not because
 * somebody named a business.
 *
 * Trimmed off the front of a run rather than used to reject it. "Dinner at
 * El Charro Loco" is one capitalised run, and rejecting the whole thing
 * because it opens with "Dinner" is how the invented restaurant got through
 * the first version of this: the giveaway word shielded the name behind it.
 */
const NOT_A_VENUE = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'then', 'after', 'before', 'grab',
  'head', 'walk', 'drive', 'take', 'start', 'finish', 'end', 'spend', 'catch',
  'visit', 'try', 'stop', 'book', 'stay', 'eat', 'see', 'go', 'get', 'enjoy',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'morning', 'afternoon', 'evening', 'night', 'breakfast', 'lunch', 'dinner',
  'brunch', 'day', 'one', 'two', 'three', 'four', 'five',
  'if', 'you', 'your', 'it', 'this', 'that', 'there', 'here', 'reach',
]);

/**
 * The small words real names carry: Museum *of the* American West.
 *
 * Deliberately no "in", "at" or "on". Those introduce where a thing is
 * rather than belonging to what it is called, and treating them as joiners
 * glued the location onto the name: "La Piazzetta in the Romantic Zone" came
 * out as one name, which then matched the real Romantic Zone and let the
 * invented restaurant through on its coat-tails.
 */
const JOINER = new Set(['of', 'the', 'de', 'du', 'la', 'le', 'and', '&']);

/**
 * Proper names in a sentence — the runs of capitalised words that read like
 * somebody's business rather than like prose.
 *
 * Deliberately eager. A false positive costs a name being softened to "a
 * nearby spot", which is a true sentence either way; a false negative is an
 * invented restaurant on somebody's phone at seven in the evening.
 */
export function properNames(text: string): string[] {
  const names: string[] = [];
  const isCap = (w: string) => /^[A-Z][\w'’&-]*$/.test(w);

  for (const sentence of String(text || '').split(/(?<=[.!?;:])\s+|\n+/)) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    let run: string[] = [];

    const flush = () => {
      // Drop a trailing joiner: "Moab and" ends at "Moab".
      while (run.length && JOINER.has(run[run.length - 1].toLowerCase())) run.pop();
      // Trim the sentence's own opening words, and any joiner they leave
      // stranded, until what is left starts like a name.
      //
      // A capitalised joiner is kept, because it is part of the name rather
      // than glue between parts of one: "La Piazzetta" and "The Black Cat"
      // begin with their article. Trimming it produced "La a local spot",
      // which is worse than either leaving the name or removing it whole.
      while (run.length && (
        NOT_A_VENUE.has(stripPunctuation(run[0]))
        || (JOINER.has(run[0].toLowerCase()) && run[0][0] === run[0][0].toLowerCase())
      )) run.shift();
      if (run.length >= 2) names.push(run.join(' ').replace(/[.,;:!?]+$/, ''));
      run = [];
    };

    for (const word of words) {
      const bare = word.replace(/[.,;:!?]+$/, '');
      if (isCap(bare)) {
        run.push(word);
        // Punctuation ends a name: "Milt's Stop & Eat, then drinks".
        if (/[.,;:!?]$/.test(word)) flush();
      } else if (run.length && JOINER.has(bare.toLowerCase())) {
        run.push(word);
      } else {
        flush();
      }
    }
    flush();
  }
  return names;
}

/** A word as it reads without the punctuation attached to it. */
function stripPunctuation(word: string): string {
  return word.replace(/[.,;:!?]+$/, '').toLowerCase();
}

/** Does the list of real places vouch for this name? */
export function isVouchedFor(name: string, places: RealPlace[]): boolean {
  const want = normalise(name);
  if (!want) return false;
  return places.some(p => {
    const known = normalise(p.name);
    if (!known) return false;
    // One direction only. A real name may be longer than the one somebody
    // writes — the map's "Arches National Park Visitor Center" against a
    // sentence's "Arches National Park" — so a known name containing what
    // was written vouches for it.
    //
    // The other way round does not, and that is the whole "Moab Giants"
    // lesson in one line: a real "Moab" inside an invented "Moab Giants"
    // would vouch for the invention. Anything we hold that happens to be a
    // fragment of a longer phrase proves nothing about the phrase.
    return known === want || known.includes(want);
  });
}

/**
 * Every name in this text that nothing vouches for.
 *
 * `allow` carries the names we know are real from somewhere other than the
 * menu — the town itself, and a real ticketed event's venue, which comes
 * from a listing rather than from the map.
 */
export function unverifiedNames(
  text: string,
  places: RealPlace[],
  allow: string[] = [],
): string[] {
  const extra = allow.filter(Boolean).map(a => ({ ref: '', name: a, kind: '', interest: null, url: null, city: null, source: 'given' }));
  const vouching = [...places, ...extra];
  return [...new Set(properNames(text).filter(n => !isVouchedFor(n, vouching)))];
}


/**
 * The same sentence with the unsourceable names taken out of it.
 *
 * Not deleted, and not left in either — softened to what we can actually
 * stand behind. "Dinner at El Charro Loco, then drinks" becomes "Dinner at a
 * local spot, then drinks", which is a true sentence about an evening rather
 * than a false one about a restaurant.
 *
 * This is the same bargain `payment` struck when it became nullable: a field
 * that cannot be answered honestly is answered emptily. The difference is
 * that a plan line cannot be empty, so it loses the claim and keeps the
 * shape. Somebody reading "a local spot" knows to choose one; somebody
 * reading a name that does not exist finds out at the door.
 */
export function withoutUnverified(
  text: string,
  places: RealPlace[],
  allow: string[] = [],
): { text: string; removed: string[] } {
  const removed = unverifiedNames(text, places, allow);
  if (!removed.length) return { text, removed: [] };

  let out = String(text || '');
  for (const name of removed) {
    // The article in front comes with it. "The Pour House Music Hall" is
    // detected as the name without its "The", because a leading article is
    // how sentences start as well as how names do — and replacing only the
    // rest left "The another nearby" on the screen.
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\\b(?:The|A|An)\\s+${escaped}`, 'g'), 'a local spot');
    // Longest first would matter if names overlapped; they are whole runs,
    // so a plain replacement of each is enough.
    out = out.split(name).join('a local spot');
  }
  // "at a local spot" twice in one line reads like a fault, because it is
  // one. Second and later mentions become "another".
  let seen = 0;
  out = out.replace(/a local spot/g, () => (++seen > 1 ? 'another nearby' : 'a local spot'));
  return { text: out, removed };
}

/**
 * Whether softening this sentence would leave it broken.
 *
 * Swapping a name out works when the name is the object of the sentence —
 * "dinner at X" becomes "dinner at a local spot" and still reads. It does
 * not work when the name is the SUBJECT. A live run turned a tip into "a
 * local spot stays lively after evening shows let out", which is not a
 * sentence anybody wrote and not advice anybody can use.
 *
 * Where the replacement would land at the start, the line is dropped
 * instead. A missing tip is a day without a tip; a mangled one is the app
 * talking nonsense.
 */
export function wouldMangle(text: string, removed: string[]): boolean {
  const t = String(text || '').trimStart();
  // "The Pour House is lively" does not start with "Pour House", and the
  // article is swallowed with the name — so both are compared bare.
  const bare = (s: string) => s.replace(/^(?:the|a|an)\s+/i, '');
  return removed.some(name => {
    // The subject of the sentence.
    if (t.startsWith(name) || bare(t).startsWith(bare(name))) return true;
    // Or a phrase that only makes sense about a place with extent — a
    // street, a trail, a district. "Walk the length of Main Street" became
    // "walk the length of a local spot", which is not a sentence about
    // anything. A venue has no length to walk and no far end to reach.
    const before = t.slice(0, t.indexOf(name)).toLowerCase();
    return /\b(the length of|the far end of|all the way along|the whole of)\s*$/.test(before);
  });
}

// ─── What a town's scene actually is, counted rather than remembered ─────
// The option cards carried two paragraphs each — "legendary taco trucks on
// Cesar Chavez, plus James Beard-winning Suerte" — written from a model's
// memory of a city. They read beautifully and asserted a dozen things
// nobody had checked: that the trucks are there, that the restaurant has
// that award, that either still exists.
//
// We do hold something true about a town, though, and it is duller and
// better: the venues we have actually verified in it. Counting those says
// something real about where somebody is going, and says it in a form that
// cannot be wrong.

/** The scene lines for a town, from the venues we hold, or null for none. */
export function scenesFrom(places: RealPlace[], opts: { floor?: boolean } = {}): { food: string; music: string } | null {
  if (!places.length) return null;

  // A count that stopped at the page limit is a floor, and says so: "20,000+"
  // is true of a city where "20,000" would be a number about our reader.
  const count = (test: (p: RealPlace) => boolean) => {
    const n = places.filter(test).length;
    return n && opts.floor ? `${n.toLocaleString('en-US')}+` : n ? n.toLocaleString('en-US') : 0;
  };
  const isFood = (p: RealPlace) =>
    /restaurant|cafe|bakery|marketplace|food|deli|pub/i.test(`${p.kind} ${p.interest ?? ''}`);
  const isDrink = (p: RealPlace) => /brewery|bar|wine|pub|distiller/i.test(`${p.kind} ${p.interest ?? ''}`);
  const isMusic = (p: RealPlace) =>
    /nightclub|music|theatre|theater|concert|dance|arts centre/i.test(`${p.kind} ${p.interest ?? ''}`);

  // The cuisines the table actually recorded, in its own words.
  const cuisines = [...new Set(
    places
      .map(p => /^(\w[\w\s]*?) restaurants$/i.exec(String(p.interest ?? ''))?.[1])
      .filter((c): c is string => !!c),
  )].slice(0, 4);

  const food = [
    `${count(isFood)} places to eat verified here`,
    cuisines.length ? `strongest on ${listOf(cuisines)}` : null,
    count(isDrink) ? `${count(isDrink)} for a drink` : null,
  ].filter(Boolean).join(', ') + '.';

  const music = count(isMusic)
    ? `${count(isMusic)} music, theatre and nightlife venues verified here.`
    : 'Nothing verified for music or nightlife here yet.';

  return { food, music };
}

/** "a, b and c" — the way somebody would say it. */
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// ─── "Reach will book this" has to be something Reach can do ─────────────
// The pill said so on slots the app has never been able to book. The prompt
// forbids it — "never reach for a restaurant, a bar or anything with a
// table" — and a prompt forbidding something is not the same as it not
// happening. The screen defended itself by checking the slot's type, which
// is a second guess at the same unknown.
//
// A resolved place answers it outright. The map says what a thing is, and
// Reach books flights, rooms and ticketed events — not tables.

/** Kinds Reach can genuinely book, in the map's own words. */
const BOOKABLE = /hotel|hostel|motel|guest_house|guesthouse|apartment|chalet|resort/i;

/**
 * The booking mode this slot can actually stand behind.
 *
 * `hasTicket` is for the one case the map cannot answer: a real listed event
 * with a page that sells tickets. That is bookable because somebody checked,
 * not because a model felt confident.
 */
export function bookingFor(
  claimed: string,
  place: RealPlace | null,
  hasTicket = false,
): 'reach' | 'ahead' | 'walk_in' {
  // What the map says about reservations beats what the model guessed:
  // "required" or "recommended" is a table to book, "no" is walk in. A
  // ticketed event is arranged with its seller whatever the tag says.
  const mapped = place?.reservation ?? null;
  if (claimed !== 'reach') {
    if (!hasTicket && (mapped === 'required' || mapped === 'recommended')) return 'ahead';
    if (!hasTicket && mapped === 'no') return 'walk_in';
    return claimed === 'ahead' ? 'ahead' : 'walk_in';
  }
  if (!hasTicket && mapped === 'no') return 'walk_in';
  // A ticketed event is the one thing we are most certain about and still
  // not something Reach books. The ticket is bought from whoever sells it —
  // that is the whole point of the handoff — so counting it as a Reach
  // booking put it in "1 booking Reach handles" and into the total on the
  // button that charges a card. It is arranged, by them, with a link.
  if (hasTicket) return 'ahead';
  if (place && BOOKABLE.test(`${place.kind} ${place.interest ?? ''}`)) return 'reach';
  // Claimed and unsupportable. "Reserve ahead" is the honest neighbour: it
  // tells somebody this needs arranging without promising we will do it.
  return 'ahead';
}
