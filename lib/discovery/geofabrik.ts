// ─── Geofabrik's own index: which file holds a point ─────────────────────
// Geofabrik publishes https://download.geofabrik.de/index-v1.json, which
// carries every extract's polygon and download URL. Asking it "which file
// holds this point?" costs nothing and needs nobody's permission, where
// asking Nominatim the same question cost thirteen requests a town and got
// this Mac refused with a 429 after three runs (15 of 42 seeds stored).
//
// So a seed is geocoded once, for its centre, and every question after that
// — which file holds the centre, which files its circle reaches — is
// answered here, from the polygons.
//
// Pure functions over the index as data, so the tests can hand it a few
// squares instead of a four-megabyte download. Used by
// scripts/ingest/world-regions.mjs (which writes the generated tables) and
// scripts/ingest/build-seeds.mjs (which places the seeds every day).

import { callingCountries } from './phone.ts';

type Ring = number[][];
type Polygon = Ring[];

export interface GeofabrikIndex {
  features: Array<{
    properties: {
      id: string;
      parent?: string;
      name?: string;
      'iso3166-1:alpha2'?: string[];
      'iso3166-2'?: string[];
      urls?: { pbf?: string };
    };
    geometry: { type: string; coordinates: any } | null;
  }>;
}

export interface Extract {
  id: string;
  /** The download path: "north-america/us/north-carolina". */
  path: string;
  polys: Polygon[];
  box: [number, number, number, number];
  area: number;
  /** The index's own ISO codes for this file, when it gives any. */
  iso: string[];
}

const BASE = 'https://download.geofabrik.de/';

/**
 * Files that are never read, whatever a circle grazes. Seoul's thirty miles
 * cross the DMZ; nothing on the far side can be visited, and a venue there
 * must never reach a Seoul itinerary.
 */
export const NEVER = new Set(['asia/north-korea']);

/**
 * A file's countries where the index is silent or incomplete.
 *
 * Hong Kong and Macau are filed under China but are entered separately; the
 * Malaysia file also holds Singapore and Brunei; the GCC file holds Saudi
 * Arabia although its codes leave it out; the Ireland file holds Northern
 * Ireland although its codes say only IE.
 */
export const COUNTRY_OF: Readonly<Record<string, readonly string[]>> = {
  'asia/china/hong-kong': ['HK'],
  'asia/china/macau': ['MO'],
  'asia/malaysia-singapore-brunei': ['MY', 'SG', 'BN'],
  'asia/gcc-states': ['SA', 'QA', 'AE', 'OM', 'BH', 'KW'],
  'europe/ireland-and-northern-ireland': ['IE', 'GB'],
  // The index gives these Vanuatu's code (VU), or the Marshall Islands'
  // (MH) for Pitcairn: a copy-paste in Geofabrik's own data, seen on
  // 2026-09-24. Trusted, it filed every venue in Tahiti as Vanuatu's and a
  // Papeete trip lost all of them to the border check. The codes here are
  // ISO 3166-1's own; what Nominatim calls them is in GEOCODER_ALSO.
  'australia-oceania/polynesie-francaise': ['PF'],
  'australia-oceania/wallis-et-futuna': ['WF'],
  'australia-oceania/ile-de-clipperton': ['FR'],
  'australia-oceania/american-oceania': ['AS', 'GU', 'MP', 'UM'],
  'australia-oceania/tokelau': ['TK'],
  'australia-oceania/pitcairn-islands': ['PN'],
};

/**
 * The other country codes the geocoder gives places in a file, which is what
 * the itinerary menu compares against. Checked against Nominatim on
 * 2026-09-24: Hong Kong and Macau answer country_code "cn", and San Juan
 * answers "us" with subdivision "US-PR". Without these, a Hong Kong
 * itinerary would have had every one of Hong Kong's own venues filtered away
 * as foreign.
 */
export const GEOCODER_ALSO: Readonly<Record<string, readonly string[]>> = {
  'asia/china/hong-kong': ['CN'],
  'asia/china/macau': ['CN'],
  'north-america/us/puerto-rico': ['US'],
  'north-america/us/us-virgin-islands': ['US'],
  // Also checked on 2026-09-24: Papeete, Mata-Utu, Cayenne and Clipperton
  // answer "fr"; Hagåtña, Pago Pago, Saipan and Wake Island answer "us".
  // (Fakaofo answers "tk" and Adamstown "pn", their own codes above.)
  'australia-oceania/polynesie-francaise': ['FR'],
  'australia-oceania/wallis-et-futuna': ['FR'],
  'europe/france/guyane': ['FR'],
  'australia-oceania/american-oceania': ['US'],
};

