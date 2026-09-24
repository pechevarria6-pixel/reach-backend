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

  private holds(e: Extract, lat: number, lng: number): boolean {
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
   * The smallest extract whose polygon holds it, with three corrections, all
   * seen on the first run of the world list:
   *   - where a point is in a country regions.ts already files a particular
   *     way (US states, the UK's nations, Mexico), that file wins, so a plan
   *     to Los Angeles and the world seed for it read one file, not
   *     California and Southern California for the same streets;
   *   - overlays that cut across countries (US Northeast, Alps, DACH) are
   *     used only where no country holds the point, and continents never;
   *   - a point inside a country Geofabrik splits but in none of its pieces
   *     (water, mostly) is not a reason to read the whole country.
   */
  regionAt(lat: number, lng: number): string | null {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
    const holders = this.extracts.filter(e => this.holds(e, lat, lng));
    const inCountry = holders.some(h => this.isCountry(h));
    const all = holders
      .filter(h => !this.isContinent(h) && !(inCountry && this.isOverlay(h)))
      .sort((a, b) => a.area - b.area);
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
  const home = map.regionAt(centre.lat, centre.lng);
  if (!home) return { regions: [], abroad: [] };
  // The file the town is in says which country it is in; the geocoder's
  // code is only a fallback, because it calls Hong Kong "cn".
  const cc = String(country || '').trim().toUpperCase();
  const own = map.countriesOf(home);
  const mine = new Set(own.length ? own : cc ? [cc] : []);
  const regions = [home];
  const abroad = new Set<string>();
  for (const p of probes) {
    const r = map.regionAt(p.lat, p.lng);
    if (!r || regions.includes(r)) continue;
    if (map.countriesOf(r).some(c => mine.has(c))) regions.push(r);
    else abroad.add(r);
  }
  return { regions: [home, ...regions.slice(1).sort()], abroad: [...abroad].sort() };
}

/**
 * For a feature read from `region`'s file, the file in another country that
 * owns its point, or null when the point is this file's (or nobody's).
 *
 * Geofabrik cuts each extract a little wide of the border, and not evenly:
 * Mexico's file reaches north over San Luis, Arizona and San Ysidro, while
 * Arizona's and California's stop at the line. The table has one row per
 * place, so whichever file was loaded last used to decide which country a
 * border venue was in — and a San Luis, AZ restaurant filed under Mexico is
 * dropped from a Yuma trip as "across the border".
 *
 * The owner is the file regionAt picks for the point (the smallest file that
 * holds it, the legacy files first), which is the same answer whichever file
 * is being read: the result no longer depends on the order of the loads.
 * Only an owner in a different country counts; two US states sharing a
 * sliver of each other are the same country either way.
 */
export function ownerAbroad(map: GeofabrikMap, region: string): (at: { lat: number; lng: number }) => string | null {
  const mine = new Set(map.countriesOf(region));
  if (!mine.size) return () => null;
  const self = map.extracts.find(e => e.path === region);
  // Only another country's file whose box meets this one's can own a point
  // in it; everything else is ruled out without a polygon test.
  const others = map.extracts.filter(e => {
    if (e.path === region) return false;
    const theirs = map.countriesOf(e.path);
    if (!theirs.length || theirs.some(c => mine.has(c))) return false;
    return !self || (e.box[0] <= self.box[2] && e.box[2] >= self.box[0] && e.box[1] <= self.box[3] && e.box[3] >= self.box[1]);
  });
  return (at) => {
    if (!others.some(e => at.lng >= e.box[0] && at.lng <= e.box[2] && at.lat >= e.box[1] && at.lat <= e.box[3])) return null;
    const owner = map.regionAt(at.lat, at.lng);
    if (!owner || owner === region) return null;
    const theirs = map.countriesOf(owner);
    return theirs.length && !theirs.some(c => mine.has(c)) ? owner : null;
  };
}
