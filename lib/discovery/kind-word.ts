// ─── What the map calls a place, in words a person would use ─────────────
// Discover's place cards read "marketplace · 1201 Agricultural Street" and
// "museum · …" — the map's own lowercase tag values (lib/discovery/osm.ts
// whatOf), shown as they are stored. Eighteen cards in Raleigh. It reads as
// unedited data because it is.
//
// The kind itself is a fact the row holds, so it stays; only the spelling
// changes. A value this table does not know is still shown, capitalised and
// with its underscores gone, rather than dropped: "ice rink" is true and
// "Ice rink" is how it is said.

const WORDS: Record<string, string> = {
  marketplace: 'Market',
  museum: 'Museum',
  gallery: 'Gallery',
  'arts centre': 'Arts centre',
  theatre: 'Theatre',
  cinema: 'Cinema',
  library: 'Library',
  books: 'Bookshop',
  'music venue': 'Music venue',
  nightclub: 'Nightclub',
  pub: 'Pub',
  bar: 'Bar',
  biergarten: 'Beer garden',
  restaurant: 'Restaurant',
  cafe: 'Café',
  'fast food': 'Fast food',
  wine: 'Wine shop',
  winery: 'Winery',
  brewery: 'Brewery',
  pottery: 'Pottery studio',
  ceramics: 'Ceramics studio',
  painter: 'Artist’s studio',
  'cooking school': 'Cooking school',
  'dancing school': 'Dance school',
  dance: 'Dance hall',
  sauna: 'Sauna',
  spa: 'Spa',
  herbalist: 'Herbalist',
  'fitness centre': 'Fitness studio',
  'sports centre': 'Sports centre',
  climbing: 'Climbing',
  games: 'Games shop',
  photo: 'Photo shop',
  photographer: 'Photographer',
  park: 'Park',
  garden: 'Garden',
  'nature reserve': 'Nature reserve',
  'wilderness hut': 'Wilderness hut',
  viewpoint: 'Viewpoint',
  beach: 'Beach',
  zoo: 'Zoo',
  memorial: 'Memorial',
  monument: 'Monument',
  hotel: 'Hotel',
  'guest house': 'Guest house',
  hostel: 'Hostel',
  motel: 'Motel',
  apartment: 'Apartment',
  attraction: 'Attraction',
};

/** "marketplace" → "Market"; "arts_centre" → "Arts centre"; nothing held → null. */
export function kindWord(kind: unknown): string | null {
  const k = String(kind ?? '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!k || k === 'place' || k === 'yes') return null;
  return WORDS[k] ?? k.charAt(0).toUpperCase() + k.slice(1);
}

/**
 * The source's line with its leading map tag respelled: "marketplace · 1201
 * Agricultural Street" → "Market · 1201 Agricultural Street". Anything that
 * does not start with the kind is returned as written.
 */
export function withKindWord(line: unknown, kind: unknown): string {
  const text = String(line ?? '');
  const raw = String(kind ?? '').trim();
  const word = kindWord(raw);
  if (!raw || !word) return text;
  const spaced = raw.replace(/_/g, ' ');
  for (const lead of [raw, spaced]) {
    if (text.toLowerCase().startsWith(lead.toLowerCase())) return word + text.slice(lead.length);
  }
  return text;
}