const pathOf = (pbf: string) => String(pbf || '').replace(BASE, '').replace(/-latest\.osm\.pbf$/, '');

function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
}

function inRing(ring: Ring, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const polygonsOf = (g: { type: string; coordinates: any } | null): Polygon[] =>
  g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];

/**
 * Everything the index offers as a download, with what the lookups need.
 *
 * Nesting is read from the download paths, not the index's `parent` field:
 * Geofabrik files New York's parent as "north-america", beside the whole-US
 * file, although its path says it is a piece of it.
 */
export class GeofabrikMap {
  readonly extracts: Extract[];
  private byPath: Map<string, Extract>;
  private legacy: Set<string>;

  constructor(index: GeofabrikIndex, legacy: Iterable<string> = []) {
    this.extracts = index.features
      .filter(f => f.properties?.urls?.pbf && f.geometry)
      .map(f => {
        const polys = polygonsOf(f.geometry);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of polys) for (const [x, y] of p[0]) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
        const area = polys.reduce((s, p) => s + ringArea(p[0]) - p.slice(1).reduce((h, r) => h + ringArea(r), 0), 0);
        const iso = [...(f.properties['iso3166-1:alpha2'] ?? [])].map(c => String(c).toUpperCase());
        return { id: f.properties.id, path: pathOf(f.properties.urls!.pbf!), polys, box: [minX, minY, maxX, maxY] as Extract['box'], area, iso };
      });
    this.byPath = new Map(this.extracts.map(e => [e.path, e]));
    this.legacy = new Set(legacy);
  }

  has(path: string): boolean { return this.byPath.has(path); }

  holds(e: Extract, lat: number, lng: number): boolean {
    return lng >= e.box[0] && lng <= e.box[2] && lat >= e.box[1] && lat <= e.box[3]
      && e.polys.some(p => inRing(p[0], lng, lat) && !p.slice(1).some(h => inRing(h, lng, lat)));
  }

  private within(inner: Extract, outer: Extract): boolean { return inner.path.startsWith(`${outer.path}/`); }
  private hasPieces(e: Extract): boolean { return this.extracts.some(x => this.within(x, e)); }
  private isCountry(e: Extract): boolean { return e.iso.length > 0; }
  /** A continent: a top-level file that is not a country (Russia is both). */
  private isContinent(e: Extract): boolean { return !e.path.includes('/') && !this.isCountry(e); }
  /** Not a country and not a piece of one: US Northeast, Alps, DACH. */
  private isOverlay(e: Extract): boolean {
    return !this.isCountry(e) && !this.extracts.some(k => this.isCountry(k) && this.within(e, k));
  }

  /**
   * A file's countries: COUNTRY_OF where it says, else the file's own ISO
   * codes, else its nearest ancestor's.
   */
  countriesOf(path: string): string[] {
    for (let p = path; p; p = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '') {
      if (COUNTRY_OF[p]) return [...COUNTRY_OF[p]];
      const e = this.byPath.get(p);
      if (e?.iso.length) return [...e.iso];
    }
    return [];
  }

  /**
   * The codes the geocoder may give a place in this file: its countries,
   * and GEOCODER_ALSO's for it or its nearest ancestor that has any (Hong
   * Kong is "cn" to Nominatim, San Juan "us").
   */
  geocoderCodes(path: string): string[] {
    const also: string[] = [];
    for (let p = path; p; p = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '') {
      if (GEOCODER_ALSO[p]) { also.push(...GEOCODER_ALSO[p]); break; }
    }
    return [...new Set([...this.countriesOf(path), ...also])];
  }

  /**
   * A file that belongs to a country: not a continent, not an overlay (US
   * Northeast, DACH), with a country to its name. The files whose polygons
   * can say "this point may be in country X".
   */
  isCountryFile(e: Extract): boolean {
    return !this.isContinent(e) && !this.isOverlay(e) && this.countriesOf(e.path).length > 0;
  }

  /**
   * Country codes the index gives to two files that are not one inside the
   * other, where COUNTRY_OF does not settle which is right. Two countries do
   * not share an ISO code, so each of these is a mistake in the index until
   * somebody checks: the generator refuses to write while any is open,
   * because a wrong code here drops a whole territory's venues as foreign.
   */
  sharedCodes(): Array<{ code: string; paths: string[] }> {
    const by = new Map<string, Extract[]>();
    for (const e of this.extracts) {
      if (COUNTRY_OF[e.path]) continue;
      for (const c of e.iso) by.set(c, [...(by.get(c) ?? []), e]);
    }
    const out: Array<{ code: string; paths: string[] }> = [];
    for (const [code, files] of by) {
      const apart = files.filter(f => !files.some(g => g !== f && (this.within(f, g) || this.within(g, f))));
      if (apart.length > 1) out.push({ code, paths: apart.map(f => f.path).sort() });
    }
    return out.sort((a, b) => a.code.localeCompare(b.code));
  }

  /**
   * The file for one point, or null when the point is in no file worth
   * reading.
   *
   * The smallest extract whose polygon holds it — of the files of
   * `country`, when that is given — with three corrections, all seen on the
   * first run of the world list:
   *   - where a point is in a country regions.ts already files a particular
   *     way (US states, the UK's nations, Mexico), that file wins, so a plan
   *     to Los Angeles and the world seed for it read one file, not
   *     California and Southern California for the same streets;
   *   - overlays that cut across countries (US Northeast, Alps, DACH) are
   *     used only where no country holds the point, and continents never;
   *   - a point inside a country Geofabrik splits but in none of its pieces
   *     (water, mostly) is not a reason to read the whole country.
   */
  regionAt(lat: number, lng: number, country?: string | null): string | null {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
    const holders = this.extracts.filter(e => this.holds(e, lat, lng));
    const inCountry = holders.some(h => this.isCountry(h));
    let all = holders
      .filter(h => !this.isContinent(h) && !(inCountry && this.isOverlay(h)))
      .sort((a, b) => a.area - b.area);
    // Geofabrik cuts every polygon wide of the border, so near one the
    // smallest file is often the neighbour's: central Frankfurt (Oder) is
    // inside Poland's Lubuskie, Zgorzelec inside Saxony. When the geocoder
    // has said which country the point is in, only that country's files are
    // candidates; the polygons alone cannot tell which side of the line a
    // point in the overlap is on.
    const cc = String(country || '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(cc)) {
      const own = all.filter(h => this.isCountryFile(h) && this.geocoderCodes(h.path).includes(cc));
      if (own.length) all = own;
    }
    if (!all.length) return null;
    const smallest = all[0];
    if (this.isCountry(smallest) && this.hasPieces(smallest)) return null;
    // Only an overlay holds it: open water between states. Reading US
    // Northeast's 1.8 GB for a probe point in the Atlantic would load every
    // state in it a second time.
    if (this.isOverlay(smallest)) return null;
    for (let path = smallest.path; path.includes('/'); path = path.slice(0, path.lastIndexOf('/'))) {
      if (this.legacy.has(path) && this.byPath.has(path)) return path;
    }
    return NEVER.has(smallest.path) ? null : smallest.path;
  }

  /**
   * Every path regionAt could ever answer with, which is every path the load
   * may be asked to read: the files it would pick for some point, never a
   * continent, an overlay, a split country or a closed border.
   */
  loadable(): string[] {
    const out = new Set<string>();
    for (const e of this.extracts) {
      if (NEVER.has(e.path) || this.isContinent(e) || this.isOverlay(e)) continue;
      if (this.hasPieces(e) && !this.legacy.has(e.path)) continue;
      // A piece of a file regions.ts reads whole (Southern California inside
      // California) is never picked: the walk up finds the legacy file first.
      let shadowed = false;
      for (let p = e.path; p.includes('/'); ) {
        p = p.slice(0, p.lastIndexOf('/'));
        if (this.legacy.has(p)) { shadowed = true; break; }
      }
      if (!shadowed) out.add(e.path);
    }
    return [...out].sort();
  }
}

