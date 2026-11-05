// ─── What is on, by day, for Discover's Upcoming list ────────────────────
// Discover had one list, nearest first, holding museums, markets and gigs
// alike. In Raleigh 26 of 66 cards had a date, and 17 of them sat behind
// forty venue cards — so "what's on" meant scrolling past what is merely open.
// A week strip above it answered the same question in a second window and
// disagreed with the list, and each event appeared up to four times on one
// screen.
//
// This is the one answer. Dated things on their day, weekly things once
// under their next night, grouped by day and ordered by time, then distance.
// Nothing here invents a fact: a time is shown only when the listing gave
// one, a distance only when one is held, and a listing whose own words say
// its date is not set yet is not shown as on.
//
// Pure, so the rules can be tested at any hour of any day.

/** The fields of a Discover card this reads. */
export interface UpcomingItem {
  /** The card's own id. */
  id: string;
  /** The finding's id, as the week builder (lib/discovery/whats-on.ts) carries it. */
  findingId?: string | null;
  title: string;
  /** The line under the title as the source wrote it, read only for "date to be set". */
  sub?: string | null;
  venue?: string | null;
  /** ISO date for a one-off. */
  date?: string | null;
  /** "12 mi", as the source measured it. */
  dist?: string | null;
  /** "19:30" or "19:30:00", local to the event, when the listing gave one. */
  time?: string | null;
}

/** A day of the week builder's answer, as /api/nearby sends it. */
export interface WeekDay {
  day: string;
  weekday?: number;
  events: { id?: string | null; recurring?: boolean }[];
}

export interface UpcomingRow<T> {
  item: T;
  day: string;
  recurring: boolean;
  /** "7:30 PM", "Every Thu", or null when nothing is held. */
  when: string | null;
  /** Miles, when held. */
  miles: number | null;
}

export interface UpcomingSection<T> {
  day: string;
  /** "Tonight", "Tomorrow", "Sat 8", "Sat, Nov 22". */
  label: string;
  /** "Thu, Nov 5" — said beside "Today"/"Tomorrow", which carry no date of their own. */
  dateWords: string;
  /** Inside the seven days the day-roll draws. */
  inWeek: boolean;
  /** Within FURTHER_MILES, or with no distance held. */
  near: UpcomingRow<T>[];
  /** Further than FURTHER_MILES: behind "Further out · N". */
  further: UpcomingRow<T>[];
}

/** Past this, a row is behind "Further out". The day sheet listed towns 100 miles off as tonight's. */
export const FURTHER_MILES = 25;
/**
 * A day with nothing inside FURTHER_MILES shows this many of its nearest
 * rows anyway, each with its distance on the card. Today and Tomorrow opened
 * as a bare "Further out · 19" with no card on the screen (QA walk,
 * 2026-11-05): an empty day reads as nothing on, which was not true.
 */
export const NEAREST_WHEN_EMPTY = 3;
/** The days the day-roll draws, today included. */
export const WEEK_DAYS = 7;

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function addDays(iso: string, n: number): string {
  const d = utc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000);
}

export function weekdayShort(iso: string): string {
  return WEEKDAY[utc(iso).getUTCDay()];
}

export function dateNumber(iso: string): number {
  return utc(iso).getUTCDate();
}

