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
