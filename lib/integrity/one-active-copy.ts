// ─── "One trip at a time", said when a plan is reopened ──────────────────
// lib/one-active.ts words the refusal for making a plan: "This group is
// already planning a trip: Lisbon. Here it is." — and the caller that makes
// plans does open Lisbon, so "Here it is" is true there.
//
// Reopening a finished or called-off plan (PATCH /api/plans/[id] back to
// planning) meets the same rule, and the client that sends it shows the
// server's sentence as a toast and stays where it is. "Here it is" over a
// screen that is still the old plan points at something that is not there.
// So the reopen says what is true: which plan is in the way, that a group
// plans one of each at a time, and where to carry on — kindly, and without
// telling somebody who may not be the organiser to call anything off.
import type { PlanKind } from '../one-active.ts';

export function reopenCopy(kind: PlanKind, opts: { title?: string | null; solo?: boolean } = {}): string {
  const what = kind === 'night' ? 'night out' : 'trip';
  const named = String(opts.title ?? '').trim();
  const who = opts.solo ? "You're" : 'This group is';
  const which = named ? `${who} already planning ${named}` : `${who} already planning a ${what}`;
  const one = opts.solo ? `You plan one ${what} at a time` : `A group plans one ${what} at a time`;
  return `${which}. ${one}, so this one can't be picked back up just yet — it'll still be here once ${named || 'that one'} is done.`;
}

/** The PATCH 409 body, with the reopen's own words in place of the create flow's. */
export function reopenRefusal<T extends { error: string; kind: PlanKind }>(body: T, opts: { title?: string | null; solo?: boolean }): T {
  return { ...body, error: reopenCopy(body.kind, opts) };
}
