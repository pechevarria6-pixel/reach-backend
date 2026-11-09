// ─── The exception queue, ops only (directive C4) ───────────────────────
// Every vertical without a booking API is handed to the member (redirect
// first); concierge survives only as an exception — a booking row a person at
// Reach has to act on. This counts them and measures each against the 2-hour
// SLA in docs/pilot/CONCIERGE-RUNBOOK.md. Never shown in member UI.

export const SLA_HOURS = 2;

export interface ExceptionRow { id: string; plan_id: string | null; vertical: string | null; status: string | null; mode: string | null; provider: string | null; created_at: string }

/** What needs a person, from booking rows already read. Pure. */
export function exceptionQueue(rows: ExceptionRow[], now: Date = new Date()) {
  const open = rows.filter(r => (r.mode === 'concierge' || r.provider === 'concierge') && r.status === 'pending');
  const ages = open.map(r => ({ ...r, hours: Math.max(0, (now.getTime() - Date.parse(r.created_at)) / 3_600_000) }));
  const breached = ages.filter(a => a.hours > SLA_HOURS);
  return {
    open: ages.length,
    breachedSla: breached.length,
    slaHours: SLA_HOURS,
    oldestHours: ages.length ? Math.round(Math.max(...ages.map(a => a.hours)) * 10) / 10 : null,
    byVertical: ages.reduce<Record<string, number>>((m, a) => { const k = a.vertical ?? 'unknown'; m[k] = (m[k] ?? 0) + 1; return m; }, {}),
    rows: ages.sort((a, b) => b.hours - a.hours).slice(0, 50)
      .map(a => ({ id: a.id, planId: a.plan_id, vertical: a.vertical, hours: Math.round(a.hours * 10) / 10, breached: a.hours > SLA_HOURS })),
  };
}
