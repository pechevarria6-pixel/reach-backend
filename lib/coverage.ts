// ─── Beta coverage: how much we hold around each tester's town ──────────
// A recommended trip needs twenty-odd checked places to name, and a tester
// in a thin town gets an empty screen — which reads as Reach being broken,
// not as us not having swept there yet. This counts, per town, what the
// generator could actually name: the rings are the ones the menu reads
// (lib/discovery/real-places.ts RINGS_MILES), and "checked" is the same rule
// the table is filled by — a name and its own website (lib/discovery/
// ingest.ts), not a place to stay, and not marked gone.
//
// Pure, so it can be tested on a fixture; scripts/coverage.mjs reads the
// rows and prints this. A report, never a gate.
import { haversineMiles, type Point } from './discovery/distance.ts';

export const RINGS = [2, 5, 12, 25] as const;
export const PASS_AT = 20;
export const EVENT_DAYS = 14;
const STAY_INTEREST = 'places to stay';

export interface VenueRow {
  lat: unknown; lng: unknown; name?: unknown; website?: unknown; interest?: unknown; gone_at?: unknown;
}
export interface EventRow {
  lat?: unknown; lng?: unknown; starts_on?: unknown; stale_after?: unknown;
  discovery_venues?: { lat?: unknown; lng?: unknown } | { lat?: unknown; lng?: unknown }[] | null;
}

export interface TownCoverage {
  town: string;
  /** Checked venues within each ring, nearest ring first. */
  venues: Record<(typeof RINGS)[number], number>;
  /** Dated events from today through the next EVENT_DAYS days, within 25 miles. */
  events: number;
  verdict: 'PASS' | 'THIN';
}

function point(lat: unknown, lng: unknown): Point | null {
  // Number(null) is 0, and 0 is finite: a missing coordinate is not Null Island.
  if (lat == null || lng == null || lat === '' || lng === '') return null;
  const p = { lat: Number(lat), lng: Number(lng) };
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) ? p : null;
}

export function isChecked(v: VenueRow): boolean {
  return !!String(v.name ?? '').trim()
    && /^https?:\/\//i.test(String(v.website ?? '').trim())
    && v.interest !== STAY_INTEREST
    && (v.gone_at == null || v.gone_at === '');
}

/** "YYYY-MM-DD" plus n days, as calendar days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function countCoverage(
  town: string,
  at: Point,
  venues: VenueRow[],
  events: EventRow[],
  opts: { today: string; now?: string },
): TownCoverage {
  const counts = Object.fromEntries(RINGS.map(r => [r, 0])) as TownCoverage['venues'];
  for (const v of venues) {
    if (!isChecked(v)) continue;
    const p = point(v.lat, v.lng);
    if (!p) continue;
    const miles = haversineMiles(at, p);
    for (const r of RINGS) if (miles <= r) counts[r]++;
  }

  const last = addDays(opts.today, EVENT_DAYS);
  const now = opts.now ?? new Date().toISOString();
  const outer = RINGS[RINGS.length - 1];
  let upcoming = 0;
  for (const e of events) {
    // Undated (weekly, "every Friday") rows are left out: nothing says they
    // fall in the next fortnight, and this is a count of what we know.
    const on = String(e.starts_on ?? '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(on)) continue;
    const day = on.slice(0, 10);
    if (day < opts.today || day > last) continue;
    if (e.stale_after && String(e.stale_after) <= now) continue;
    const venue = Array.isArray(e.discovery_venues) ? e.discovery_venues[0] : e.discovery_venues;
    const p = point(e.lat, e.lng) ?? point(venue?.lat, venue?.lng);
    if (!p || haversineMiles(at, p) > outer) continue;
    upcoming++;
  }

  return { town, venues: counts, events: upcoming, verdict: counts[outer] >= PASS_AT ? 'PASS' : 'THIN' };
}

/** One town per line; blank lines and # comments ignored. */
export function parseTowns(text: string): string[] {
  return text.split('\n').map(l => l.replace(/#.*$/, '').trim()).filter(Boolean);
}

/** The box a radius needs, in degrees, for the database read. */
export function boxAround(at: Point, miles: number): { dLat: number; dLng: number } {
  return { dLat: miles / 69, dLng: miles / (69 * Math.max(0.1, Math.cos((at.lat * Math.PI) / 180))) };
}

export function formatTable(rows: Array<TownCoverage | { town: string; error: string }>): string {
  const head = ['Town', '≤2 mi', '≤5 mi', '≤12 mi', '≤25 mi', `Events ${EVENT_DAYS}d`, 'Result'];
  const body = rows.map(r => 'error' in r
    ? [r.town, '-', '-', '-', '-', '-', r.error]
    : [r.town, ...RINGS.map(k => String(r.venues[k])), String(r.events), r.verdict]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map(b => b[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  return [line(head), widths.map(w => '─'.repeat(w)).join('  '), ...body.map(line)].join('\n');
}
