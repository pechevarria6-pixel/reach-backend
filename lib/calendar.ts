// ─── A group's plans, in the order they happen ───────────────────────────
// A list of plans in whatever order the server returned them is not a
// calendar. What somebody wants to know when they open a group is what is
// next, and after that what else is coming.
//
// Three groups, in this order:
//   Coming up — soonest first, because the nearest thing is the one being
//               decided, paid for or packed for.
//   No date yet — a plan somebody added by hand and never dated. It cannot be
//               sorted with the rest without inventing a date for it, and an
//               invented date would quietly put it in the wrong place.
//   Been and gone — most recent first, because last weekend matters more than
//               last year.
//
// Pure, so the rule can be tested without a browser.

export type DatedPlan = { id?: string; startDate?: unknown; endDate?: unknown };
export type PlanSection<T> = { key: 'upcoming' | 'undated' | 'past'; label: string; plans: T[] };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// The column is a DATE, but anything that ever hands back a timestamp
// ("2026-09-20T00:00:00+00:00") would otherwise fail the pattern and every
// plan would silently become undated — and vanish from the calendar. The day
// is the first ten characters either way.
const dayPart = (v: unknown): string | null =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T|$)/.test(v) ? v.slice(0, 10) : null;

/**
 * Today, as the person's own calendar has it.
 *
 * `new Date().toISOString().slice(0, 10)` is the day in Greenwich, and for
 * everybody west of it that is already tomorrow for the last hours of the
 * evening. In New York at eight o'clock the UTC date has turned over while the
 * person is still on the sixteenth — so tonight's plan sorted into "Been and
 * gone" and tomorrow's started reading "Today", at precisely the hour somebody
 * is putting their coat on to go to it.
 *
 * `now` is a parameter so the rule can be tested at an hour the test does not
 * have to wait for.
 */
