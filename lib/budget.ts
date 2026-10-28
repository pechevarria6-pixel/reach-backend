// ─── What a trip costs, day by day ───────────────────────────────────────
// The Budget tab listed every priced line in one run with a total at the
// bottom, so a thirteen-night trip was a wall of forty numbers and no way to
// see that Thursday is the expensive one. A per-person total is the answer
// to "can I afford this"; the days are the answer to "where is it going",
// and that is the question somebody asks when the total is too high.

export interface BudgetRow {
  /** The slot label: "Day 3 · Evening", "To start", "Before you go". */
  d?: string | null;
  c?: number | null;
  [k: string]: unknown;
}

export interface DayGroup {
  key: string;
  label: string;
  rows: BudgetRow[];
  totalCents: number;
  /** Sort position. Before-you-go first, then days in order, then the rest. */
  order: number;
}

/**
 * The day part of a slot label.
 *
 * "Day 3 · Evening" is a day and a slot; the day is what groups. A night
 * out's slots — "To start", "The main event", "After" — are one evening and
 * have no day in them, which is correct and not a missing value.
 */
export function dayOf(time: unknown): { label: string; order: number } {
  const t = String(time ?? '').trim();
  if (!t) return { label: 'Everything else', order: 9_000 };
  if (/^before you go$/i.test(t)) return { label: 'Before you go', order: -1 };
  const m = /^day\s+(\d+)/i.exec(t);
  if (m) return { label: `Day ${m[1]}`, order: Number(m[1]) };
  // A night out, or anything else that is not a numbered day.
  return { label: 'The evening', order: 8_000 };
}

/** Priced rows, grouped by the day they fall on, in the order they happen. */
export function byDay(rows: BudgetRow[] | null | undefined): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const row of rows ?? []) {
    const { label, order } = dayOf(row?.d);
    const g = groups.get(label) ?? { key: label, label, rows: [], totalCents: 0, order };
    g.rows.push(row);
    g.totalCents += Number(row?.c) || 0;
    groups.set(label, g);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order);
}

/** The day that costs the most, when there is more than one to compare. */
export function dearestDay(groups: DayGroup[]): DayGroup | null {
  const days = groups.filter(g => g.order >= 0 && g.order < 8_000);
  if (days.length < 2) return null;
  return days.reduce((a, b) => (b.totalCents > a.totalCents ? b : a));
}

/**
 * The lines this person is not in for: a flight they came off ("I'll drive /
 * already have a flight"), a dinner they sit out — by the booking the line
 * carries, as the participation route lists them (imIn false). The Budget
 * tab charged a driver the full flight while "What you're in for" on the
 * same plan left it out: two figures for one person.
 *
 * Empty while who is in for what is unknown: nothing is taken out on a guess.
 */
export function linesYoureOff(
  bookings: { id?: unknown; itinerary_item_id?: unknown; status?: unknown }[] | null | undefined,
  items: { ref?: unknown; imIn?: unknown; dropped?: unknown }[] | null | undefined,
): Set<string> {
  const off = new Set((items ?? []).filter(i => i.imIn === false && !i.dropped).map(i => String(i.ref)));
  const lines = new Set<string>();
  for (const b of bookings ?? []) {
    if (['failed', 'cancelled'].includes(String(b.status))) continue;
    if (off.has(String(b.id)) && b.itinerary_item_id) lines.add(String(b.itinerary_item_id));
  }
  return lines;
}

// ─── What a Reach-booked line costs you, and the group ───────────────────
// A line's cost_cents is per person — the price for somebody flying — and
// the Budget tab used it for everybody: "altogether" was that fare times
// every head, drivers included. What each person really pays is on the
// booking rows: who is on each one (the participation route's inCount /
// imIn, from the opt-outs) and what the row costs the people on it now
// (priceCents, the party figure). A flight split per departure airport is
// several rows on one line; they add up.
//
// Before any booking row exists there is no opt-out yet, so nobody is known
// to be driving: the line's own per-person figure stands for you, and the
// group figure is the line's party_cents (per person × those flying, from
// lib/away-lines.ts) when it carries one — never cost × everyone.

export interface ShareItemLike {
  ref?: unknown; imIn?: unknown; dropped?: unknown;
  priceCents?: unknown; myCents?: unknown; inCount?: unknown; held?: unknown;
}
export interface LineLike { id?: unknown; cost_cents?: unknown; party_cents?: unknown; flying?: unknown }
export interface LineCost {
  /** Yours, in cents. 0 when you are off every booking on the line. */
  mine: number;
  /** Everybody's on it together, in cents. */
  group: number;
  /** You are not in for any of it. */
  off: boolean;
  /** Read off the booking rows, or the line's own estimate. */
  from: 'bookings' | 'line';
}

const cents = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

export function lineCosts(
  lines: LineLike[] | null | undefined,
  bookings: { id?: unknown; itinerary_item_id?: unknown; status?: unknown }[] | null | undefined,
  shareItems: ShareItemLike[] | null | undefined,
  heads: number,
): Map<string, LineCost> {
  const people = Math.max(1, Math.round(heads) || 1);
  const listed = new Map((shareItems ?? []).filter(s => !s.dropped).map(s => [String(s.ref), s]));
  const rowsOf = new Map<string, ShareItemLike[]>();
  for (const b of bookings ?? []) {
    if (['failed', 'cancelled'].includes(String(b.status)) || !b.itinerary_item_id) continue;
    const s = listed.get(String(b.id));
    if (!s) continue;
    const k = String(b.itinerary_item_id);
    rowsOf.set(k, [...(rowsOf.get(k) ?? []), s]);
  }
  const out = new Map<string, LineCost>();
  for (const line of lines ?? []) {
    const id = String(line.id);
    const per = cents(line.cost_cents) ?? 0;
    const rows = rowsOf.get(id);
    if (rows?.length) {
      let mine = 0, group = 0, inAny = false;
      for (const s of rows) {
        const price = cents(s.priceCents) ?? 0;
        const on = Math.max(0, cents(s.inCount) ?? 0);
        group += price;
        if (s.imIn === false) continue;
        inAny = true;
        // A held row is in nobody's charge yet (myCents 0); its share is
        // still what it would cost you, which is what a budget is for.
        const my = cents(s.myCents) ?? 0;
        mine += my > 0 ? my : on > 0 ? Math.round(price / on) : 0;
      }
      out.set(id, { mine, group, off: !inAny, from: 'bookings' });
      continue;
    }
    const party = cents(line.party_cents);
    const flying = cents(line.flying);
    const group = party != null && flying != null ? party : per * people;
    out.set(id, { mine: per, group, off: false, from: 'line' });
  }
  return out;
}
