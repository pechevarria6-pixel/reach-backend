// ─── What people are into, in words every source understands ─────────────
// Discover used to hear one answer: the activities question. Somebody who
// told the quiz they eat Japanese, drink cocktails and end a good night in a
// proper pub, and skipped the activities, got nothing that knew them. And
// somebody who skipped the quiz altogether got a nearly empty screen, which
// is the first thing a new person sees.
//
// So every answer becomes a kind of place, and every kind knows how to be
// found on the map and on Yelp. A person with nothing to go on still gets a
// bit of everything — looked for on behalf of the city, and never presented
// as though it were found because of them.

export interface Kind {
  /** The words stored against a venue and shown as the card's category. */
  key: string;
  emoji: string;
  /** Overpass selectors. Empty where the map is the wrong place to look. */
  osm: string[];
  /** What to type into Yelp. */
  yelp: string;
  /**
   * Whether the venue's own website is worth reading for classes and dates.
   * A studio's is. A restaurant's is a menu, and reading it spends the
   * nightly budget that should have gone on the studio.
   */
  harvest: boolean;
  /** Ruled out for somebody who is not drinking. */
  alcohol?: boolean;
  /** Ruled out for somebody who said no to clubs or loud rooms. */
  loud?: boolean;
}

const kind = (key: string, emoji: string, osm: string[], yelp: string, harvest: boolean, extra: Partial<Kind> = {}): Kind =>
  ({ key, emoji, osm, yelp, harvest, ...extra });

const KINDS: Record<string, Kind> = Object.fromEntries([
  // The activities question. Several selectors each, because mappers tag the
  // same thing differently — a ceramics studio is craft=pottery to one and
  // shop=pottery to the next.
  kind('pottery & crafts', '🏺', ['craft=pottery', 'shop=pottery', 'craft=ceramics', 'amenity=arts_centre'], 'pottery class', true),
  // craft=confectionery is somebody who makes sweets for a living, which is a
  // supplier rather than an evening. amenity=cooking_school teaches people.
  kind('cooking', '🍳', ['amenity=cooking_school'], 'cooking class', true),
  kind('art & galleries', '🎨', ['tourism=gallery', 'amenity=arts_centre', 'craft=painter'], 'art class', true),
  kind('live music', '🎸', ['amenity=music_venue', 'amenity=nightclub'], 'live music venue', true),
  kind('dancing', '💃', ['amenity=dancing_school', 'leisure=dance'], 'dance class', true),
  kind('wellness', '🧘', ['leisure=sauna', 'amenity=spa', 'shop=herbalist'], 'yoga studio', true),
  kind('sport', '⚽', ['leisure=sports_centre', 'leisure=climbing', 'sport=climbing'], 'climbing gym', true),
  kind('books & talks', '📚', ['shop=books', 'amenity=library'], 'bookshop events', true),
  kind('film & theatre', '🎬', ['amenity=cinema', 'amenity=theatre'], 'independent cinema', true),
  kind('comedy', '🎤', ['amenity=theatre'], 'comedy club', true),
  kind('photography', '📷', ['shop=photo', 'craft=photographer'], 'photography workshop', true),
  kind('outdoors', '🥾', ['leisure=nature_reserve', 'tourism=wilderness_hut'], 'guided walks', true),
  kind('markets & food halls', '🧺', ['amenity=marketplace'], 'farmers market', true),
  // Somewhere to eat, without caring what kind.
  //
  // Every food lookup in this file is `amenity=restaurant][cuisine~"..."`,
  // which only ever finds restaurants that carry a cuisine tag — and a great
  // many do not. Washington ended up with fifty-five verified venues and not
  // one place to eat: ten breweries, nine wine shops, seven pottery studios,
  // and nothing to have dinner at. So the itinerary for a gig there said
  // "a quick bite near the venue, nothing fancy", because there was nothing
  // it was allowed to name.
  //
  // This asks for restaurants as restaurants. The cuisine kinds still exist
  // and still matter — somebody who said they love Thai should be shown Thai
  // first — but a town needs dinner whether or not anybody said a cuisine.
  kind('places to eat', '🍽️', ['amenity=restaurant', 'amenity=cafe'], 'restaurant', false),
  kind('museums & history', '🏛️', ['tourism=museum'], 'museum', true),
  kind('wine tasting', '🍷', ['shop=wine', 'craft=winery'], 'wine tasting', true, { alcohol: true }),
  kind('breweries', '🍺', ['craft=brewery', 'microbrewery=yes'], 'brewery', true, { alcohol: true }),
  kind('trivia & board games', '🎲', ['shop=games'], 'trivia night', true),
  kind('gardens & parks', '🌳', ['leisure=garden][name~"botanic",i', 'tourism=zoo'], 'botanical garden', true),

  // Kinds that come from the other questions — how a night out ends, what
  // they drink, what they listen to.
  kind('pubs', '🍻', ['amenity=pub'], 'pub', false, { alcohol: true }),
  kind('cocktail bars', '🍸', ['amenity=bar'], 'cocktail bar', false, { alcohol: true }),
  kind('nightclubs', '🪩', ['amenity=nightclub'], 'dance club', false, { alcohol: true, loud: true }),
  // Cafés are on every corner of every map; asking Overpass for all of them
  // in a thirty mile box is how a volunteer server gets knocked over.
  kind('coffee', '☕', [], 'specialty coffee', false),
  kind('jazz', '🎷', ['amenity=music_venue][name~"jazz",i', 'amenity=bar][name~"jazz",i'], 'jazz bar', true),
  kind('classical music', '🎻', ['amenity=theatre][name~"symphony|philharmonic|opera|orchestra",i'], 'classical concert', true),
].map(k => [k.key, k]));

