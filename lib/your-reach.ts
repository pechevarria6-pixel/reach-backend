// ─── "Your Reach" (REACH-DESTINATION-DIVERSITY-2026-11-22, Part B) ───────
// A few numbers about somebody's own travel, every one counted from plans
// they hold and never estimated:
//   · trips taken — plans that were booked (or closed as completed) and are over;
//   · places — the distinct destinations among those;
//   · for each group, days since the last trip it took together.
// A group that has not taken one says so; nothing is guessed from the
// "when did you last see this group?" answer, which is a bucket somebody
// chose, not a date.
//
// No imports, so the screen and node's test runner both load it bare.

export interface ReachPlan {
  status?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  destinationCity?: string | null;
  destination?: string | null;
}
export interface ReachGroup { id: string; name: string; plans?: ReachPlan[] | null }

export interface YourReach {
  tripsTaken: number;
  places: number;
  groups: { id: string; name: string; daysSince: number | null }[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const days = (a: string, b: string) => {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
};

/** The day a plan ended, if it has ended by `today`; null otherwise. */
function endedOn(p: ReachPlan, today: string): string | null {
  if (p.status !== 'booked' && p.status !== 'completed') return null;
  const end = typeof p.endDate === 'string' && DAY.test(p.endDate) ? p.endDate
    : typeof p.startDate === 'string' && DAY.test(p.startDate) ? p.startDate : null;
  if (!end) return null;
  return days(end, today) > 0 ? end : null;
}

/** `today` is the local date (lib/calendar.ts today()), never a UTC one. */
export function yourReach(groups: ReachGroup[] | null | undefined, today: string): YourReach {
  if (!DAY.test(today)) return { tripsTaken: 0, places: 0, groups: [] };
  let trips = 0;
  const places = new Set<string>();
  const out: YourReach['groups'] = [];
  for (const g of groups ?? []) {
    let last: string | null = null;
    for (const p of g.plans ?? []) {
      const end = endedOn(p, today);
      if (!end) continue;
      trips++;
      const where = String(p.destinationCity || p.destination || '').split(',')[0].trim().toLowerCase();
      if (where) places.add(where);
      if (!last || end > last) last = end;
    }
    out.push({ id: g.id, name: g.name, daysSince: last ? days(last, today) : null });
  }
  out.sort((a, b) => (a.daysSince ?? Infinity) - (b.daysSince ?? Infinity) || a.name.localeCompare(b.name));
  return { tripsTaken: trips, places: places.size, groups: out };
}

/** "12 days", "1 day", "today" — never rounded into "a while". */
export function sinceWords(n: number | null): string {
  if (n == null) return 'No trip together yet';
  if (n <= 0) return 'Together today';
  return `${n} day${n === 1 ? '' : 's'} since your last trip`;
}