/**
 * The files a town's circle reaches: its centre's file, then every probe
 * point's file that is in the same country.
 *
 * A circle drawn by distance does not know where a border is. Petra's thirty
 * miles reach the Israeli Arava, where the Wadi Araba crossing is closed;
 * San Diego's reach Tijuana. The load reads whole files and the menu reads
 * by distance, so a file read for a town is a file whose venues can be named
 * as "nearby" — and a file across a border is never read on a town's word.
 *
 * The centre file's countries are the town's; `country` (the geocoder's
 * code) stands in only where the index gives the file none.
 */
export function regionsForTown(
  map: GeofabrikMap,
  centre: { lat: number; lng: number },
  probes: Array<{ lat: number; lng: number }>,
  country?: string | null,
): { regions: string[]; abroad: string[] } {
  // The geocoder's country picks among the files that hold the centre, so a
  // town in the strip where two countries' polygons overlap is seeded in its
  // own country's file (Frankfurt (Oder) in Brandenburg, not Lubuskie).
  const home = map.regionAt(centre.lat, centre.lng, country);
  if (!home) return { regions: [], abroad: [] };
  // The file the town is in says which country it is in; the geocoder's
  // code is only a fallback, because it calls Hong Kong "cn".
  const cc = String(country || '').trim().toUpperCase();
  const own = map.countriesOf(home);
  const mine = new Set(own.length ? own : cc ? [cc] : []);
  const regions = [home];
  const abroad = new Set<string>();
  for (const p of probes) {
    const r = map.regionAt(p.lat, p.lng, country);
    if (!r || regions.includes(r)) continue;
    if (map.countriesOf(r).some(c => mine.has(c))) regions.push(r);
    else abroad.add(r);
  }
  return { regions: [home, ...regions.slice(1).sort()], abroad: [...abroad].sort() };
}

