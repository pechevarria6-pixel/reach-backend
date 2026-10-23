// ─── What survives rebuilding the days ───────────────────────────────────
// Saving an itinerary replaces it wholesale, so whatever a rebuild does not
// carry over is deleted. That made "Plan my days for me" destructive in a way
// nobody could see: the generate path built
//
//   [...fixedCostRows(trip), ...itineraryRows(days)]
//
// and the rebuild path built only the second half, so the flights, the stay
// and the airport transfers — the three lines on a trip that Reach can
// actually book — disappeared the first time somebody rebuilt their days.
//
// The damage is in the table. Moab: thirteen nights, $1,474 a head,
// thirty-nine lines, not one of them bookable, and $893 of flights and
// accommodation missing from the plan's own budget screen. "Book everything"
// on that trip books nothing, because there is nothing left to book.
//
// Rebuilding the day-by-day plan is not a reason to unbook the trip. These
// belong to the trip; the days belong to the days.

/** Only the fields this decision reads. */
export interface RebuildItem {
  time?: string | null;
  type?: string | null;
  booking_mode?: string | null;
}

/**
 * The lines a rebuild must carry over.
 *
 * Keyed on both the slot and the type, because "Before you go" is where
 * `fixedCostRows` puts them and the type is what makes them bookable. Either
 * alone would be looser than it needs to be: a restaurant is never "Before
 * you go", and a walk is never a flight.
 */
const CARRIED = new Set(['flight', 'hotel', 'transport']);

export function carriedOverOnRebuild<T extends RebuildItem>(items: T[] | null | undefined): T[] {
  return (items ?? []).filter(i =>
    i?.time === 'Before you go' && CARRIED.has(String(i?.type ?? '')));
}

/**
 * The whole itinerary after a rebuild: what the trip already had, then the
 * new days.
 *
 * Order matters on the screen — the flight comes before the first morning —
 * and it is the order the generate path produces, so both paths now end with
 * the same shape.
 */
export function afterRebuild<T extends RebuildItem>(existing: T[] | null | undefined, freshDays: T[]): T[] {
  return [...carriedOverOnRebuild(existing), ...(freshDays ?? [])];
}

// ─── An away plan rebuilt keeps getting there and a bed ──────────────────
// Carrying the lines over only keeps what was there. Moab was already
// missing its flights and its stay when it was rebuilt, and a rebuild that
// faithfully carried over nothing left it with nothing. An away plan
// (lib/away.ts) always has a way there and somewhere to sleep every night
// (lib/away-lines.ts), so a rebuild of one that has lost either puts the
// missing line back — never twice, and never over one somebody has.

/** Which of the two an away plan's existing lines are missing. */
export function awayMissing(existing: RebuildItem[] | null | undefined, opts: { nights: number }): Array<'transport' | 'lodging'> {
  const kept = carriedOverOnRebuild(existing);
  const missing: Array<'transport' | 'lodging'> = [];
  if (!kept.some(i => i.type === 'flight')) missing.push('transport');
  if (opts.nights >= 1 && !kept.some(i => i.type === 'hotel')) missing.push('lodging');
  return missing;
}

/**
 * The rebuilt itinerary of an away plan: what it already had, the line for
 * anything it was missing — from `restore`, the server's away lines
 * (`restore` on the generate response, already client rows) — then the new
 * days. A plan that has both is exactly afterRebuild.
 */
export function afterAwayRebuild<T extends RebuildItem>(
  existing: T[] | null | undefined, freshDays: T[], restore: T[] | null | undefined, opts: { nights: number },
): T[] {
  const kept = carriedOverOnRebuild(existing);
  const missing = new Set(awayMissing(existing, opts));
  const hasCar = kept.some(i => i.type === 'transport');
  const back = (restore ?? []).filter(l =>
    l?.time === 'Before you go' && (
      (missing.has('transport') && l.type === 'flight')
      // The car from the airport goes with the flight it meets — unless the
      // plan kept one of its own.
      || (missing.has('transport') && l.type === 'transport' && !hasCar)
      || (missing.has('lodging') && l.type === 'hotel')));
  return [...kept, ...back, ...(freshDays ?? [])];
}
