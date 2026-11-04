// ─── Learning how each restaurant takes a booking ───────────────────────
// On 2026-11-04 Reach knew how 60 of 229,253 restaurants take a booking.
// The platforms cron had been running daily since September, and three
// things held it there:
//
//   • Nothing recorded that a restaurant had been read. A page that settled
//     nothing left the row exactly as it was, the query had no order, and so
//     the same unsettled rows could come round every night — the first twelve
//     it returns today are Los Feliz, Ai, The Lobster Club… none settled.
//   • It asked for `interest ilike '%restaurant%'`, and 176k restaurants are
//     filed under "places to eat". It never saw them.
//   • It read no robots.txt, which the harvester has always honoured.
//
// This is the part that decides, kept apart from the route so it can be
// tested without a network: the map's own tags first (no fetch at all), then
// the restaurant's own site — read only where robots.txt allows, with the
// harvester's User-Agent, timeout and back-off — and only a settled answer
// is stored as one.
import type { ReservationFinding } from '../booking/reservations.ts';
import { resolveReservation, isCertain, FIRST_PLATFORMS } from '../booking/reservations.ts';
import { reservationFromOsm, type OsmVenue } from '../booking/osm-reservation.ts';
import { RETRY_DAYS } from './harvest-queue.ts';
import { dialable } from './phone.ts';

/** What happened when Reach went to look. Stored as `reservation_check`. */
export type CheckOutcome = 'settled' | 'nothing_found' | 'blocked' | 'unreachable';

/**
 * How long a restaurant is left after each outcome, in days: the harvester's
 * own back-off (lib/discovery/harvest-queue.ts), so a site is asked no more
 * often by this than by that. A settled restaurant is not asked again here.
 */
export const RESERVATION_RETRY_DAYS: Record<Exclude<CheckOutcome, 'settled'>, number> = {
  nothing_found: RETRY_DAYS.nothing_found,
  blocked: RETRY_DAYS.blocked,
  unreachable: RETRY_DAYS.unreachable,
};

export interface CrawlVenue extends OsmVenue {
  id: string;
  name?: string | null;
  website?: string | null;
}

export interface Settlement {
  outcome: CheckOutcome;
  finding: ReservationFinding | null;
  /** Where the answer came from: the map entry, or the restaurant's own page. */
  source: 'osm' | 'site' | null;
  /** True when no page was fetched to reach this answer. */
  fetched: boolean;
}

export interface CrawlDeps {
  /** robots.txt, as the harvester reads it. */
  allowed: (url: string) => Promise<boolean>;
  /** One page, as the harvester reads it. */
  read: (url: string) => Promise<string | null>;
}

/**
 * Settle one restaurant if anything we may read settles it.
 *
 * The map is asked first because it costs nothing and is the same source
 * the venue came from. The site is read second, and its robots.txt is asked
 * for every page — the booking page it links to as well as the front page.
 */
export async function settleVenue(venue: CrawlVenue, deps: CrawlDeps, opts: { fetch?: boolean } = {}): Promise<Settlement> {
  const fromMap = reservationFromOsm(venue);
  if (fromMap) return { outcome: 'settled', finding: fromMap, source: 'osm', fetched: false };

  const website = String(venue.website ?? '').trim();
  if (!/^https?:\/\//i.test(website) || opts.fetch === false) {
    return { outcome: 'nothing_found', finding: null, source: null, fetched: false };
  }
  if (!(await deps.allowed(website))) return { outcome: 'blocked', finding: null, source: null, fetched: false };

  let homeRead = false;
  const read = async (url: string): Promise<string | null> => {
    if (url !== website && !(await deps.allowed(url))) return null;
    const page = await deps.read(url);
    if (url === website && page) homeRead = true;
    return page;
  };
  const finding = await resolveReservation(website, read, venue.name);
  if (!homeRead) return { outcome: 'unreachable', finding: null, source: null, fetched: true };
  if (!isCertain(finding)) return { outcome: 'nothing_found', finding, source: null, fetched: true };
  return { outcome: 'settled', finding, source: 'site', fetched: true };
}

