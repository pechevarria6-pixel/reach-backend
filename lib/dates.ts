// ─── Date coercion ───────────────────────────────────────────────────────
// The client stores a plan's dates as a display string ("Dates TBD",
// "Sat, Mar 8", "2026-03-08 – 2026-03-14"). Postgres `date` columns reject
// most of those, and the resulting INSERT error used to be swallowed, so the
// plan was silently never saved. Everything that reaches the database goes
// through here first.

/**
 * Normalise a value to `YYYY-MM-DD`, or null when it isn't a real date.
 * Never throws — an unparseable value is stored as NULL rather than failing
 * the write.
 */
export function toDateOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;

  // Already ISO: keep it verbatim so no timezone shift can move the day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().split('T')[0];
}

/**
 * Pull ISO start/end dates out of a plan payload, preferring the explicit
 * fields and falling back to parsing the display string for older records.
 */
export function planDates(plan: { startDate?: unknown; endDate?: unknown; dates?: unknown }) {
  const display = typeof plan.dates === 'string' ? plan.dates : '';
  const isRange = display.includes('–');

  const start =
    toDateOrNull(plan.startDate) ??
    toDateOrNull(isRange ? display.split('–')[0] : display.split(' at ')[0]);
  const end =
    toDateOrNull(plan.endDate) ??
    toDateOrNull(isRange ? display.split('–')[1] : null);

  return { start, end };
}

// ─── Display ─────────────────────────────────────────────────────────────
// A plan's `dates` field is a label and nothing else. It used to be the raw
// ISO strings joined with a dash — "2026-08-01 – 2026-08-08" on the card a
// distracted person is meant to read at a glance — and worse, the client then
// split that label back apart to recover the dates it already had.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Parse `YYYY-MM-DD` into a LOCAL date. `new Date('2026-08-01')` is UTC
 * midnight, which renders as July 31st for anyone west of Greenwich.
 */
export function parseISODate(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Nights between two ISO dates, or null when either is missing or reversed. */
export function nightsBetween(start: unknown, end: unknown): number | null {
  const a = parseISODate(start);
  const b = parseISODate(end);
  if (!a || !b) return null;
  const n = Math.round((b.getTime() - a.getTime()) / 86400000);
  return n > 0 ? n : null;
}

/**
 * A human label: "Aug 1 – 8" within a month, "Aug 28 – Sep 3" across one, and
 * the year only when it is not the current one.
 */
export function formatDates(start: unknown, end: unknown, time?: string | null, today = new Date()): string {
  const a = parseISODate(start);
  const b = parseISODate(end);
  if (!a) return 'Dates TBD';
  const year = (d: Date) => (d.getFullYear() === today.getFullYear() ? '' : `, ${d.getFullYear()}`);

  if (!b || a.getTime() === b.getTime()) {
    return `${MONTHS[a.getMonth()]} ${a.getDate()}${year(a)}${time ? ` at ${time}` : ''}`;
  }
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return `${MONTHS[a.getMonth()]} ${a.getDate()} – ${b.getDate()}${year(b)}`;
  }
  return `${MONTHS[a.getMonth()]} ${a.getDate()} – ${MONTHS[b.getMonth()]} ${b.getDate()}${year(b)}`;
}
