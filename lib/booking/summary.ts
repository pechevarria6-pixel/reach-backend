// ─── One email when a trip's booking round is over ───────────────────────
// The confirmation used to go after each single booking, headed "You're
// booked — everything for X is confirmed" over a hotel while the flight was
// still to go. Now it goes once, when nothing is waiting on a provider or a
// yes, and says what actually happened: what is booked, what did not go
// through, and what was held back for later.

export interface SummaryRow {
  status: string;
  vertical?: string | null;
  detail?: string | null;
  provider_ref?: string | null;
}

export interface SummaryLine { label: string; detail: string | null; confirmation: string | null }

/** Still being decided: a yes not given, a provider not answered. */
const WAITING = new Set(['awaiting_approval', 'booking', 'pending']);

function line(r: SummaryRow): SummaryLine {
  const v = String(r.vertical ?? '');
  return {
    label: v ? `${v[0].toUpperCase()}${v.slice(1)}` : 'Booking',
    detail: r.detail || null,
    confirmation: r.provider_ref || null,
  };
}

/**
 * Null while anything is still waiting, or when nothing was booked — there
 * is no round to sum up. Held rows ('quoted') are the person's own choice to
 * wait, so they do not keep the summary back; they are listed as held.
 */
export function bookingSummary(rows: SummaryRow[]): { booked: SummaryLine[]; failed: SummaryLine[]; held: SummaryLine[] } | null {
  if (rows.some(r => WAITING.has(r.status))) return null;
  const booked = rows.filter(r => r.status === 'confirmed').map(line);
  if (!booked.length) return null;
  return {
    booked,
    failed: rows.filter(r => r.status === 'failed').map(line),
    held: rows.filter(r => r.status === 'quoted').map(line),
  };
}
