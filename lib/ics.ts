// ─── A trip as a calendar file ───────────────────────────────────────────
// "Add to calendar" hands a person's own calendar what we hold about their
// trip, and a calendar is where a wrong day does the most damage: it is the
// thing they look at on the morning, and it does not say where it came from.
//
// The day is the one that goes wrong. A server keeps UTC, and the UTC date
// turns over at eight in the evening in New York — so a dinner at half past
// eight on the third, pushed through `toISOString()`, lands on the fourth.
// Nothing here ever asks the clock what day something is. A plan's days are
// the dates it was given (lib/calendar.ts), counted on as dates, and a time
// is kept as the wall clock it was written in:
//
//   no time we can read   an all-day event on its own date. "Morning" is not
//                         nine o'clock, and a time nobody gave is not invented.
//   "7:30 PM", "19:30"    a floating local time — half past seven wherever
//                         the trip is, which is what the itinerary means.
//   an ISO time with an   the exact instant, in UTC. A flight's departure is
//   offset                one moment everywhere, and the calendar can place it.
//
// No duration is invented either. An event with no end is left without one;
// the calendar draws it as a moment, which is exactly what we know.
//
// Pure, so the rules can be tested at an hour the test does not wait for.
import { planDay } from './calendar.ts';

export interface IcsEvent {
  /** Stable across exports, so a second import updates rather than duplicates. */
  uid: string;
  title: string;
  /** The local day at the destination, YYYY-MM-DD. */
  date: string;
  /** "19:30", "7:30 PM", or an ISO timestamp with its offset. Anything else is all day. */
  time?: string | null;
  /** When it ends, in the same forms as `time`. Only ever what we were told. */
  end?: string | null;
  location?: string | null;
  description?: string | null;
  url?: string | null;
}

export interface IcsOptions {
  /** The calendar's name as the person's app lists it — the trip's own name. */
  name: string;
  /** DTSTAMP. Injectable so output is testable. */
  now?: Date;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** A real calendar date or null; "2026-13-45" matches the shape and is not one. */
export function validDay(v: unknown): string | null {
  return planDay({ startDate: v });
}

/**
 * The date of day `n` of a trip (day 1 is the start), counted on the
 * calendar rather than the clock.
 *
 * `new Date(start).setDate(...)` reads the start in the server's zone and
 * writes it back in UTC, which is how a day slides. Counting in UTC on a
 * date that has no time at all cannot slide, wherever the process runs.
 */
export function tripDay(startDate: unknown, n: number): string | null {
  const start = validDay(startDate);
  if (!start || !Number.isInteger(n) || n < 1) return null;
  const t = Date.parse(`${start}T00:00:00Z`) + (n - 1) * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * An itinerary row's "Day 3 · 7:30 PM" as a date and whatever time it gives.
 * A row with no day number is on the start date — a night out's "To start"
 * and "The main event" are all one evening.
 */
export function rowWhen(scheduledTime: unknown, startDate: unknown): { date: string; time: string | null } | null {
  const text = typeof scheduledTime === 'string' ? scheduledTime : '';
  // Any row that starts with a day number is on that day, whatever follows
  // and however it is written. The strict "Day N · …" pattern put "Day 3 at
  // 7pm", "day 3 · evening" and "Day 3 7:30 PM" — all typeable in the free
  // "Time / Day" box on a hand-added item — on day 1, an event on the wrong
  // day. lib/budget.ts dayOf reads the same field as /^day\s+(\d+)/i, and
  // the two must agree on which day a row is.
  const m = /^day\s*(\d+)(?!\d)\s*(?:[·\-–—:,]|\bat\b)?\s*([\s\S]*)$/i.exec(text.trim());
  const date = m ? tripDay(startDate, parseInt(m[1], 10)) : validDay(startDate);
  if (!date) return null;
  const rest = m ? m[2] : text;
  return { date, time: clockOf(rest) ? rest.trim() : null };
}

type Clock = { h: number; m: number };

/** "19:30" or "7:30 pm" or "7pm" → hours and minutes; anything else is not a time. */
export function clockOf(text: unknown): Clock | null {
  if (typeof text !== 'string') return null;
  const t = text.trim().toLowerCase();
  let m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (m) {
    const h = +m[1], min = +m[2];
    return h < 24 && min < 60 ? { h, m: min } : null;
  }
  m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/.exec(t);
  if (m) {
    const h12 = +m[1], min = m[2] ? +m[2] : 0;
    if (h12 < 1 || h12 > 12 || min > 59) return null;
    return { h: (h12 % 12) + (m[3] === 'p' ? 12 : 0), m: min };
  }
  return null;
}

/** An ISO timestamp that carries its own offset — the only kind that names an instant. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;

function utcStamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

const compact = (day: string) => day.replace(/-/g, '');

type Moment = { kind: 'instant' | 'floating'; value: string };

/** A time on a date, or null when it names no time. */
function momentOf(date: string, time: string | null | undefined): Moment | null {
  if (typeof time === 'string' && INSTANT.test(time.trim())) {
    const t = Date.parse(time.trim());
    if (Number.isFinite(t)) return { kind: 'instant', value: utcStamp(new Date(t)) };
  }
  const c = clockOf(time);
  if (c) return { kind: 'floating', value: `${compact(date)}T${pad(c.h)}${pad(c.m)}00` };
  return null;
}

/**
 * The end, only when it can honestly follow the start. A night that runs
 * from ten to one ends on the next date; an end in a different kind of time
 * from its start cannot be compared, so it is left off rather than guessed.
 */
function endOf(date: string, start: Moment, time: string | null | undefined): Moment | null {
  const end = momentOf(date, time);
  if (!end || end.kind !== start.kind) return null;
  if (end.value > start.value) return end;
  if (end.kind === 'floating') {
    const next = momentOf(tripDay(date, 2) as string, time) as Moment;
    return next.value > start.value ? next : null;
  }
  return null;
}

/** RFC 5545 text: backslash, semicolon, comma and newlines escaped. */
export function escapeText(v: string): string {
  return v
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Lines longer than 75 octets are folded with CRLF and a space. Counted in
 * bytes, and never split inside a character — "Café" cut through its é is
 * a calendar showing a replacement glyph.
 */
export function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  const limit = () => (out.length ? 74 : 75); // continuation lines start with a space
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit()) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/**
 * The whole file. Events we cannot place on a real date are left out rather
 * than put on some other one — an event on the wrong day is worse than none.
 */
export function buildIcs(events: IcsEvent[], opts: IcsOptions): string {
  const stamp = utcStamp(opts.now ?? new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Reach//Trip//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(opts.name)}`,
  ];

  for (const e of Array.isArray(events) ? events : []) {
    const date = validDay(e?.date);
    const title = typeof e?.title === 'string' ? e.title.trim() : '';
    if (!date || !title || !e.uid) continue;

    lines.push('BEGIN:VEVENT', `UID:${escapeText(String(e.uid))}@alcanzar.io`, `DTSTAMP:${stamp}`);
    const start = momentOf(date, e.time);
    if (start) {
      lines.push(`DTSTART:${start.value}`);
      const end = endOf(date, start, e.end);
      if (end) lines.push(`DTEND:${end.value}`);
    } else {
      // All day: DTEND is exclusive, so the day after, counted as a date.
      lines.push(`DTSTART;VALUE=DATE:${compact(date)}`, `DTEND;VALUE=DATE:${compact(tripDay(date, 2) as string)}`);
    }
    lines.push(`SUMMARY:${escapeText(title)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.url && /^https?:\/\//i.test(e.url)) lines.push(`URL:${e.url}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
