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

export interface ApproveOutcome { kind: ApproveKind; message: string | null }

export function approveOutcome(status: number, body: unknown): ApproveOutcome {
  const b = (body && typeof body === 'object' ? body : {}) as { code?: unknown; error?: unknown };
  const said = typeof b.error === 'string' && b.error.trim() ? b.error.trim() : null;
  if (status >= 200 && status < 300) return { kind: 'booked', message: null };
  if (status === 402) return { kind: 'notFunded', message: said };
  if (b.code === 'price_changed') return { kind: 'priceUp', message: said };
  if (b.code === 'party_changed') return { kind: 'reprice', message: said };
  if (b.code === 'already_in_progress') return { kind: 'busy', message: said };
  if (b.code === 'outcome_unknown') {
    return { kind: 'unknown', message: said ?? "We couldn't tell whether this went through. Don't book it again." };
  }
  // travellers_missing, unavailable, changed, provider_failed, and our own
  // 500s: the server's sentence says what happened and what to do.
  return { kind: 'refused', message: said ?? "This couldn't be booked just now. Nothing was bought." };
}
