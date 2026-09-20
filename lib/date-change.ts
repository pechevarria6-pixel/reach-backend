// ─── What moving a trip's dates costs ───────────────────────────────────
// Changing the dates of a trip nobody has booked anything for is a field
// edit. Changing them after there are bookings is not: a hotel is held for
// particular nights, and a restaurant table exists at a particular hour on a
// particular evening. Those do not follow the plan when the plan moves.
//
// So this works out what the change actually costs before anything is
// written, and the answer is shown to the organiser first. Nothing about a
// booking is silently invalidated: a table somebody reserved on their own
// account can only be moved by them, on that platform, and the honest thing
// is to say whose it is and ask.

export interface BookingLike {
  id?: string;
  vertical?: string | null;
  status?: string | null;
  mode?: string | null;
  provider?: string | null;
  detail?: unknown;
  /** Who reserved it, for the rows a member booked themselves. */
  fulfilled_by?: string | null;
  booked_by?: string | null;
}

export type Consequence =
  /** Somebody has to go back to the platform and move it themselves. */
  | 'rebook_yourself'
  /** Held with a provider we can re-run: hotels, flights. */
  | 'rebook_through_reach'
  /** A price for dates that no longer exist. Asked again, not honoured. */
  | 'requote'
  /** Failed, cancelled, or otherwise nothing to disturb. */
  | 'none';

export interface Impact {
  bookingId?: string;
  what: string;
  consequence: Consequence;
  /** The member who must act, when it is one person's to do. */
  whose?: string | null;
}

const SETTLED = new Set(['confirmed', 'redirected', 'pending']);
const PROVISIONAL = new Set(['quoted', 'awaiting_approval']);

/**
 * What each kind of booking is called out loud. `vertical` is how this
 * codebase talks to itself — the vocabulary check caught "your ${vertical}"
 * in the fallback below, which would have put "your restaurant" in a
 * sentence about somebody's dinner.
 */
const KIND: Record<string, string> = {
  restaurant: 'your table',
  hotel: 'your room',
  flight: 'your flight',
  activity: 'the activity you booked',
  event: 'your tickets',
};

/** The booking's own name for itself, for a sentence somebody reads. */
function nameOf(booking: BookingLike): string {
  const d = booking.detail;
  if (typeof d === 'string' && d.trim()) return d.trim().split(' · ')[0];
  if (d && typeof d === 'object') {
    const o = d as { title?: unknown; name?: unknown };
    for (const v of [o.title, o.name]) if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return KIND[String(booking.vertical ?? '')] ?? 'something on this trip';
}

/**
 * What each existing booking means for a date change.
 *
 * The distinction that matters is who can move it. A member booked their own
 * table on their own account with their own card — Reach has no standing to
 * change it and could not if it wanted to, so that row names the person. A
 * hotel Reach holds can be re-run through the provider. A quote is just a
 * price and is asked again.
 */
export function impactOfDateChange(bookings: BookingLike[]): Impact[] {
  return (bookings ?? []).map((b): Impact => {
    const status = String(b.status ?? '');
    const what = nameOf(b);

    if (!SETTLED.has(status) && !PROVISIONAL.has(status)) {
      return { bookingId: b.id, what, consequence: 'none' };
    }

    if (PROVISIONAL.has(status)) {
      // A price for dates that are being changed is not a price for the new
      // ones. Nobody is charged against it, so it can simply be asked again.
      return { bookingId: b.id, what, consequence: 'requote' };
    }

    const bookedThemselves = b.mode === 'redirect'
      || b.provider === 'resy' || b.provider === 'opentable' || b.provider === 'tock';

    if (bookedThemselves) {
      return {
        bookingId: b.id,
        what,
        consequence: 'rebook_yourself',
        whose: b.fulfilled_by ?? b.booked_by ?? null,
      };
    }

    return { bookingId: b.id, what, consequence: 'rebook_through_reach' };
  });
}

/** One line per thing the organiser is about to disturb. */
export function describeImpact(impacts: Impact[]): string[] {
  const say: Record<Consequence, (what: string) => string> = {
    rebook_yourself: what => `${what} was booked on the restaurant's own platform — whoever reserved it has to move it there.`,
    rebook_through_reach: what => `${what} is held for the old dates and has to be booked again.`,
    requote: what => `${what} was only priced, not booked — we'll price it again for the new dates.`,
    none: what => `${what} is not affected.`,
  };
  return impacts
    .filter(i => i.consequence !== 'none')
    .map(i => say[i.consequence](i.what));
}

/** Is this a change worth warning about at all? */
export function needsConfirmation(impacts: Impact[]): boolean {
  return impacts.some(i => i.consequence !== 'none');
}

/** How many members each candidate window still works for, after a move. */
export function stillWorksFor(
  windows: { userId: string; start: string; end: string }[],
  start: string,
  end: string,
): { works: string[]; out: string[] } {
  const byMember = new Map<string, { start: string; end: string }[]>();
  for (const w of windows ?? []) {
    if (!byMember.has(w.userId)) byMember.set(w.userId, []);
    (byMember.get(w.userId) as { start: string; end: string }[]).push(w);
  }
  const works: string[] = [];
  const out: string[] = [];
  for (const [userId, ranges] of byMember) {
    // Free for the whole trip, not merely overlapping part of it — being
    // free for two nights of a week is not being able to come.
    const covers = ranges.some(r => r.start <= start && r.end >= end);
    (covers ? works : out).push(userId);
  }
  return { works, out };
}
