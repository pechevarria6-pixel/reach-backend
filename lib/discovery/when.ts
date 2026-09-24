// ─── Turning "Fri, Sep 25" into a date the app can use ───────────────────
// 827 harvested events: 591 carry a real date, and 183 carry one only in
// their own words — "Sun, Sep 20", "Fri, Sep 25" — which no screen can sort,
// filter or put on a calendar. Another 114 are genuinely recurring:
// "Mondays, 7:00-8:30pm", "every Wednesday at 7".
//
// Both are useful and neither is usable as prose.
//
// The year is the part worth being careful about. "Fri, Sep 25" does not say
// which year, and guessing wrong puts a festival on the wrong day for ever.
// So the weekday is the check: a candidate date is only accepted if the day
// it actually falls on is the day the text names. Sep 25 is a Friday in 2026
// and a Thursday in 2025, and that is enough to tell them apart.
//
// When the text names no weekday there is nothing to check against, so the
// nearest future occurrence is taken and marked unconfirmed — the caller
// decides whether an unchecked date is worth having.

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export interface WhenParsed {
  /** A single date, ISO, when the text names one we could confirm. */
  on: string | null;
  /** 0–6 for a weekly event, Sunday first. Null when it is not recurring. */
  everyWeekdayIndex: number | null;
  /** True when a named weekday agreed with the date we worked out. */
  confirmed: boolean;
}

const NONE: WhenParsed = { on: null, everyWeekdayIndex: null, confirmed: false };

/** Plural weekday, or "every <day>" — the shapes a recurring line takes. */
function recurringDay(text: string): number | null {
  for (let i = 0; i < WEEKDAYS.length; i++) {
    const day = WEEKDAYS[i];
    const short = day.slice(0, 3);
    // "Mondays", "every Monday", "each Mon", "Mon nights"
    const plural = new RegExp(`\\b${day}s\\b|\\b${short}s\\b`, 'i');
    const every = new RegExp(`\\b(?:every|each)\\s+${day}\\b|\\b(?:every|each)\\s+${short}\\b`, 'i');
    const nights = new RegExp(`\\b${day}\\s+(?:night|nights|evening|evenings)\\b`, 'i');
    if (plural.test(text) || every.test(text) || nights.test(text)) return i;
  }
  return null;
}

/** The weekday a line names at all, plural or not. */
function namedDay(text: string): number | null {
  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (new RegExp(`\\b${WEEKDAYS[i]}\\b|\\b${WEEKDAYS[i].slice(0, 3)}\\b`, 'i').test(text)) return i;
  }
  return null;
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * What a harvested "when" line actually says.
 *
 * `today` is passed in rather than read from the clock, so this is testable
 * and so the day it is called on cannot change the answer by accident.
 */
export function parseWhen(text: unknown, today: string): WhenParsed {
  const t = String(text ?? '').trim();
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return NONE;

  // Recurring first: "Mondays, 4:00-5:00pm" is a weekly thing, not a date.
  const every = recurringDay(t);
  if (every !== null) return { on: null, everyWeekdayIndex: every, confirmed: true };

  // A month and a day: "Sep 25", "September 25", "Sat, Sep 26".
  const md = new RegExp(`\\b(${MONTHS.join('|')})[a-z]*\\.?\\s+(\\d{1,2})\\b`, 'i').exec(t);
  if (!md) return NONE;
  const month = MONTHS.indexOf(md[1].toLowerCase().slice(0, 3));
  const day = Number(md[2]);
  if (month < 0 || day < 1 || day > 31) return NONE;

  // An explicit year wins outright.
  const yearMatch = /\b(20\d{2})\b/.exec(t);
  const wants = namedDay(t);
  const [ty, tm, td] = today.split('-').map(Number);

  const candidates = yearMatch
    ? [Number(yearMatch[1])]
    // This year, then next: a harvested listing is something coming up, and
    // "Jan 4" found in December means the January after it.
    : [ty, ty + 1];

  for (const year of candidates) {
    const d = new Date(Date.UTC(year, month, day));
    // A date that rolled over — "Feb 30" — is not a date.
    if (d.getUTCMonth() !== month || d.getUTCDate() !== day) continue;
    const on = iso(year, month, day);
    if (!yearMatch && on < today) continue;          // already gone
    if (wants !== null && d.getUTCDay() !== wants) continue;  // the check
    return { on, everyWeekdayIndex: null, confirmed: wants !== null };
  }
  return NONE;
}


/**
 * Whether an event read off a venue's page is still to come — and so worth
 * keeping or offering.
 *
 * 348 of 639 dated events in the table had already happened, four of them in
 * 2020: "Emo Nights, Fri September 25", read last week off a page nobody had
 * updated. The page reader dated it 2020, and that year is the only evidence
 * it is old — September 25 2026 is also a Friday, so re-reading the text
 * would bring a six-year-old party back as this weekend. So a past date is
 * believed, and the event goes. A weekly thing ("Every Sunday") has no single
 * date to be past, and stays.
 */
export function stillToCome(e: { starts_on?: string | null; when_text?: string | null }, today: string): boolean {
  if (parseWhen(e.when_text, today).everyWeekdayIndex !== null) return true;
  if (!e.starts_on) return true;   // undated: nothing says it has gone
  return e.starts_on >= today;
}


/**
 * Whether an event is on during these days: a dated one inside them, a weekly
 * one on one of their weekdays. An evening on October 2nd was planned around
 * a concert on September 25th because the menu offered every upcoming event
 * at a venue, whatever the plan's date. Undated one-offs say nothing about
 * these days, so they are not offered as happening on them.
 */
export function onTheDays(e: { starts_on?: string | null; when_text?: string | null }, from: string, to: string): boolean {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(from) || !iso.test(to) || to < from) return stillToCome(e, from);
  const weekly = parseWhen(e.when_text, from).everyWeekdayIndex;
  if (weekly !== null) {
    for (let t = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); t <= end; t += 86400000) {
      if (new Date(t).getUTCDay() === weekly) return true;
    }
    return false;
  }
  if (!e.starts_on) return false;
  return e.starts_on >= from && e.starts_on <= to;
}
