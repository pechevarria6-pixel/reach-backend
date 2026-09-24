// ─── A plan built before we knew the town ────────────────────────────────
// Rincón's trip was built when we held nothing there, so it named one place
// in twenty-four lines. The weekly map load then found twenty-seven verified
// places in Rincón, and the trip went on naming none — nobody had any reason
// to think a rebuild would be different. This says when it would be.

export interface Freshness { stale: boolean; held: number; named: number; lines: number }

/** Lines a named place could fill: not travel, not the stay, not a note. */
const FILLABLE = new Set(['restaurant', 'activity', 'event', 'bar', 'nightlife']);

/**
 * Stale when the saved days name few real places — under a third of the
 * lines a place could fill — and the town now holds at least twenty verified
 * places, enough that a rebuild would name some. Only while the days can
 * still change freely: planning or voting, not once bookings follow them.
 */
export function freshness(
  items: Array<{ type?: string | null; venue_name?: string | null }>,
  held: number,
  status: string | null | undefined,
): Freshness {
  const fillable = items.filter(i => FILLABLE.has(String(i.type ?? '')));
  const named = fillable.filter(i => String(i.venue_name ?? '').trim()).length;
  const open = status === 'planning' || status === 'voting';
  const stale = open && fillable.length >= 3 && named / fillable.length < 1 / 3 && held >= 20;
  return { stale, held, named, lines: fillable.length };
}
