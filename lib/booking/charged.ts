// ─── What a trip is actually paying for ──────────────────────────────────
// A booking that failed or was cancelled costs nothing, and neither does one
// somebody has chosen to hold off on: it keeps its quote (status 'quoted')
// so it can be booked later at a glance, but it is not in the total, not in
// anybody's share and not approved with the rest. Every sum of money over a
// plan's bookings reads this one filter, so "held" cannot mean "not booked"
// on one screen and "charged for" on another.
export const NOT_CHARGED = '("failed","cancelled","quoted")';