const CUISINE_PATTERN: Record<string, string> = {
  veggie: 'vegetarian|vegan', vegetarian: 'vegetarian|vegan', vegan: 'vegan',
  barbecue: 'barbecue|bbq', bbq: 'barbecue|bbq', steak: 'steak',
};
const CUISINE_EMOJI: Record<string, string> = {
  italian: '🍝', japanese: '🍣', mexican: '🌮', indian: '🍛', thai: '🍜',
  seafood: '🦞', steak: '🥩', veggie: '🥗', barbecue: '🔥',
};

// Somebody's own words reach Overpass's query language and a regular
// expression, so anything that could be syntax in either is taken out.
const clean = (s: string) => s
  .normalize('NFKC')
  .replace(/[^\p{L}\p{N} &'-]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 40);

/** What a given interest is, whether it came from a chip or was typed. */
export function kindFor(interest: string): Kind {
  const key = clean(String(interest ?? '').toLowerCase());
  if (KINDS[key]) return KINDS[key];

  if (key.endsWith(' restaurants')) {
    const cuisine = key.slice(0, -' restaurants'.length);
    const pattern = CUISINE_PATTERN[cuisine] ?? cuisine.split(' ')[0];
    return kind(
      key, CUISINE_EMOJI[cuisine] ?? '🍽️',
      // OSM stores cuisines as lists — "sushi;japanese" — so an exact match
      // would miss half the city's Japanese restaurants.
      pattern.length > 2 ? [`amenity=restaurant][cuisine~"${pattern}",i`] : [],
      `${cuisine} restaurant`, false,
    );
  }

  // Anything typed is searched by name. Somebody who wrote "letterpress"
  // should find the letterpress studio, not nothing.
  return kind(
    key, '📍',
    key.length > 2 ? [`name~"${key}",i`] : [],
    key.includes('class') || key.includes('workshop') ? key : `${key} class`,
    true,
  );
}

/** "Pottery & crafts" becomes "pottery class"; anything typed is searched as written. */
export function searchTermFor(interest: string): string {
  return kindFor(interest).yelp;
}

/** The quiz columns that say something about what to go and do. */
export interface Profile {
  favorite_activities?: string[] | null;
  cuisines?: string[] | null;
  music_genres?: string[] | null;
  nightlife_style?: string | null;
  drink_style?: string | null;
  no_way_jose?: string[] | null;
}

// Keyed on the words on the chips, which is what the quiz stores.
const NIGHT_OUT: Record<string, string> = {
  'a proper pub': 'pubs', 'something live': 'live music', 'dancing': 'nightclubs',
};
const DRINK: Record<string, string> = {
  'cocktails': 'cocktail bars', 'wine': 'wine tasting', 'beer': 'breweries', 'coffee, honestly': 'coffee',
};
const MUSIC: Record<string, string> = {
  'jazz & soul': 'jazz', 'classical': 'classical music',
};

/**
 * What a new person sees before they have told us anything. Things most
 * people would happily do on an ordinary evening, none of them a drink, so
 * nobody's first screen is a bar crawl.
 */
export const EVERYDAY = [
  'markets & food halls', 'live music', 'museums & history', 'art & galleries', 'comedy', 'cooking',
];

const MAX_PERSONAL = 10;
/**
 * Slots kept for food, whatever else somebody likes.
 *
 * Cuisines are added last on purpose — what you are into says more about a
 * Saturday than what you eat — but last plus a cap of ten means they were
 * cut first, and a profile with ten activities on it asked for no
 * restaurants at all. Ever. Not on one screen: the area then records what it
 * was asked for, the nightly sweep looks for exactly that, and a city's
 * cache fills up with galleries and no dinner.
 *
 * Measured on the owner's own profile — nine cuisines saved, thirteen
 * activities, and every cuisine dropped before the request was sent:
 *
 *   interests: cooking, pottery, live music, dancing, outdoors, comedy,
 *              breweries, wine tasting, museums, markets
 *   browse:    art & galleries
 *   restaurants: none
 *
 * Half of what this app does is dinner.
 */
const FOOD_SLOTS = 3;

const isFood = (key: string) => key.endsWith(' restaurants');

/**
 * Everything the quiz knows, as kinds of place to look for.
 *
 * `interests` is theirs, most telling first: what they said they are into,
 * then how their night ends and what they drink, then what they listen to,
 * then what they eat. `browse` is everyday things alongside — all of them for
 * somebody with no answers, and always a couple for somebody with plenty, so
 * a screen never becomes the same six things forever.
 */
export function tasteFrom(profile: Profile | null | undefined): { interests: string[]; browse: string[] } {
  const words = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
  const low = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

  const nos = words(profile?.no_way_jose).map(low);
  const sober = low(profile?.drink_style) === 'not drinking';
  const quiet = nos.includes('clubs') || nos.includes('loud rooms');
  const allowed = (k: Kind) =>
    k.osm.length + k.yelp.length > 0
    && !(sober && k.alcohol)
    && !(quiet && k.loud)
    && !nos.includes(k.key);

  const genres = words(profile?.music_genres);
  const wanted = [
    ...words(profile?.favorite_activities),
    NIGHT_OUT[low(profile?.nightlife_style)],
    DRINK[low(profile?.drink_style)],
    ...(genres.length ? ['live music'] : []),
    ...genres.map(g => MUSIC[low(g)]),
    // Three is plenty. Eight cuisines would be eight lanes of restaurants.
    ...words(profile?.cuisines).slice(0, 3).map(c => `${c} restaurants`),
  ].filter((w): w is string => !!w);

  const interests: string[] = [];
  for (const w of wanted) {
    const k = kindFor(w);
    if (k.key && allowed(k) && !interests.includes(k.key)) interests.push(k.key);
  }

  // Trimmed to the cap with food held back from the cut, rather than
  // trimmed off the end where the food happens to sit.
  const food = interests.filter(isFood).slice(0, FOOD_SLOTS);
  const rest = interests.filter(k => !isFood(k)).slice(0, Math.max(0, MAX_PERSONAL - food.length));
  const kept = [...rest, ...food];

  const room = Math.max(2, EVERYDAY.length - kept.length);
  const browse = EVERYDAY
    .filter(key => !kept.includes(key) && allowed(kindFor(key)))
    .slice(0, room);

  return { interests: kept, browse };
}