export function today(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * A plan's own day, or null when nobody ever gave it one.
 *
 * The shape is not enough: "2026-13-45" matches the pattern and is not a date.
 * Parsing it and checking it comes back as the same day is what separates a
 * real date from a plausible one — and a plausible one would sort into
 * "Coming up" at a position no real date occupies.
 */
export function planDay(plan: DatedPlan): string | null {
  const v = dayPart(plan?.startDate);
  if (!v) return null;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v ? v : null;
}

/**
 * The calendar day at a given longitude.
 *
 * A server keeps UTC, and somebody looking for something to do tonight is not
 * in Greenwich. At eight in the evening in New York the UTC date has already
 * turned over, so filtering "what is still to come" against it threw away
 * tonight's events — the ones they opened Discover to find, at the hour they
 * opened it to find them.
 *
 * Longitude is not a timezone. Political boundaries wander and a few places
 * sit hours off their solar time, so this is an approximation — but it only
 * has to decide which of two days it is, and it is the one clue a request
 * actually carries. The error it can make is a few hours at a zone's edge;
 * the error it replaces was a whole day, every evening, for half the world.
 */
export function dayWhere(lng: unknown, now: Date = new Date()): string {
  const deg = typeof lng === 'number' && Number.isFinite(lng) ? lng : 0;
  // Real offsets run from UTC-12 to UTC+14; anything outside that is bad input.
  const hours = Math.max(-12, Math.min(14, Math.round(deg / 15)));
  return new Date(now.getTime() + hours * 3_600_000).toISOString().slice(0, 10);
}

/**
 * A plan counts as over the day after it ends, so a trip is still "coming up"
 * while you are on it rather than dropping into the past on the morning you
 * arrive. A night out ends the day it starts.
 */
function lastDay(plan: DatedPlan): string | null {
  const start = planDay(plan);
  const end = dayPart(plan?.endDate);
  // An end before the start is a typo, not a trip that ended before it began.
  if (end && start && end >= start) return end;
  return start;
}

/**
 * The first plan that has not happened yet and does not touch the weeks on
 * screen, so a month with nothing in it can point at what is actually next
 * instead of looking like there is nothing planned at all.
 */
export function nextAfter<R extends { plan: DatedPlan; day: string }>(
  rows: R[],
  weeks: CalendarDay[][],
  today: string,
): R | null {
  const last = weeks.at(-1)?.[6]?.day;
  if (!last) return null;
  return (Array.isArray(rows) ? rows : [])
    .filter(r => r.day > last && (lastDay(r.plan) as string) >= today)
    .sort((a, b) => a.day.localeCompare(b.day))[0] ?? null;
}

/**
 * Plans split into what is coming, what has no date, and what is over.
 * `today` is passed in rather than read from the clock, so the rule can be
 * tested and so a screen open at midnight does not disagree with itself.
 */
export function planSections<T extends DatedPlan>(plans: T[], today: string): PlanSection<T>[] {
  const all = Array.isArray(plans) ? plans.filter(Boolean) : [];

  const upcoming: T[] = [];
  const undated: T[] = [];
  const past: T[] = [];
  for (const plan of all) {
    const day = planDay(plan);
    if (!day) { undated.push(plan); continue; }
    ((lastDay(plan) as string) >= today ? upcoming : past).push(plan);
  }

  // Soonest first for what is ahead; most recent first for what is behind.
  upcoming.sort((a, b) => (planDay(a) as string).localeCompare(planDay(b) as string));
  past.sort((a, b) => (planDay(b) as string).localeCompare(planDay(a) as string));

  return [
    { key: 'upcoming', label: 'Coming up', plans: upcoming },
    { key: 'undated', label: 'No date yet', plans: undated },
    { key: 'past', label: 'Been and gone', plans: past },
  ].filter(s => s.plans.length) as PlanSection<T>[];
}

/**
 * Everything coming up, across every group, soonest first.
 *
 * A group list answers "who do I go places with". It does not answer "what is
 * next", and that is the question somebody actually opens this tab with — the
 * answer to which was scattered one plan at a time inside however many groups
 * they belong to. This gathers it into one schedule, and leaves the groups
 * themselves to be listed by name, where they can be found by name.
 *
 * Only what has not been and gone, so the schedule is a thing to act on rather
 * than a history. A trip already under way began before today and is still the
 * nearest thing there is, so it sorts by the day it began and comes first.
 */
export function groupSchedule<P extends DatedPlan, G extends { plans?: P[] }>(
  groups: G[],
  today: string,
  limit = 8,
): { group: G; plan: P; day: string }[] {
  const rows: { group: G; plan: P; day: string }[] = [];
  for (const group of Array.isArray(groups) ? groups.filter(Boolean) : []) {
    for (const plan of group?.plans ?? []) {
      const day = planDay(plan);
      // Undated plans cannot be scheduled, and a plan that is over is not news.
      if (!day || (lastDay(plan) as string) < today) continue;
      rows.push({ group, plan, day });
    }
  }
  return rows.sort((a, b) => a.day.localeCompare(b.day)).slice(0, Math.max(0, limit));
}

// ─── The month grid ──────────────────────────────────────────────────────
// A list says what is next. A calendar says what the month looks like — that
// two trips overlap, that the weekend after next is empty. Those are shapes,
// and a list cannot show a shape.

export type CalendarDay = { day: string; inMonth: boolean; isToday: boolean };
export type PlanBar<P, G> = {
  plan: P;
  group: G;
  /** Column 0-6 within the week, and how many columns it covers. */
  col: number;
  span: number;
  /** Which row within the week's stack, so overlapping trips do not collide. */
  lane: number;
  /** The trip carries on past this week's edge, so the block is not capped there. */
  fromEarlier: boolean;
  toLater: boolean;
};

// The shape is not enough, exactly as it was not enough for a day. "2026-13"
// matches this and is not a month, and Date.UTC rolls it silently into January
// of the next year — so the grid would be drawn, correctly, for a month nobody
// asked to see.
const MONTH_SHAPE = /^\d{4}-\d{2}$/;
const isMonth = (m: unknown): m is string => {
  if (typeof m !== 'string' || !MONTH_SHAPE.test(m)) return false;
  const n = Number(m.slice(5, 7));
  return n >= 1 && n <= 12;
};
const DAY_MS = 86_400_000;
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const parseDay = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** The month a day belongs to, as YYYY-MM. */
export function monthOf(day: string): string {
  return ISO.test(day) ? day.slice(0, 7) : '';
}

/** Months forward or back, so the arrows cannot walk off the end of a year. */
export function addMonths(month: string, delta: number): string {
  if (!isMonth(month)) return month;
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const t = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** "September 2026", for the heading above the grid. */
export function monthLabel(month: string): string {
  if (!isMonth(month)) return '';
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/**
 * The weeks of a month, each seven days, Sunday first.
 *
 * The days either side that finish off the first and last weeks are included
 * and marked, because a calendar with holes at the corners is not a calendar —
 * and a trip running from the 29th to the 2nd has to be drawable across the
 * seam.
 */
export function monthGrid(month: string, today: string): CalendarDay[][] {
  if (!isMonth(month)) return [];
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const first = Date.UTC(y, m - 1, 1);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = new Date(first).getUTCDay();
  const weeks: CalendarDay[][] = [];
  const total = Math.ceil((lead + daysInMonth) / 7) * 7;
  for (let i = 0; i < total; i++) {
    const day = utcDay(first + (i - lead) * DAY_MS);
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push({
      day,
      inMonth: day.slice(0, 7) === month,
      isToday: day === today,
    });
  }
  return weeks;
}

/**
 * The blocks to draw across one week.
 *
 * Each plan is clipped to the week it is being drawn into, so a fortnight
 * abroad becomes a block on each week's row rather than one impossible block.
 * Overlapping plans are stacked into lanes — the user had six trips overlapping
 * in a single September, and without lanes they would have been painted on top
 * of one another.
 *
 * Longest first within a lane, so the big commitment is the one on the top row
 * and the evening out sits underneath it.
 */
export function weekBars<P extends DatedPlan, G>(
  rows: { group: G; plan: P; day: string }[],
  week: CalendarDay[],
): PlanBar<P, G>[] {
  if (!Array.isArray(week) || week.length !== 7) return [];
  const from = week[0].day;
  const to = week[6].day;

  const clipped = (Array.isArray(rows) ? rows : []).flatMap(row => {
    const start = planDay(row.plan);
    const end = (lastDay(row.plan) as string) || start;
    if (!start || !end || end < from || start > to) return [];
    const col = start <= from ? 0 : Math.round((parseDay(start) - parseDay(from)) / DAY_MS);
    const endCol = end >= to ? 6 : Math.round((parseDay(end) - parseDay(from)) / DAY_MS);
    return [{
      plan: row.plan,
      group: row.group,
      col,
      span: Math.max(1, endCol - col + 1),
      lane: 0,
      fromEarlier: start < from,
      toLater: end > to,
    }];
  });

  // Longest first, then earliest, so lanes fill predictably rather than by
  // whatever order the groups happened to arrive in.
  clipped.sort((a, b) => b.span - a.span || a.col - b.col);

  const lanes: number[] = []; // the first free column in each lane
  for (const bar of clipped) {
    let lane = lanes.findIndex(freeFrom => bar.col >= freeFrom);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = bar.col + bar.span;
    bar.lane = lane;
  }
  return clipped.sort((a, b) => a.lane - b.lane || a.col - b.col);
}

/**
 * Groups by name, the way somebody looks one up.
 *
 * Case-insensitive, and numbers inside a name sort the way a person reads them
 * so "Trip 2" comes before "Trip 10". A group nobody named sorts last rather
 * than jumping to the top on an empty string.
 */
export function byName<T extends { name?: unknown }>(a: T, b: T): number {
  const nameOf = (g: T) => (typeof g?.name === 'string' ? g.name.trim() : '');
  const x = nameOf(a);
  const y = nameOf(b);
  if (!x || !y) return x ? -1 : y ? 1 : 0;
  return x.localeCompare(y, undefined, { sensitivity: 'base', numeric: true });
}

/**
 * How far away a plan is, in the words somebody would use. Null for a plan
 * with no date, so the screen can say nothing rather than guess.
 */
export function daysAway(plan: DatedPlan, today: string): string | null {
  const day = planDay(plan);
  if (!day || !ISO.test(today)) return null;
  // A trip that started on Monday and ends on Friday is not "Yesterday" on
  // Wednesday. It is happening, and saying anything else contradicts the
  // section it is sitting under.
  const ends = lastDay(plan);
  if (day <= today && ends && ends >= today) return day === today ? 'Today' : 'On now';
  const ms = Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  const days = Math.round(ms / 86_400_000);
  // Something finished is described by when it finished. A trip that ran the
  // tenth to the fifteenth ended yesterday; measuring from the day it began
  // called that "6 days ago", which is true of nothing anybody cares about.
  if (days < 0) {
    const ended = lastDay(plan) as string;
    const overBy = Math.round(
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${ended}T00:00:00Z`)) / 86_400_000,
    );
    if (overBy === 1) return 'Yesterday';
    if (overBy > 1 && overBy < 7) return `${overBy} days ago`;
    return null;
  }
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1 && days < 7) return `In ${days} days`;
  if (days >= 7 && days < 14) return 'Next week';
  return null;
}

/**
 * How long until a plan, in whole days.
 *
 * Counted between calendar days rather than between instants, because "in 3
 * days" is a statement about dates and not about 72 hours. Both sides use
 * the same local-day rule as today(), so a trip on Friday reads "in 2 days"
 * all Wednesday and does not become "in 1 day" at eight in the evening when
 * UTC rolls over — which is exactly the bug that made tonight's events
 * disappear from Discover.
 *
 * Null when the plan has no real date. A countdown to a date nobody set
 * would be a number the app invented.
 */
export function daysUntil(plan: DatedPlan, now: Date = new Date()): number | null {
  const day = planDay(plan);
  if (!day) return null;
  const from = Date.parse(`${today(now)}T00:00:00Z`);
  const to = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86400000);
}

/**
 * The countdown as somebody reads it, or null when there is nothing to say.
 *
 * Nothing is said about a trip that has been and gone, and nothing is
 * invented for one with no date — the card simply carries no countdown,
 * which is honest and quiet.
 */
export function countdown(plan: DatedPlan, now: Date = new Date()): string | null {
  const days = daysUntil(plan, now);
  if (days === null || days < 0) return null;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return `In ${days} days`;
  if (days < 14) return 'Next week';
  if (days < 31) return `In ${Math.round(days / 7)} weeks`;
  // Past a month, weeks stop meaning anything to anybody.
  const months = Math.round(days / 30);
  return months <= 1 ? 'In a month' : `In ${months} months`;
}

/**
 * Where a trip is relative to today: still coming, happening, or finished.
 *
 * The plan screen offered "Book everything" on a trip that began five days
 * ago. Pressing it reached LiteAPI and got "No rates available", which is
 * true and is a strange way to find out your trip has started. `daysAway`
 * already worked all this out for the home screen; the booking path never
 * asked.
 *
 * Null when there are no dates — an undated plan is not late, it is undated.
 */
export type TripTiming = 'upcoming' | 'on_now' | 'over';
export function tripTiming(plan: DatedPlan, today: string): TripTiming | null {
  const day = planDay(plan);
  if (!day || !ISO.test(today)) return null;
  const ends = lastDay(plan) ?? day;
  if (ends < today) return 'over';
  if (day <= today) return 'on_now';
  return 'upcoming';
}

/** Whether there is any point asking a provider to price this. */
export function worthQuoting(plan: DatedPlan, today: string): boolean {
  return tripTiming(plan, today) === 'upcoming';
}

/**
 * Whether a plan is still on: not completed or cancelled, and not over by its
 * own dates. Nothing ever sets a plan to "completed" — the date is the fact we
 * hold — so a dinner last Sunday counted as one of a group's "plans on" and
 * still asked for votes and money on Home. Undated plans are live: they are
 * still coming, even if nobody knows when. One definition, so the group card,
 * Home's upcoming list and Home's actions cannot disagree.
 */
export function isLive(p: { status?: string | null; startDate?: unknown; endDate?: unknown }, todayISO: string): boolean {
  if (p.status === 'completed' || p.status === 'cancelled') return false;
  return tripTiming({ startDate: p.startDate, endDate: p.endDate }, todayISO) !== 'over';
}
