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
  | 'terms'         // 409 terms_required: a table held, not booked — show its policy and terms, approve with holdId + accept
  | 'otherTime'     // 409 other_time: a table — not at that time; approve with one of offeredTimes
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
  /**
   * terms_required: the held table (lib/booking/tables/flow.ts publicHold) —
   * its policy, the platform's terms and any fee, shown before the button,
   * and the button's exact words. Approve again with { holdId, accept }.
   */
  hold?: { holdId: string; platformLabel?: string; expiresAt?: string; cancellationPolicy?: string | null; terms?: { version: string } | null } | null;
  button?: string | null;
  /** other_time: the times the table is offered at instead, HH:MM. */
  offeredTimes?: string[];
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null);

export function approveOutcome(status: number, body: unknown): ApproveOutcome {
  const b = (body && typeof body === 'object' ? body : {}) as {
    code?: unknown; error?: unknown; who?: unknown; oldCents?: unknown; newCents?: unknown;
    hold?: unknown; button?: unknown; offeredTimes?: unknown;
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
  if (b.code === 'terms_required' && b.hold && typeof b.hold === 'object' && typeof (b.hold as { holdId?: unknown }).holdId === 'string') {
    return { ...out('terms', said), hold: b.hold as ApproveOutcome['hold'], button: typeof b.button === 'string' ? b.button : null };
  }
  if (b.code === 'other_time' && Array.isArray(b.offeredTimes)) {
    const times = b.offeredTimes.filter((t): t is string => typeof t === 'string' && /^\d{2}:\d{2}$/.test(t));
    if (times.length) return { ...out('otherTime', said), offeredTimes: times };
  }
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
  | 'price_again'
  /**
   * A table waiting on the person: a held table's terms to accept, or an
   * offered time to take. Approve it again with { holdId, accept } or time.
   */
  | 'answer';

// ─── A table's answer, in approval's words ──────────────────────────────
// A table goes through lib/reservations/reserve.ts, whose codes are finer
// than approval's. Folding every one of them into 'unavailable' made an
// expired hold, OpenTable rate-limiting us and a missing phone number all
// read as "the restaurant has no table" and pointed at the plan. Only the
// codes approval already has a name for are renamed; the rest are kept, and
// 'unavailable' stays the one answer that is a fact about the restaurant.
const TABLE_RENAMED: Record<string, string> = {
  in_progress: 'already_in_progress', calling: 'already_in_progress',
};

export function tableApproveCode(reserveCode: string, status: number): string {
  return TABLE_RENAMED[reserveCode] ?? (reserveCode || (status >= 500 ? 'provider_failed' : 'refused'));
}

/** Where each of reserve's own refusals goes next (the rest: approval's own rules below). */
const TABLE_STEP: Record<string, NextStep> = {
  // Held and lost: approving again holds it afresh.
  hold_expired: 'retry', hold_missing: 'retry', slot_gone: 'retry',
  // Our side, or the platform's, never the restaurant's.
  rate_limited: 'retry', provider_failed: 'retry', platform_down: 'retry', store_error: 'retry',
  details_missing: 'details',
  // Something to answer before it can go: a time, the terms, "booked it yourself?".
  missing_facts: 'answer', terms_not_accepted: 'answer', ask_first: 'answer',
  // Somebody else's, or it may be booked: look again, never book again.
  booked_elsewhere: 'recheck', already_settled: 'recheck', pending_card: 'recheck',
  // Not Reach's to book as it stands, and pressing again would not change
  // that: the plan holds the hand-off — their page, their number.
  path_unavailable: 'plan', not_bookable_here: 'plan', not_on_platform: 'plan', disabled: 'plan', auth: 'plan',
  needs_card: 'plan', call_refused: 'plan', no_change: 'plan', duplicate: 'plan', not_a_table: 'plan',
  date_outside_trip: 'plan', date_past: 'plan', time_past: 'plan', party_size: 'plan', bad_request: 'plan',
};

export function nextStepFor(o: ApproveOutcome, vertical: string | null | undefined): NextStep {
  if (o.kind === 'busy' || o.kind === 'unknown' || o.code === 'changed') return 'recheck';
  if (o.kind === 'terms' || o.kind === 'otherTime') return 'answer';
  if (o.code === 'travellers_missing') return 'details';
  if (vertical === 'restaurant' && o.code && TABLE_STEP[o.code]) return TABLE_STEP[o.code];
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
