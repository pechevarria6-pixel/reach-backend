// ─── When an itinerary line is, as a date and a clock ───────────────────
// A line's time was stored only as words — "Day 3 · Evening" — and every
// booking made from one went out for the trip's first night: the bookable
// route sent `plan.start_date` as each dinner's date and the words, or
// "19:00" when there were none, as its time. A day-three dinner was asked
// for on day one, at a time nobody chose.
//
// The day is already in the words, and lib/ics.ts, lib/pings.ts,
// lib/wallet.ts and lib/budget.ts all read it from there; this reads it the
// same way (rowWhen), so they cannot disagree about which day a line is. The
// date is worked out from the plan's own dates every time it is asked for,
// never stored: a plan's dates move (Edit plan), and a stored date would go
// on pointing at the old ones.
//
// The clock is only ever one somebody gave: the time a person set for their
// evening, attached by the generator to the slot it is about, or a time
// typed into the line. "Evening" is not seven o'clock. An evening line with
// no time has `clock: null`, and whatever shows it says no time is set.
//
// Stricter than rowWhen about lines with no day number: on a trip of more
// than one day, a line that does not say its day ("Saturday dinner", "Before
// you go") is on no known date, rather than on the first one.
import { clockOf, clockIn, tripDay, validDay } from './ics.ts';

export interface PlanDates {
  startDate?: unknown;
  endDate?: unknown;
}

export interface LineWhen {
  /** The trip day the line names (1 = the start), or null when it names none. */
  day: number | null;
  /** YYYY-MM-DD, the local date at the destination, or null when it cannot be known. */
  date: string | null;
  /** 24-hour "HH:MM", only when somebody gave one. Never a guess from "Evening". */
  clock: string | null;
  /** What is left of the words — "Evening", "The main event" — for saying it. */
  part: string | null;
}

// The same day prefix lib/ics.ts rowWhen reads, so the two agree on the day.
const DAY_NUMBER = /^day\s*(\d+)(?!\d)/i;
const DAY_PREFIX = /^day\s*\d+(?!\d)\s*(?:[·\-–—:,]|\bat\b)?\s*/i;
const pad = (n: number) => String(n).padStart(2, '0');

/** Any clock a person might write, as "HH:MM", or null. */
export function clock24(text: unknown): string | null {
  const c = clockOf(typeof text === 'string' ? text.trim() : text);
  return c ? `${pad(c.h)}:${pad(c.m)}` : null;
}

/** "19:30" as somebody reads it on a screen: "7:30 PM". */
export function clockSaid(hhmm: unknown): string | null {
  const c = clockOf(typeof hhmm === 'string' ? hhmm : '');
  if (!c) return null;
  const h12 = c.h % 12 === 0 ? 12 : c.h % 12;
  return `${h12}:${pad(c.m)} ${c.h < 12 ? 'AM' : 'PM'}`;
}

/** A one-day plan: no end, or an end on the start. A night out is one of these. */
function oneDay(plan: PlanDates): boolean {
  const start = validDay(plan.startDate);
  const end = validDay(plan.endDate);
  return !!start && (!end || end === start);
}

export function lineWhen(scheduledTime: unknown, plan: PlanDates): LineWhen {
  const text = typeof scheduledTime === 'string' ? scheduledTime.trim() : '';
  const m = DAY_NUMBER.exec(text);
  const day = m ? parseInt(m[1], 10) : null;
  const rest = text.replace(DAY_PREFIX, '');
  const clock = clock24(clockIn(rest));

  let date: string | null = null;
  if (day !== null) {
    // The day the line names, if the trip has it. Day nine of a seven-night
    // trip is on no date, not on one after the trip has ended.
    const d = day >= 1 ? tripDay(plan.startDate, day) : null;
    const end = validDay(plan.endDate);
    date = d && (!end || d <= end) ? d : null;
  } else if (oneDay(plan)) {
    // "To start", "The main event": one evening, on the plan's one date.
    date = validDay(plan.startDate);
  }

  // The words around the day and the clock — what kind of time it is.
  const part = rest
    .split('·').map(s => s.trim()).filter(s => s && !clockOf(s)).join(' · ') || null;

  return { day, date, clock, part };
}

/**
 * The words for a line that carries a clock: the part of the day kept, the
 * time added after it. Used where a time is attached to a label that did not
 * have one, so it is stored where every reader of the line already looks.
 */
export function labelWithClock(label: unknown, hhmm: unknown): string {
  const base = typeof label === 'string' ? label.trim() : '';
  const said = clockSaid(hhmm);
  if (!said) return base;
  if (clockIn(base.replace(DAY_PREFIX, ''))) return base; // already has one
  return base ? `${base} · ${said}` : said;
}

/** "Sat, Nov 7", from a date. Counted in UTC so no server zone moves the weekday. */
export function dateSaid(day: unknown): string | null {
  const d = validDay(day);
  if (!d) return null;
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

/**
 * When a table is for, said plainly — and said as unknown when it is.
 *
 *   both known     "Sat, Nov 7 at 7:30 PM"
 *   no clock       "Sat, Nov 7 (evening) — no time set yet"
 *   no date        "No date set yet"
 */
export function whenSaid(when: Pick<LineWhen, 'date' | 'clock' | 'part'>): string {
  const d = dateSaid(when.date);
  const t = clockSaid(when.clock);
  if (!d) return t ? `No date set yet, ${t}` : 'No date set yet';
  if (t) return `${d} at ${t}`;
  const part = when.part && /^(morning|afternoon|evening|night|lunch|dinner|brunch)$/i.test(when.part)
    ? ` (${when.part.toLowerCase()})` : '';
  return `${d}${part} — no time set yet`;
}
