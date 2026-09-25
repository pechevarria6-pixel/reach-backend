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
  // A double-tap that did not become a second booking. Worth a name of its
  // own: it is the only number that says whether the idempotency work is
  // doing anything, and the alternative is finding out from a duplicate
  // charge. The directive calls this one "409 seen".
  'booking_duplicate_blocked',
  'booking_approved',
  'booking_confirmed',
  'booking_failed',
  'funding_started',
  'contribution_succeeded',
  'plan_fully_funded',
  'quote_drift',
  'recommendation_dismissed',
  'plan_deleted',
  // The onboarding quiz v3 (spec section 8). Enough to see where people
  // drop off, how long it takes, and whether the share card brings anyone.
  'quiz_started',
  'quiz_screen_viewed',
  'quiz_screen_skipped',
  'quiz_result_viewed',
  'quiz_dial_adjusted',
  'quiz_shared',
  'quiz_share_opened',
  'quiz_share_joined',
  // The questions asked later, one at a time.
  'drip_shown',
  'drip_answered',
  'drip_dismissed',
  // Checkout's one next action (lib/next-action.ts): which state a person was
  // shown and whether they pressed the one thing it asked of them. Props are
  // the state and the CTA's id — never its words.
  'checkout_state_shown',
  'checkout_cta_tapped',
  // A slot the plan wanted filled and nothing we hold could fill — the count
  // that says where coverage is thin, rather than a shrug on a screen.
  'slot_unfilled',
  // A generated line dropped because where it is did not fit the rest of its
  // day, and a line somebody swapped for another.
  'itinerary_item_dropped_location',
  'itinerary_item_swapped',
  // The close card's "plan the next one", the only door back into the loop.
  'next_trip_started_from_close',
  // Settle-up. Reach never moves the money: these count a person opening
  // their own payment app from a line, and marking the line paid. Props are
  // the app and the amount in cents — no handle, no note.
  'settle_up_link_opened',
  'settle_up_marked_paid',
  // Everything booked, shown once.
  'celebration_shown',
] as const;

export type EventName = typeof EVENT_NAMES[number];

/**
 * The names a browser may send to /api/track. Everything else is the
 * server's own: a contribution succeeded when Stripe says so, not when a
 * screen believes it did.
 *
 * Here rather than in the route so a name added for a screen is added beside
 * its declaration, and so a test can hold the two lists against each other.
 */
export const BROWSER_EVENT_NAMES: readonly EventName[] = [
  'invite_link_opened',
  'quiz_completed',
  'trip_input_submitted',
  'recommendation_dismissed',
  // What only the quiz screen can see: which screen, skipped or not, which
  // bar was nudged. Props are the screen or question id and nothing typed —
  // and scrubProps would drop anything longer anyway.
  'quiz_started',
  'quiz_screen_viewed',
  'quiz_screen_skipped',
  'quiz_result_viewed',
  'quiz_dial_adjusted',
  'quiz_shared',
  // Opened before anybody has an account, like an invitation.
  'quiz_share_opened',
  'quiz_share_joined',
  'drip_shown',
  'drip_answered',
  'drip_dismissed',
  // Checkout, the generated itinerary, the close card and settle-up. Each was
  // added to both lists in one change (the checkout spec, 2026-09-25); where
  // a server route also knows the moment it may emit the same name.
  'checkout_state_shown',
  'checkout_cta_tapped',
  'slot_unfilled',
  'itinerary_item_dropped_location',
  'itinerary_item_swapped',
  'next_trip_started_from_close',
  // Opening Venmo happens in the browser and nowhere else — nothing on the
  // server can see a person leave for their own app.
  'settle_up_link_opened',
  'settle_up_marked_paid',
  'celebration_shown',
];

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
