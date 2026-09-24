// ─── What checkout does with approval's answer ───────────────────────────
// POST /api/bookings/[id]/approve answers with a status and a `code`, and the
// checkout screen read only the status: every 409 was "the price went up" —
// somebody already booking it, a double tap, a party that had changed, a
// hotel with no rooms — and "Yes, book it" just came back to the same
// screen. A 400 naming who still had to add their travel details was told
// "you don't need to do anything". Read here instead, by code, where a test
// can hold each answer to the screen it belongs on.

export type ApproveKind =
  | 'booked'        // 200: done (booked, or handed over)
  | 'notFunded'     // 402: not everybody has paid in
  | 'priceUp'       // 409 price_changed: ask, then approve with acceptNewPrice
  | 'reprice'       // 409 party_changed: price it again for who is going
  | 'busy'          // 409 already_in_progress: another press has it
  | 'unknown'       // 502 outcome_unknown, or no answer: it may be bought
  | 'refused';      // anything else: not booked, and here is why

export interface ApproveOutcome {
  kind: ApproveKind;
  message: string | null;
  /** The route's own code, so a refusal can carry its own way forward. */
  code: string | null;
  /** travellers_missing: who still has details to add. Names only. */
  who: string[];
  /** price_changed: the price agreed, and the one the provider gives now. */
  oldCents: number | null;
  newCents: number | null;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null);

export function approveOutcome(status: number, body: unknown): ApproveOutcome {
  const b = (body && typeof body === 'object' ? body : {}) as {
    code?: unknown; error?: unknown; who?: unknown; oldCents?: unknown; newCents?: unknown;
  };
  const said = typeof b.error === 'string' && b.error.trim() ? b.error.trim() : null;
  const out = (kind: ApproveKind, message: string | null): ApproveOutcome => ({
    kind, message,
    code: typeof b.code === 'string' ? b.code : null,
    who: Array.isArray(b.who) ? b.who.filter((w): w is string => typeof w === 'string' && w.trim().length > 0) : [],
    oldCents: num(b.oldCents),
    newCents: num(b.newCents),
  });
  if (status >= 200 && status < 300) return out('booked', null);
  if (status === 402) return out('notFunded', said);
  if (b.code === 'price_changed') return out('priceUp', said);
  if (b.code === 'party_changed') return out('reprice', said);
  if (b.code === 'already_in_progress') return out('busy', said);
  if (b.code === 'outcome_unknown') {
    return out('unknown', said ?? "We couldn't tell whether this went through. Don't book it again.");
  }
  // travellers_missing, unavailable, changed, provider_failed, and our own
  // 500s: the server's sentence says what happened and what to do.
  return out('refused', said ?? "This couldn't be booked just now. Nothing was bought.");
}

// ─── What somebody can do about each refusal ────────────────────────────
// Every refusal after a payment used to end on one screen with "Go back",
// whatever it was: a traveller with a missing birthday, a hotel that sold
// out, an airline that said no, and a booking somebody else was making at
// that moment all left the person in the same place with the same button.
// Each has its own way on, and the screen offers it next to the reason.

export type NextStep =
  /** Somebody's travel details are missing: their Profile takes them. */
  | 'details'
  /** The provider refused or our own read failed: approval can run again. */
  | 'retry'
  /** Sold out, or not bookable as it stands: the other options are the way on. */
  | 'other_options'
  /** Nothing to choose between on this screen: change it on the plan. */
  | 'plan'
  /** Somebody else is booking it, or it may have gone through: look again, never book again. */
  | 'recheck'
  /**
   * The provider refused the booking itself and approval marked the row
   * failed. Approval only runs rows still waiting, so "Try again" skipped it
   * and landed on the done screen; pricing the line again is the way on.
   */
  | 'price_again';

export function nextStepFor(o: ApproveOutcome, vertical: string | null | undefined): NextStep {
  if (o.kind === 'busy' || o.kind === 'unknown' || o.code === 'changed') return 'recheck';
  if (o.code === 'travellers_missing') return 'details';
  if (o.code === 'unavailable' || o.kind === 'reprice') {
    return vertical === 'hotel' || vertical === 'flight' ? 'other_options' : 'plan';
  }
  return 'retry';
}

/**
 * The problems still worth showing once the bookings have been read again.
 *
 * "Somebody else is booking this" is true for a moment. If the other press
 * finished while this one was running, the row now says confirmed, and the
 * screen should say that instead of a warning about a booking that is done.
 */
export function stillProblems<T extends { bookingId: string; step: NextStep }>(
  problems: T[], rowsAfter: { id?: string | null; status?: string | null }[] | null | undefined,
): T[] {
  const now = new Map((rowsAfter ?? []).map(r => [String(r.id), String(r.status ?? '')]));
  return problems
    .filter(p => p.step !== 'recheck' || !['confirmed', 'redirected'].includes(now.get(p.bookingId) ?? ''))
    // Read again, a row the provider refused is failed, and running approval
    // again would pass it by. Only the refusal that left it waiting — "we
    // couldn't check the price" — is worth another press of the same button.
    .map(p => (p.step === 'retry' && now.get(p.bookingId) === 'failed' ? { ...p, step: 'price_again' as NextStep } : p));
}