/**
 * For a feature read from `region`'s file, the countries it may be in: one
 * when anything says which, every candidate when nothing does.
 *
 * Geofabrik cuts each extract wide of the border, and not evenly. Mexico's
 * file reaches north over San Luis, Arizona; Poland's Lubuskie covers the
 * whole of central Frankfurt (Oder), and Saxony covers Zgorzelec. No rule
 * over the polygons alone can say which side of the line a point in that
 * overlap is on — "the smallest file that holds it" put Frankfurt's town hall
 * in Poland, and "the file read last" put San Luis, AZ in Mexico depending
 * on the day. So the polygons only say where there is a question:
 *
 *   - a point no other country's file holds is this file's countries' (the
 *     answer for all but a strip a few miles wide along each border);
 *   - in the overlap, the feature's own addr:country, when it is one of the
 *     candidates, settles it;
 *   - failing that, its number written in full (+49…, +48…) settles it, when
 *     the code belongs to one candidate file's countries only;
 *   - failing that, every candidate. The row says "one of these", the
 *     border check keeps it for a trip to any of them, and nothing claims a
 *     country the map does not state.
 *
 * The answer is the same whichever file the feature is read from, so it no
 * longer matters which file is loaded last, and every file that holds the
 * point writes it: none depends on another country's load having run.
 */
export function countriesAt(
  map: GeofabrikMap,
  region: string,
): (at: { lat: number; lng: number }, tags?: Record<string, unknown>) => string[] {
  const mine = map.countriesOf(region);
  const self = map.extracts.find(e => e.path === region);
  // Only another country's file whose box meets this one's can hold a point
  // in it; everything else is ruled out without a polygon test.
  const meets = (e: Extract) => !self || (e.box[0] <= self.box[2] && e.box[2] >= self.box[0] && e.box[1] <= self.box[3] && e.box[3] >= self.box[1]);
  const others = map.extracts.filter(e => {
    if (e.path === region || !map.isCountryFile(e)) return false;
    const theirs = map.countriesOf(e.path);
    if (theirs.every(c => mine.includes(c))) return false;
    return meets(e);
  });
  // This file's own country's other files (the US beside California).
  const kin = map.extracts.filter(e => e.path !== region && map.isCountryFile(e)
    && map.countriesOf(e.path).every(c => mine.includes(c)) && meets(e));
  return (at, tags = {}) => {
    const near = others.filter(e => map.holds(e, at.lat, at.lng));
    if (!near.length || !mine.length) return [...mine];
    // This country is a candidate only where one of its files' polygons
    // holds the point. An extract carries a few features past its polygon
    // (a way that crosses it), and without this a Tijuana taqueria read from
    // California's file would be "MX or US" while Mexico's own file calls it
    // "MX": the answer would depend on which file wrote the row last. With
    // it, the candidates are the countries of every country file that holds
    // the point, whichever file is reading.
    const mineHolds = !self || map.holds(self, at.lat, at.lng) || kin.some(e => map.holds(e, at.lat, at.lng));
    // Each file's countries are one candidate: the Senegal-and-Gambia file
    // is "SN or GM", and a number cannot split what the file does not.
    const groups = [...(mineHolds ? [mine] : []), ...near.map(e => map.countriesOf(e.path))];
    const all = [...new Set(groups.flat())].sort();
    const stated = String(tags['addr:country'] ?? tags['is_in:country_code'] ?? '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(stated) && all.includes(stated)) return [stated];
    const dialled = callingCountries(tags.phone ?? tags['contact:phone'], all);
    if (dialled.length) {
      const side = [...new Set(groups.filter(g => g.some(c => dialled.includes(c))).flat())].sort();
      if (side.length < all.length) return side;
    }
    return all;
  };
}
