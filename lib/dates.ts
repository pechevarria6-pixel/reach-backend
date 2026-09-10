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