/**
 * The row update for a settlement.
 *
 * `migrated` is whether sql/reservation-coverage-2026-11-04.sql has run.
 * Before it, there is nowhere to record a look that settled nothing, and the
 * database refuses SevenRooms, Yelp and TheFork — so a restaurant on one of
 * those is left unsettled rather than filed under a platform it is not on.
 * Returns null when there is nothing honest to write.
 */
export function rowUpdate(
  venue: CrawlVenue,
  s: Settlement,
  migrated: boolean,
  now = new Date(),
): Record<string, string | null> | null {
  const out: Record<string, string | null> = {};
  const settle = s.outcome === 'settled' && !!s.finding
    && (migrated || FIRST_PLATFORMS.has(s.finding.platform));
  if (settle && s.finding) {
    out.reservation_platform = s.finding.platform;
    out.reservation_method = s.finding.method;
    out.reservation_url = s.finding.url;
    if (migrated) out.reservation_source = s.source;
  }
  // A number is a fact even when the method is not, but one we already hold
  // is not replaced by a page's — and only a number somebody can dial is
  // kept (lib/discovery/phone.ts). The old cron stored "9102451105".
  const phone = dialable(s.finding?.phone, venue.countries?.[0] ?? null);
  if (phone && !venue.phone) out.phone = phone;
  if (migrated) {
    out.reservation_checked_at = now.toISOString();
    out.reservation_check = settle ? 'settled' : s.outcome === 'settled' ? 'nothing_found' : s.outcome;
  }
  return Object.keys(out).length ? out : null;
}

/** Whether a settlement is waiting on the migration to be stored. */
export function awaitingMigration(s: Settlement, migrated: boolean): boolean {
  return !migrated && s.outcome === 'settled' && !!s.finding && !FIRST_PLATFORMS.has(s.finding.platform);
}

/**
 * The PostgREST or() for restaurants past their own back-off. Never-checked
 * rows are asked for separately, so a night of re-checks cannot crowd out
 * restaurants nobody has looked at.
 */
export function reservationDueFilter(now = Date.now()): string {
  const before = (days: number) => new Date(now - days * 86400_000).toISOString();
  return Object.entries(RESERVATION_RETRY_DAYS)
    .map(([outcome, days]) => `and(reservation_check.eq.${outcome},reservation_checked_at.lt.${before(days)})`)
    .join(',');
}

/**
 * Tonight's restaurants, one per site. Chains share a website and duplicate
 * rows share everything (Tonkatsu Kuro is held twice), so the site is read
 * once and the answer written to every row that names it. A second website
 * on the same host waits for another night: nobody's server gets more than
 * one restaurant's worth of reads from one run.
 */
export function onePerSite<T extends CrawlVenue>(venues: T[], perRun: number): Array<{ website: string; rows: T[] }> {
  const byWebsite = new Map<string, T[]>();
  const hosts = new Set<string>();
  const out: Array<{ website: string; rows: T[] }> = [];
  for (const v of venues) {
    const website = String(v.website ?? '').trim();
    if (!website) continue;
    const known = byWebsite.get(website);
    if (known) { known.push(v); continue; }
    let host: string;
    try { host = new URL(website).hostname.toLowerCase(); } catch { continue; }
    if (hosts.has(host) || out.length >= perRun) continue;
    hosts.add(host);
    const rows = [v];
    byWebsite.set(website, rows);
    out.push({ website, rows });
  }
  return out;
}

/** Run `work` over `items`, `width` at a time, stopping new work at `deadline`. */
export async function inPool<T>(items: T[], width: number, deadline: number, work: (item: T) => Promise<void>): Promise<number> {
  let next = 0;
  let done = 0;
  const lane = async () => {
    while (next < items.length && Date.now() < deadline) {
      const item = items[next++];
      await work(item);
      done += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(width, items.length)) }, lane));
  return done;
}
