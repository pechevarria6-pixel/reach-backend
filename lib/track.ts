// ─── Recording what happened, without ever being the reason it didn't ───
// Instrumentation earns none of the product's reliability budget. If this
// file is the reason a booking fails, it has cost more than every number it
// will ever produce — so nothing here throws, nothing here is awaited by a
// response, and a missing table is a quiet no-op rather than an outage.
//
// It still reads its own write. A tracker that silently loses half its rows
// produces a funnel that looks like a product problem, and somebody spends a
// week chasing a drop-off that never happened.

import type { SupabaseClient } from '@supabase/supabase-js';

/** The only names that may be written. */
export const EVENT_NAMES = [
  'plan_created',
  'invite_link_opened',
  'invite_signup',
  'quiz_completed',
  'trip_input_submitted',
  'vote_cast',
  'booking_created',
  'booking_approved',
  'booking_confirmed',
  'booking_failed',
  'funding_started',
  'contribution_succeeded',
  'plan_fully_funded',
  'quote_drift',
  'recommendation_dismissed',
  'plan_deleted',
] as const;

export type EventName = typeof EVENT_NAMES[number];

const KNOWN = new Set<string>(EVENT_NAMES);
export function isEventName(name: unknown): name is EventName {
  return typeof name === 'string' && KNOWN.has(name);
}

export interface TrackContext {
  userId?: string | null;
  groupId?: string | null;
  planId?: string | null;
  props?: Record<string, unknown>;
}

/**
 * Keys that must never reach this table, whatever a caller passes.
 *
 * A funnel does not need to know who anybody is, and a props bag is exactly
 * where somebody eventually puts an email "just for debugging". Stripped
 * here rather than trusted at every call site.
 */
const FORBIDDEN = /name|email|phone|address|dob|birth|passport|title|note|message|query|text|summary|blurb/i;

/** Only numbers, booleans, and short enum-ish strings survive. */
export function scrubProps(props: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props ?? {})) {
    if (FORBIDDEN.test(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) { out[key] = value; continue; }
    if (typeof value === 'boolean') { out[key] = value; continue; }
    if (typeof value === 'string') {
      // A short string is a category — 'restaurant', 'opentable', 'done'.
      // A long one is prose somebody typed, and prose is never a property.
      const v = value.trim();
      if (v && v.length <= 40 && !/\s{2,}/.test(v)) out[key] = v;
    }
  }
  return out;
}

/** Said once per process, not once per event. */
let warnedMissing = false;

/**
 * Record that something happened.
 *
 * Deliberately not awaited by callers in a request path — `void track(...)`
 * is the intended shape. Awaiting it is harmless, and never required.
 */
export async function track(
  db: SupabaseClient,
  name: EventName,
  ctx: TrackContext = {},
): Promise<void> {
  try {
    const { error } = await db.from('events').insert({
      name,
      user_id: ctx.userId ?? null,
      group_id: ctx.groupId ?? null,
      plan_id: ctx.planId ?? null,
      props: scrubProps(ctx.props),
    });

    if (!error) return;

    // The migration has not been run. Once, then silence: a log line per
    // event would bury everything else in the function's output.
    if (/events|schema cache|PGRST205/i.test(`${error.code} ${error.message}`)) {
      if (!warnedMissing) {
        warnedMissing = true;
        console.error('[track] events table not present — tracking disabled until sql/events-2026-09-20.sql is run');
      }
      return;
    }

    // A tracker that quietly loses rows produces a funnel that looks like a
    // product problem, and somebody spends a week chasing a drop-off that
    // never happened.
    console.error('[track] could not record an event', { name, code: error.code });
  } catch (e) {
    // Nothing here may reach the caller. A thrown tracker would take down
    // the booking it was describing.
    console.error('[track] threw, which it must not', { name, error: e instanceof Error ? e.message : 'unknown' });
  }
}
