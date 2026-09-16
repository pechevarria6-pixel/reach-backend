// ─── When the group can go ───────────────────────────────────────────────
// Everybody says which stretches of dates work for them. This finds the
// stretches the most of them can make, for a trip of a given length.
//
// Pure, so the rule can be tested: most people first, earliest on a tie, and
// the suggestions never overlap each other — three versions of the same long
// weekend are one suggestion, not three.

export type Range = { start: string; end: string };
export type MemberRange = Range & { userId: string };
export type Window = { start: string; end: string; available: string[]; count: number };

const DAY = 86_400_000;
// A range is somebody's free time, not their calendar for the decade. Past
// this the day-by-day scan stops being cheap for no benefit to anyone.
const MAX_SPAN_DAYS = 400;
export const MAX_RANGES = 20;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (d: string) => Date.parse(`${d}T00:00:00Z`);
const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);

/** A real calendar date as YYYY-MM-DD, or null. "2026-02-30" is not one. */
export function isoDate(v: unknown): string | null {
  if (typeof v !== 'string' || !ISO.test(v)) return null;
  const t = dayOf(v);
  return Number.isFinite(t) && isoOf(t) === v ? v : null;
}

/** What somebody sent, if every range in it is real, in order and sensible. */
export function cleanRanges(input: unknown): Range[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_RANGES) return null;
  const out: Range[] = [];
  for (const r of input) {
    const start = isoDate((r as Partial<Range> | null)?.start);
    const end = isoDate((r as Partial<Range> | null)?.end);
    if (!start || !end || end < start) return null;
    if ((dayOf(end) - dayOf(start)) / DAY > MAX_SPAN_DAYS) return null;
    out.push({ start, end });
  }
  return out;
}

/**
 * The best stretches for a trip of `nights` nights, most people first and
 * earliest on a tie, never overlapping one another.
 */
export function bestWindows(ranges: MemberRange[], nights: number, limit = 3): Window[] {
  const n = Math.min(30, Math.max(1, Math.floor(Number(nights) || 1)));

  // Who is free on each day.
  const free = new Map<number, Set<string>>();
  for (const r of ranges) {
    const start = isoDate(r.start);
    const end = isoDate(r.end);
    if (!start || !end || end < start) continue;
    for (let t = dayOf(start), i = 0; t <= dayOf(end) && i <= MAX_SPAN_DAYS; t += DAY, i++) {
      if (!free.has(t)) free.set(t, new Set());
      free.get(t)!.add(r.userId);
    }
  }

  // A trip of n nights needs n + 1 days, and the people who can come are the
  // ones free on every one of them.
  const candidates: Window[] = [];
  for (const s of [...free.keys()].sort((a, b) => a - b)) {
    let going: Set<string> | null = null;
    for (let i = 0; i <= n; i++) {
      const day = free.get(s + i * DAY);
      if (!day) { going = null; break; }
      going = going ? new Set([...going].filter(u => day.has(u))) : new Set(day);
      if (!going.size) { going = null; break; }
    }
    if (going) {
      candidates.push({ start: isoOf(s), end: isoOf(s + n * DAY), available: [...going].sort(), count: going.size });
    }
  }

  candidates.sort((a, b) => b.count - a.count || a.start.localeCompare(b.start));
  const picked: Window[] = [];
  for (const c of candidates) {
    if (picked.some(p => !(c.end < p.start || c.start > p.end))) continue;
    picked.push(c);
    if (picked.length === limit) break;
  }
  return picked;
}
