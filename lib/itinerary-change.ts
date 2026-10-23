// ─── Who may change a line of a plan, and when ──────────────────────────
// The owner's decision of 25 September (decision 14): before a group trip is
// locked in, any member may suggest a different pick for a line and the
// others may 👍 it — the organiser applies it. After Lock it in, only the
// organiser changes a line, or the person who booked that line; members no
// longer suggest. A trip for one has nobody to suggest to: its one person
// changes it, and no suggestion is ever stored for it.
//
// Pure, so the rule can be read and tested in one place. The routes under
// app/api/plans/[planId]/itinerary/[itemId] and the options route ask it.

/**
 * Whether a plan is locked in: the same rule lib/next-action.ts uses for its
 * rail, so the dot that says "Lock in" is done and the Change sheet that
 * stops offering "Suggest" cannot disagree.
 *
 *   status past planning and voting (approved, booked, completed), or
 *   anything moving: a booking row past 'quoted', or money collected.
 *
 * Cancelled rows are history (lib/checkout.ts dedupe) and count for nothing.
 */
export const LOCKED_STATUSES = new Set(['approved', 'booked', 'completed']);

export function lockedIn(
  planStatus: unknown,
  bookings: { status?: unknown }[] | null | undefined,
  collectedCents: unknown,
): boolean {
  if (LOCKED_STATUSES.has(String(planStatus ?? ''))) return true;
  const live = (bookings ?? []).filter(b => b?.status !== 'cancelled');
  if (live.some(b => b.status !== 'quoted')) return true;
  const c = Number(collectedCents);
  return Number.isFinite(c) && c > 0;
}

export type Right =
  /** Change it now. */
  | 'apply'
  /** Before lock, in a group, not the organiser: suggest it instead. */
  | 'suggest'
  /** After lock, neither the organiser nor the person who booked this line. */
  | 'locked_out';

export interface Who {
  solo: boolean;
  organiser: boolean;
  locked: boolean;
  /** This person booked the line in question. */
  bookedIt?: boolean;
}

/**
 * Whether this person is "the person who booked that line".
 *
 * Not `booked_by`: that is whoever created the row, and the Book tab creates
 * the hotel, flight and Reach-booked rows (POST /bookable) as whichever member
 * happens to open it first — which handed that member the right to change the
 * group's hotel after Lock it in. The person who booked it is the one who
 * said they did, on the seller's own site: `fulfilled_by`, written by "I've
 * got it" (the confirmation route) and PATCH /api/bookings/[id]. A row Reach
 * bought itself was booked by the group, through the organiser's Lock it in,
 * so nobody holds it as theirs.
 */
export function bookedBy(
  booking: { mode?: unknown; provider?: unknown; fulfilled_by?: unknown } | null | undefined,
  userId: string,
): boolean {
  if (!booking || !userId) return false;
  const theirs = booking.mode === 'redirect' || booking.mode === 'concierge' || booking.provider === 'concierge';
  return theirs && booking.fulfilled_by === userId;
}

export function changeRight(w: Who): Right {
  if (w.solo || w.organiser) return 'apply';
  if (w.locked) return w.bookedIt ? 'apply' : 'locked_out';
  return 'suggest';
}

/** Whether suggestions are open on this plan at all. Null when they are; else why not. */
export function suggestionsClosed(w: Pick<Who, 'solo' | 'locked'>): 'solo' | 'locked' | null {
  if (w.solo) return 'solo';
  if (w.locked) return 'locked';
  return null;
}

/**
 * What a person is told when they cannot make the change they asked for.
 * Named for the organiser where we know who that is; group copy only, since
 * a trip for one always has the right ('apply') and never reads these.
 */
export function refusal(right: Right, organiserFirstName: string | null): string | null {
  const who = organiserFirstName || 'The organiser';
  if (right === 'suggest') return `${who} makes changes to the plan. Suggest it instead and the group can 👍 it.`;
  if (right === 'locked_out') return `This trip is locked in, so ${organiserFirstName || 'the organiser'} makes changes now — ask them.`;
  return null;
}

// ─── Suggestions, as a list to show ─────────────────────────────────────

export interface SuggestionRow {
  id: string;
  item_id: string;
  suggested_by: string;
  candidate_ref: string;
  candidate: Record<string, unknown> | null;
  note: string | null;
  status: string;
  created_at: string;
}
export interface VoteRow { suggestion_id: string; user_id: string }

export interface ShownSuggestion {
  id: string;
  itemId: string;
  candidateRef: string;
  candidate: Record<string, unknown>;
  note: string | null;
  suggestedBy: { id: string; name: string | null };
  /** 👍 count. The suggester's own suggestion counts as their 👍. */
  votes: number;
  voters: string[];
  mine: boolean;
  votedByMe: boolean;
  createdAt: string;
}

/**
 * Open suggestions with their 👍, most liked first, then oldest first.
 *
 * Suggesting something is liking it, so the suggester is counted once
 * whether or not a vote row exists for them — "Sam suggests Bar X · 👍 1",
 * never "· 👍 0" under Sam's own idea.
 */
export function shownSuggestions(
  rows: SuggestionRow[],
  votes: VoteRow[],
  me: string,
  names: Map<string, string | null>,
): ShownSuggestion[] {
  return rows
    .filter(r => r.status === 'open')
    .map(r => {
      const voters = [...new Set([r.suggested_by, ...votes.filter(v => v.suggestion_id === r.id).map(v => v.user_id)])];
      return {
        id: r.id,
        itemId: r.item_id,
        candidateRef: r.candidate_ref,
        candidate: r.candidate ?? {},
        note: r.note,
        suggestedBy: { id: r.suggested_by, name: names.get(r.suggested_by) ?? null },
        votes: voters.length,
        voters,
        mine: r.suggested_by === me,
        votedByMe: voters.includes(me),
        createdAt: r.created_at,
      };
    })
    .sort((a, b) => b.votes - a.votes || a.createdAt.localeCompare(b.createdAt));
}
