// ─── A week of what is actually on ───────────────────────────────────────
// The harvest knows about pub quizzes on Wednesdays, Wing Wednesday, karaoke
// on Thursdays and a folk festival on the 26th, and none of it was ever
// gathered into "here is what is on". A one-off sits in the table with a
// date; a weekly thing sits there with a weekday and no date at all, and the
// two never met.
//
// This puts them on the same days. A weekly event is repeated onto each of
// its weekdays in the window — that is what weekly means — and a one-off
// appears on its date. Nothing is invented: an event with neither a date nor
// a weekday does not appear, because there is no day to put it on.

export interface OnEvent {
  id?: string | null;
  title?: string | null;
  /** ISO date for a one-off. */
  starts_on?: string | null;
  /** 0–6, Sunday first, for a weekly thing. */
  every_weekday?: number | null;
  when_text?: string | null;
  venue_name?: string | null;
  booking_url?: string | null;
  interest?: string | null;
  city?: string | null;
  /** The finding's own photo and whose it is — carried, never looked up. */
  image?: string | null;
  image_credit?: string | null;
  image_of?: string | null;
  image_link?: string | null;
}

export interface OnDay {
  /** ISO date. */
  day: string;
  /** Sunday-first index, so a caller can name it. */
  weekday: number;
  events: (OnEvent & { recurring: boolean })[];
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/**
 * The next `days` days, each with what is on.
 *
 * Days with nothing on are kept. A calendar that silently skips Tuesday
 * tells somebody there is no Tuesday, rather than that there is nothing on
 * it — and "nothing on" is a true and useful answer.
 */
export function whatsOn(events: OnEvent[] | null | undefined, today: string, days = 7): OnDay[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return [];
  const out: OnDay[] = [];
  for (let i = 0; i < Math.max(0, days); i++) {
    const day = addDays(today, i);
    const weekday = weekdayOf(day);
    const on: (OnEvent & { recurring: boolean })[] = [];
    for (const e of events ?? []) {
      if (e?.starts_on === day) on.push({ ...e, recurring: false });
      // A weekly thing is on every one of its days, including today.
      else if (e?.every_weekday === weekday && !e?.starts_on) on.push({ ...e, recurring: true });
    }
    out.push({ day, weekday, events: on });
  }
  return out;
}

/** How many days in the window actually have something on. */
export function daysWithSomethingOn(week: OnDay[]): number {
  return week.filter(d => d.events.length > 0).length;
}
