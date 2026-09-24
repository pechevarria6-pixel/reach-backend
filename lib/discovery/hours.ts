// ─── Whether a place is shut when somebody would turn up ────────────────
// OpenStreetMap records opening hours for a good share of the places we
// hold, in its own little language: "Mo-Th 11:00-22:00; Fr-Sa 11:00-23:00;
// Su off". The menu used to carry none of it, so a Sunday night out could be
// built around a restaurant that is closed on Sundays, and nothing checked.
//
// The rule is lopsided on purpose. Hours say CLOSED only when they parse,
// cover the day in question, and give no open or unknown stretch in the
// window that matters. Anything else — no hours, hours that do not parse,
// "unknown", a public-holiday rule we cannot place — keeps the venue. A
// place wrongly dropped is a missed dinner; a place wrongly kept is at worst
// what we did before, and the menu says where its hours came from.
//
// Parsed with the `opening_hours` package (LGPL-3.0, used unmodified as a
// server-side dependency; see docs/INGEST.md).
import OpeningHours from 'opening_hours';

/** The stretch of a day that matters for this kind of place. */
export type Window = 'evening' | 'day';

const WINDOWS: Record<Window, [number, number]> = {
  // From five until midnight: dinner, a drink, a gig.
  evening: [17, 24],
  // From nine: a museum that shuts at five is open for the afternoon.
  day: [9, 24],
};

/** Somewhere you go in the evening, going by what the map calls it. */
export function eveningKind(kind: string, interest: string | null): boolean {
  return /restaurant|places to eat|\bcafe\b|\bbar\b|bars\b|\bpubs?\b|nightclub|brewer|wine|music|jazz|theatre|theater|cinema|comedy/i
    .test(`${kind} ${interest ?? ''}`);
}

/**
 * The window to check a place against.
 *
 * `eveningOut` is whether the plan is a night out, and it has to be said:
 * it cannot be read off the dates. A single date was taken to mean an
 * evening, so a day trip — lunch included — had every café that shuts at
 * three dropped from its menu. On a night out, food, drink and a show are
 * judged on the evening, because a café that closes at four is no use for
 * it. Everything else, and everything on any other plan, is judged on the
 * whole day: a museum is for the afternoon, and a lunch spot is lunch.
 */
export function windowFor(kind: string, interest: string | null, eveningOut: boolean): Window {
  return eveningOut && eveningKind(kind, interest) ? 'evening' : 'day';
}

/** The dates from `from` to `to`, inclusive, as local calendar days. At most a fortnight. */
export function datesBetween(from: string, to: string): Date[] {
  const parse = (s: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const start = parse(from);
  const end = parse(to) ?? start;
  if (!start || !end || end < start) return start ? [start] : [];
  const out: Date[] = [];
  for (const d = new Date(start); d <= end && out.length < 14; d.setDate(d.getDate() + 1)) out.push(new Date(d));
  return out;
}

/** Where the place is, for rules like "PH off" and "sunset-sunrise". */
export interface HoursPlace {
  lat: number;
  lng: number;
  /** ISO 3166-1, "us". Without it a holiday rule cannot be placed. */
  countryCode?: string | null;
}

/**
 * True only when the map's hours say this place is shut, in the window that
 * matters, on every one of the plan's days.
 *
 * Every date is built from its local parts and read back the same way, so
 * the answer does not move with the server's time zone.
 */
export function closedThroughout(
  hours: string | null | undefined,
  days: { from: string; to: string } | null | undefined,
  window: Window,
  where?: HoursPlace | null,
): boolean {
  const text = String(hours || '').trim();
  if (!text || !days) return false;
  const dates = datesBetween(days.from, days.to);
  if (!dates.length) return false;

  let oh: OpeningHours;
  try {
    const nominatim = where && Number.isFinite(where.lat) && Number.isFinite(where.lng)
      ? { lat: where.lat, lon: where.lng, address: { country_code: String(where.countryCode || '').toLowerCase(), state: '' } }
      : null;
    // A holiday rule with no country is refused by the parser; so is a
    // typo. Either way we do not know, and not knowing keeps the place.
    oh = new OpeningHours(text, nominatim as never);
  } catch {
    return false;
  }

  const [fromHour, toHour] = WINDOWS[window];
  try {
    return dates.every(d => {
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), fromHour, 0);
      const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), toHour - 1, 59);
      // Open and unknown stretches both come back here. Only none at all is closed.
      return oh.getOpenIntervals(start, end).length === 0;
    });
  } catch {
    return false;
  }
}

/**
 * Whether the hours say the place is never open, whatever the date.
 *
 * For a plan with no dates, where there is no day to check. "off" and
 * "closed" are how the map says a place has shut, and they mean it on every
 * day there is; a menu that prints "hours per OpenStreetMap: off" under a
 * place it offers has named somewhere its own source says is shut.
 *
 * Checked across a whole year from `from`, so seasonal hours ("Jun-Aug
 * 10:00-18:00") and one day a week are open, not never. The same lean as
 * closedThroughout: no hours, hours that do not parse, and any open or
 * unknown stretch all keep the place.
 */
export function neverOpen(
  hours: string | null | undefined,
  where?: HoursPlace | null,
  from: Date = new Date(),
): boolean {
  const text = String(hours || '').trim();
  if (!text) return false;
  let oh: OpeningHours;
  try {
    const nominatim = where && Number.isFinite(where.lat) && Number.isFinite(where.lng)
      ? { lat: where.lat, lon: where.lng, address: { country_code: String(where.countryCode || '').toLowerCase(), state: '' } }
      : null;
    oh = new OpeningHours(text, nominatim as never);
  } catch {
    return false;
  }
  try {
    const end = new Date(from.getTime() + 366 * 86400_000);
    return oh.getOpenIntervals(from, end).length === 0;
  } catch {
    return false;
  }
}