/** "Thu, Nov 5". */
export function dateWords(iso: string): string {
  const d = utc(iso);
  return `${WEEKDAY[d.getUTCDay()]}, ${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * The day as somebody would say it: "Today" before five and "Tonight" from
 * five, "Tomorrow", the weekday and date inside the week, and the month too
 * after it. `today` is the reader's own day (lib/calendar.ts), never UTC's.
 */
export function dayHeading(day: string, today: string, hour: number): string {
  const n = daysBetween(today, day);
  if (n === 0) return hour >= 17 ? 'Tonight' : 'Today';
  if (n === 1) return 'Tomorrow';
  if (n > 1 && n < WEEK_DAYS) return `${weekdayShort(day)} ${dateNumber(day)}`;
  return dateWords(day);
}

/** "19:30:00" → "7:30 PM". Null for anything that is not a clock time. */
export function clockWords(time: unknown): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:${String(min).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Miles from the source's "12 mi" (or "5 km"). Null when nothing is held. */
export function milesOf(dist: unknown): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(mi|km)\b/i.exec(String(dist ?? ''));
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2].toLowerCase() === 'km' ? n * 0.621371 : n;
}

const NOT_YET = String.raw`(?:TBA|TBD|TBC|to[\s-]+be[\s-]+(?:determined|decided|announced|confirmed))`;
/**
 * The date, said not to be set: "date TBD", "dates to be announced", "a
 * to-be-determined date", or a when-line that is nothing but "TBA". Only the
 * date — "Opponent TBD", "special guest TBA" and "Venue TBC" are about who or
 * where, on a listing with a real date and a ticket link, and reading them as
 * the date dropped a dated game from Discover altogether.
 */
const UNSET_DATE = new RegExp(
  String.raw`\b(?:dates?|day)\s*(?:is\s+|are\s+|still\s+)?(?:[:\-–—]\s*)?${NOT_YET}\b`
  + String.raw`|\b${NOT_YET}[\s-]+(?:dates?|day)\b`,
  'i',
);
const ONLY_NOT_YET = new RegExp(String.raw`^\s*${NOT_YET}\s*$`, 'i');

/** Whether these words say the date is not set, wherever in the listing they sit. */
export function saysDateUnset(text: unknown): boolean {
  const t = String(text ?? '');
  return UNSET_DATE.test(t) || t.split(' · ').some(part => ONLY_NOT_YET.test(part));
}

/** Whether the words name a year after `year` and never `year` itself. */
function laterYearOnly(text: string, year: number): boolean {
  if (!Number.isFinite(year)) return false;
  const years = [...text.matchAll(/\b(20\d{2})\b/g)].map(m => Number(m[1]));
  return years.some(y => y > year) && !years.includes(year);
}

/**
 * Whether the listing's own words say its date is not set — "To be held in
 * 2027 on a to-be-determined date" was shown under this Thursday. A year
 * named later than the one it is filed under, without its own year beside
 * it, is the same thing said another way.
 */
export function dateNotSet(text: unknown, filedUnder: string): boolean {
  const t = String(text ?? '');
  return saysDateUnset(t) || laterYearOnly(t, Number(filedUnder.slice(0, 4)));
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const WEEKDAY_WORD = /^(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day)?$|^(?:wednes|satur)day$/;

/** A title's words, without the year or weekday a ticket product adds to it. */
function titleWords(title: unknown): string[] {
  return norm(title).split(' ').filter(w => w && !/^(?:19|20)\d{2}$/.test(w) && !WEEKDAY_WORD.test(w));
}

/**
 * Two rows that are one listing: the same day and venue, and titles that are
 * the same, or that open with the same words making up most of the shorter
 * one ("holly day fair" of "holly day fair super shopper"). Two acts on one
 * bill ("Comedy Night: John Smith", "Comedy Night: Jane Doe") share too
 * little to be one, and two performances at different held times are two.
 */
function sameListing(a: { item: UpcomingItem; day: string; clock: string | null }, b: { item: UpcomingItem; day: string; clock: string | null }): boolean {
  if (a.day !== b.day || norm(a.item.venue) !== norm(b.item.venue)) return false;
  if (norm(a.item.title) === norm(b.item.title)) return true;
  if (!norm(a.item.venue)) return false;
  if (a.clock && b.clock && a.clock !== b.clock) return false;
  const x = titleWords(a.item.title);
  const y = titleWords(b.item.title);
  let shared = 0;
  while (shared < x.length && shared < y.length && x[shared] === y[shared]) shared++;
  return shared >= 2 && shared >= 0.6 * Math.min(x.length, y.length);
}

function byTimeThenDistance<T>(a: UpcomingRow<T> & { clock: string | null }, b: UpcomingRow<T> & { clock: string | null }): number {
  if (a.clock && b.clock && a.clock !== b.clock) return a.clock < b.clock ? -1 : 1;
  if (!!a.clock !== !!b.clock) return a.clock ? -1 : 1;
  if (a.miles != null && b.miles != null && a.miles !== b.miles) return a.miles - b.miles;
  if ((a.miles == null) !== (b.miles == null)) return a.miles == null ? 1 : -1;
  return 0;
}

/**
 * The Upcoming list: one section per day that holds something, in day
 * order, each with its rows in time order then nearest first.
 *
 * `candidates` is every card that is a dated or weekly thing, shown or not
 * — so the caller can file everything else under Places, and a listing
 * dropped for "date to be set" is not then offered as a place.
 */
export function upcomingSections<T extends UpcomingItem>(
  items: T[] | null | undefined,
  week: WeekDay[] | null | undefined,
  today: string,
  hour: number,
): { sections: UpcomingSection<T>[]; candidates: Set<string> } {
  const candidates = new Set<string>();
  if (!ISO.test(today)) return { sections: [], candidates };
  const rows: (UpcomingRow<T> & { clock: string | null })[] = [];

  for (const item of items ?? []) {
    if (!item?.date || !ISO.test(item.date)) continue;
    candidates.add(item.id);
    if (item.date < today) continue;
    if (dateNotSet(`${item.title} ${item.sub ?? ''}`, item.date)) continue;
    const clock = /^(\d{1,2}):(\d{2})/.test(String(item.time ?? '')) ? String(item.time).slice(0, 5).padStart(5, '0') : null;
    rows.push({ item, day: item.date, recurring: false, when: clockWords(item.time), miles: milesOf(item.dist), clock });
  }

  // A weekly thing once, under its next night: the week builder repeats it
  // onto each of its days, which is what put the same quiz on four of them.
  const byFinding = new Map<string, T>();
  for (const item of items ?? []) if (item?.findingId && !item.date) byFinding.set(String(item.findingId), item);
  const placed = new Set<string>();
  for (const d of [...(week ?? [])].sort((a, b) => (a.day < b.day ? -1 : 1))) {
    if (!d?.day || !ISO.test(d.day) || d.day < today) continue;
    for (const e of d.events ?? []) {
      if (!e?.recurring || !e.id) continue;
      const item = byFinding.get(String(e.id));
      if (!item) continue;
      candidates.add(item.id);
      if (placed.has(item.id)) continue;
      placed.add(item.id);
      if (dateNotSet(`${item.title} ${item.sub ?? ''}`, d.day)) continue;
      rows.push({ item, day: d.day, recurring: true, when: `Every ${weekdayShort(d.day)}`, miles: milesOf(item.dist), clock: null });
    }
  }

  // Neither dated nor weekly, but its own words say it is not on yet — the
  // date is to be set, or it names only a later year ("Bobbin Lace: The
  // Spring 2027 class"). Not a place to go now either: filed under Places it
  // was offered as one, on a card that does not show the line saying so.
  for (const item of items ?? []) {
    if (!item || candidates.has(item.id) || (item.date && ISO.test(item.date))) continue;
    if (dateNotSet(`${item.title} ${item.sub ?? ''}`, today)) candidates.add(item.id);
  }

  // The same thing twice — from the live lane and the copy we kept, or one
  // fair sold as several products ("Holly Day Fair Sip & Shop", "2026 Holly
  // Day Fair-Thursday", "Holly Day Fair-Super Shopper", all at Crown Expo
  // that Thursday) — is one row: the one whose title names the whole thing.
  const once: typeof rows = [];
  for (const r of rows) {
    const i = once.findIndex(o => sameListing(o, r));
    if (i < 0) once.push(r);
    else if (titleWords(r.item.title).length < titleWords(once[i].item.title).length) once[i] = r;
  }

  const days = [...new Set(once.map(r => r.day))].sort();
  const sections = days.map((day): UpcomingSection<T> => {
    const all = once.filter(r => r.day === day).sort(byTimeThenDistance);
    const strip = ({ clock: _c, ...row }: UpcomingRow<T> & { clock: string | null }): UpcomingRow<T> => row;
    let near = all.filter(r => r.miles == null || r.miles <= FURTHER_MILES);
    let further = all.filter(r => r.miles != null && r.miles > FURTHER_MILES);
    if (!near.length && further.length) {
      const nearest = [...further].sort((a, b) => (a.miles ?? 0) - (b.miles ?? 0)).slice(0, NEAREST_WHEN_EMPTY);
      const lifted = new Set(nearest);
      near = all.filter(r => lifted.has(r));
      further = further.filter(r => !lifted.has(r));
    }
    return {
      day,
      label: dayHeading(day, today, hour),
      dateWords: dateWords(day),
      inWeek: daysBetween(today, day) < WEEK_DAYS,
      near: near.map(strip),
      further: further.map(strip),
    };
  });
  return { sections, candidates };
}

/** Every row a section holds, near and further out. */
export function rowsIn(section: UpcomingSection<unknown>): number {
  return section.near.length + section.further.length;
}

export interface RollDay {
  day: string;
  weekday: string;
  date: number;
  /** Rows under that day's header; 0 is a quiet day, drawn and disabled. */
  count: number;
}

/**
 * The day-roll: each of the seven days, quiet ones included — a quiet day is
 * our gap, said as one, never a day skipped — and how many rows sit after
 * the week.
 */
export function dayRoll(sections: UpcomingSection<unknown>[], today: string): { days: RollDay[]; later: number; laterDay: string | null } {
  if (!ISO.test(today)) return { days: [], later: 0, laterDay: null };
  const days: RollDay[] = [];
  for (let i = 0; i < WEEK_DAYS; i++) {
    const day = addDays(today, i);
    const s = sections.find(x => x.day === day);
    days.push({ day, weekday: weekdayShort(day), date: dateNumber(day), count: s ? rowsIn(s) : 0 });
  }
  const after = sections.filter(s => !s.inWeek);
  return { days, later: after.reduce((n, s) => n + rowsIn(s), 0), laterDay: after[0]?.day ?? null };
}

/**
 * The first `limit` near rows, and how many more there are. A section cut
 * part-way keeps its "Further out" for when the rest is opened, so the
 * count on "Show N more" is exactly what appears when it is tapped.
 */
export function capSections<T>(sections: UpcomingSection<T>[], limit: number): { sections: UpcomingSection<T>[]; more: number } {
  let left = Math.max(0, limit);
  let more = 0;
  const out: UpcomingSection<T>[] = [];
  for (const s of sections) {
    if (left <= 0) {
      more += s.near.length;
      continue;
    }
    if (s.near.length <= left) {
      out.push(s);
      left -= s.near.length;
    } else {
      out.push({ ...s, near: s.near.slice(0, left), further: [] });
      more += s.near.length - left;
      left = 0;
    }
  }
  return { sections: out, more };
}
