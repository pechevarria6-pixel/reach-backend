// ─── What a hand-off says: "Finish on <provider> →" and "Booked it ✓" ────
// REACH-PILOT-GATE-2026-11-08.md §A4 and the business model §4A P3: a
// redirect item is paid for on the partner's site, and the member says so
// with "Booked it ✓". One set of words for every screen that shows one —
// the rail's card, checkout's list, and the after-payment screen — so the
// same booking is never "I've got it" on one screen and "Booked it" on the
// next.

export const BOOKED_IT = 'Booked it ✓';

/**
 * The question asked once somebody has been sent off to finish it. "Did you
 * get the table?" was asked of every hand-off — a concert ticket, a Vrbo, a
 * tour — which is a question about a restaurant put to somebody who just
 * bought a seat.
 */
export function confirmQuestion(vertical: string | null | undefined): string {
  switch (String(vertical ?? '')) {
    case 'restaurant': return 'Did you get the table?';
    case 'event': return 'Did you get the tickets?';
    case 'hotel': return 'Did you book the stay?';
    case 'flight': return 'Did you book the flight?';
    case 'activity': return 'Did you book it?';
    default: return 'Did you book it?';
  }
}
