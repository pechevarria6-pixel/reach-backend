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
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Seeker } from './types.ts';
import { locate } from './geocode.ts';
import { noteArea, milesBetween } from './cache.ts';
import { canTurnUp } from './rules.ts';
import { normalise } from './verify.ts';

export interface RealPlace {
  /** What the model cites. Short on purpose — it is typed back to us. */
  ref: string;
  name: string;
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
}

/**
 * How far out to look, in miles.
 *
 * A trip is not a Friday night: somebody in Moab will drive forty minutes to
 * a trailhead and think nothing of it, where Discover's tighter box is right
 * for "what is on near me tonight".
 */
const RADIUS_MILES = 25;

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

/**
 * Real places near where somebody is going.
 *
 * The cache first and the map second, which is the same order Discover uses
 * and for the same reason: the cached rows came from the map on an earlier
 * sweep, they cost nothing, and a town we have already swept answers
 * instantly. The live call only happens when the cache is thin.
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
  opts: { perKind?: number; max?: number } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<RealPlace[]> {
  const perKind = opts.perKind ?? PER_KIND;
  const max = opts.max ?? 60;
  const city = String(where.city || '').trim();
  if (!city) return [];

  const at = await locate(city, where.country ?? null, fetchImpl).catch(() => null);
  if (!at) {
    console.error('[real-places] could not place', { city });
    return [];
  }

  // What the sweep should go and fetch for this town, in the quiz's own
  // words — which is the vocabulary discovery_venues.interest is stored in.
  // Whatever they answered, plus the kinds every itinerary needs: a trip has
  // dinner and a morning in it regardless of what anybody ticked.
  const seeker: Seeker = {
    lat: at.lat, lng: at.lng, city: at.city || city,
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
  // Seventy-two seconds to be told nothing. A generation that already had to
  // drop from adaptive thinking to stay under the platform's ceiling cannot
  // spend that, and a dense city — which is where most trips go — is exactly
  // where Overpass refuses. So the map is read on a schedule by
  // /api/discovery/sweep and this reads the table, which is instant.
  //
  // Read without an interest filter, unlike Discover. Discover is answering
  // "what is on near me that I would like", so it matches the quiz's own
  // words; a menu is answering "what exists here at all", and filtering it
  // to somebody's five answers returned six of Raleigh's eighty-seven
  // venues and not one restaurant. A day has a dinner in it whether or not
  // anybody listed food as an interest.
  const dLat = RADIUS_MILES / 69;
  const dLng = RADIUS_MILES / Math.max(1, 69 * Math.cos((at.lat * Math.PI) / 180));
  const { data, error } = await db
    .from('discovery_venues')
    .select('id, name, kind, interest, website, city, street, lat, lng')
    .gte('lat', at.lat - dLat).lte('lat', at.lat + dLat)
    .gte('lng', at.lng - dLng).lte('lng', at.lng + dLng)
    .limit(400);

  if (error) {
    // A missing table means the migration has not been run, which looks
    // exactly like a town with nothing in it unless the log says otherwise.
    console.error('[real-places] could not read the venue table', { code: error.code, message: error.message });
    return [];
  }

  // Tell the sweep this town is wanted. It writes an area row, the nightly
  // job works through them, and a destination asked for once is covered the
  // next time somebody asks. Never awaited into the answer: filling the
  // cache is for the next traveller, not this one.
  void noteArea(db, seeker).catch(() => {});

  const rows = dedupe(
    (data ?? [])
      .filter(v => v.name && canTurnUp(String(v.name), [String(v.kind || '')]))
      .map(v => ({
        id: v.id,
        name: String(v.name),
        kind: String(v.kind || v.interest || 'place').replace(/_/g, ' ').trim() || 'place',
        interest: (v.interest as string | null) || null,
        url: (v.website as string | null) || null,
        city: (v.city as string | null) ?? seeker.city ?? null,
        miles: milesBetween(at.lat, at.lng, Number(v.lat), Number(v.lng)),
      }))
      .sort((a, b) => a.miles - b.miles),
  );

  if (!rows.length) {
    console.log('[real-places] no verified venues held for this town yet — it will name none', { city: seeker.city });
  }

  // A few of each kind, nearest first, so the menu can furnish a whole day
  // rather than sixty restaurants and nothing to do between them.
  const taken = new Map<string, number>();
  const places: RealPlace[] = [];
  for (const r of rows) {
    const n = taken.get(r.kind) ?? 0;
    if (n >= perKind) continue;
    taken.set(r.kind, n + 1);
    places.push({
      ref: `p${places.length + 1}`,
      name: r.name, kind: r.kind, interest: r.interest, url: r.url, city: r.city, source: 'osm',
    });
    if (places.length >= max) break;
  }
  // What is on at those places, from their own pages.
  if (places.length) {
    const ids = new Map<string, RealPlace>();
    for (const r of rows) {
      const p = places.find(x => x.name === r.name);
      if (p && r.id) ids.set(String(r.id), p);
    }
    if (ids.size) {
      const { data: on, error: onErr } = await db
        .from('discovery_events')
        .select('venue_id, title, when_text, starts_on')
        .in('venue_id', [...ids.keys()])
        .limit(300);
      if (onErr) {
        console.error('[real-places] could not read what is on', { code: onErr.code });
      } else {
        for (const e of on ?? []) {
          const p = ids.get(String(e.venue_id));
          if (!p) continue;
          const when = e.when_text || e.starts_on;
          if (!when) continue;
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
    '  what it costs, when it is open or how busy it gets. The list gives you',
    '  a name, a kind, and sometimes what is on there. That is everything we',
    '  know about it.',
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
  return removed.some(name => {
    // The subject of the sentence.
    if (t.startsWith(name)) return true;
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
export function scenesFrom(places: RealPlace[]): { food: string; music: string } | null {
  if (!places.length) return null;

  const count = (test: (p: RealPlace) => boolean) => places.filter(test).length;
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
  if (claimed !== 'reach') return claimed === 'ahead' ? 'ahead' : 'walk_in';
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
