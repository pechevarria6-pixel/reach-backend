// ─── Which venues the harvester reads tonight ────────────────────────────
// Twenty venues a night, and two kinds of venue competing for them: ones we
// have read before and are due to read again, and ones we have never read.
//
// They were one queue, never-read first. That was fine while the sweep added
// a handful of places a night. The weekly map load adds thousands at once,
// every one of them never read, and all of them went ahead of the venues
// whose listings are on screens today. Listings go stale after four weeks
// (stale_after), so within a month of the first load the classes Raleigh
// shows now would have quietly expired while the harvester worked through
// studios nobody had asked about yet.
//
// So each kind gets a fixed share of the night, and a share one kind cannot
// use goes to the other. Re-reads are read first, so a run cut short by the
// time limit still keeps what people can already see.

/** How long a reading stands before we go back. */
export const FRESH_DAYS = 14;

/**
 * How long to leave a site after each outcome. A site that cannot be
 * rendered will not render next week either; come back eventually in case
 * they move off Wix, but not tomorrow.
 */
export const RETRY_DAYS: Record<string, number> = {
  ok: FRESH_DAYS, nothing_found: 21, needs_render: 45, blocked: 90, unreachable: 7,
};

export interface QueuedVenue {
  interest: string;
  last_harvested_at: string | null;
  harvest_status: string | null;
}

/**
 * Whether a venue should be read now: a kind worth reading, and past its own
 * back-off. Honouring the back-off is what keeps us welcome.
 */
export function readyToRead(v: QueuedVenue, harvestable: (interest: string) => boolean, now = Date.now()): boolean {
  if (!harvestable(v.interest)) return false;
  if (!v.last_harvested_at) return true;
  const wait = RETRY_DAYS[v.harvest_status ?? 'unreachable'] ?? FRESH_DAYS;
  return now - new Date(v.last_harvested_at).getTime() > wait * 86400_000;
}

/**
 * The PostgREST or() that asks for venues past their own back-off, so the
 * window of rows read is rows that can be read tonight. Ordered oldest
 * first, a queue filtered only on "older than a fortnight" put the sites
 * that blocked us a month ago (back in ninety days) ahead of every studio
 * due its fortnightly re-read, and a sixty-row window of them read nothing.
 * Never a venue marked skip; a status this table does not know waits the
 * fortnight, as readyToRead has it.
 */
export function dueFilter(now = Date.now()): string {
  const before = (days: number) => new Date(now - days * 86400_000).toISOString();
  const known = Object.keys(RETRY_DAYS);
  return [
    ...Object.entries(RETRY_DAYS).map(([status, days]) =>
      `and(harvest_status.eq.${status},last_harvested_at.lt.${before(Math.max(days, FRESH_DAYS))})`),
    `and(harvest_status.is.null,last_harvested_at.lt.${before(FRESH_DAYS)})`,
    `and(harvest_status.not.in.(${[...known, 'skip'].join(',')}),last_harvested_at.lt.${before(FRESH_DAYS)})`,
  ].join(',');
}

/**
 * Tonight's venues: up to half re-reads, the rest never read, and whatever
 * one side cannot fill given to the other. Re-reads first.
 */
export function harvestQueue<T extends QueuedVenue>(
  due: T[],
  fresh: T[],
  perRun: number,
  harvestable: (interest: string) => boolean,
  now = Date.now(),
): T[] {
  const again = due.filter(v => v.last_harvested_at && readyToRead(v, harvestable, now));
  const first = fresh.filter(v => !v.last_harvested_at && readyToRead(v, harvestable, now));
  const half = Math.ceil(perRun / 2);
  const takeAgain = Math.min(again.length, Math.max(half, perRun - first.length));
  const takeFirst = Math.min(first.length, perRun - takeAgain);
  return [...again.slice(0, takeAgain), ...first.slice(0, takeFirst)];
}
