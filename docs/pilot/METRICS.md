# Pilot metrics: where each number comes from

Business model §3 lists the numbers the pilot is judged on, and §4G M1 asks
for each one to be a named event with a view over it. This file says, for each
metric, which row or event it is read from, what writes that row or event,
and what the number cannot see yet. Keep it current. A metric whose source is
not listed here is a number nobody can check.

Everything below is in `sql/pilot-metrics-2026-11-08.sql`, which the
coordinator runs after `sql/pilot-gate-2026-11-08.sql`.

```sql
select * from pilot_metrics;                                    -- all time, one row per metric
select * from pilot_metrics_between('2026-11-15', '2026-12-31'); -- the pilot window only
select * from pilot_trip_metrics order by created_at desc;     -- one row per plan
```

The owner's own test trips are in the all-time view, which is how to check it
works before the pilot has any rows. Readouts use `pilot_metrics_between` with
the pilot window, so test trips stay out.

A metric with no data has `value = null` and `denominator = 0`. A null is
"nothing measured yet". A zero is a result. Don't let one stand in for the
other in a readout.

## The metrics

| §3 metric | `pilot_metrics.metric` | Read from | Written by | Status |
|---|---|---|---|---|
| Proposed → funded (baseline 24%) | `proposed_to_funded` | plans; `plan_fully_funded` | Stripe webhook (`app/api/webhooks/stripe/route.ts`) | live; no rows yet (no real payments) |
| | `proposed_to_committed` | as above, or a confirmed booking | bookings rows | live. Plans with no pooled money (book-your-own, redirect only) never fire `plan_fully_funded`, so this row counts them too |
| Member → organizer (> 30%) | `member_to_organizer` | `group_invites.accepted_by/accepted_at`, `invite_signup`; `plans.created_by` | invite accept (`lib/invites.ts`); plan create | live |
| Organizer hours, messages (19 h / 83) | `organizer_hours_per_trip`, `organizer_messages_per_trip` | `debrief_submitted` props `hours`, `messages` | Verify track's debrief form | waiting on the form. `messages` is kept by `scrubProps` only as a number (see `lib/track.ts` COUNT_KEYS) |
| Post-trip NPS (50+) | `post_trip_nps`, `would_run_again` | `debrief_submitted` props `nps` (0–10), `would_run_again` | as above | waiting on the form |
| Inception → booked | `inception_to_booked_hours_median` | `plans.created_at` → first `booking_confirmed` event, or the confirmed row's `updated_at` | approve route | live. `pilot_trip_metrics.first_booked_source` says which. `updated_at` is an approximation because bookings has no `confirmed_at` |
| Trips per active group per year | `trips_per_active_group_per_year` | non-cancelled plans per group | plans | live. Null until the window covers 28 days, since annualising three days of data gives nonsense |
| Zero post-trip IOUs | `zero_post_trip_iou_rate` | `ledger_at_trip_end` props `open_lines`, `open_cents` | `recordLedgersAtTripEnd` (`lib/observe/ledger-at-end.ts`) | **needs a caller** (see below). Solo plans are excluded |
| 402 "chip in" resolution | `chip_in_resolution_rate` | `chip_in_requested`, then `plan_fully_funded` or `booking_approved` after it | approve route's 402 | **needs an emitter** (see below) |
| Per-item opt-out usage | `item_optout_usage_rate` | `item_optouts` rows, `item_opted_out` events | participation route | rows live; **events need an emitter**. Rows alone undercount, because opting back in deletes the row |
| Contribution margin per trip | `contribution_margin_cents_per_trip` | see M4 below | | live once L4 and P6 write their columns |
| Card vs ACH mix | `ach_share_of_contributions` | `contributions.payment_method` | funding/webhook (Rail, P1) | live after the pilot-gate migration |
| Fee cost per trip | `payment_fee_cents_per_trip` | `contributions.stripe_fee_cents` | webhook (Rail, P6) | waiting on P6 |
| Reconnection | `reconnection_answers`; distribution in `pilot_reconnection` | `reconnection_answered` prop `answer` | Verify/UX onboarding question | waiting on the question |
| (cost) AI per trip | `ai_cost_usd_per_trip`, `ai_cost_usd_unattributed` | `ai_generation` | `app/api/trips/generate/route.ts`, every model call | live |

Two more events help keep an eye on the numbers above. Neither is a metric:

- `generation_rate_limited` (props `scope` user|group, `action`, `used`,
  `limit`): if this ever counts a real group in normal use, the limit is wrong.
- `ai_generation` with `priced = false`: a model is not in the price table in
  `lib/observe/ai-cost.ts`, so its cost is missing from the margin.

## M4: contribution margin per trip

```
margin = take (bookings.commission_cents, confirmed)
       − payment fees (contributions.stripe_fee_cents; succeeded, refunded, partially refunded)
       − AI cost (sum of ai_generation.cost_usd for the plan, × 100 for cents)
       − concierge minutes (0, because nothing records them yet)
```

It is a column, `pilot_trip_metrics.contribution_margin_cents`, so the query
for one trip is:

```sql
select plan_id, take_cents, fee_cents, ai_cost_usd, concierge_cost_cents,
       contribution_margin_cents
  from pilot_trip_metrics
 where plan_id = '<plan id>';
```

What it cannot see yet. Say all of these in any readout that quotes margin:

- **Concierge minutes have no source.** Until there is one, log the minutes
  per trip by hand in `docs/pilot/CONCIERGE-RUNBOOK.md`'s log. The view's
  `concierge_minutes` and `concierge_cost_cents` columns are 0 and are there to
  be replaced.
- **Take is only what L4 writes.** A confirmed booking with no
  `commission_cents` counts as $0 take. `confirmed_without_commission` counts
  those, so a margin built on a gap can be seen.
- **Fees are only what P6 writes.** `fee_unknown` counts succeeded
  contributions with no fee recorded.
- **AI cost before a plan exists is not on the plan.** Options generated
  before the plan row was saved are recorded against the group only
  (`ai_cost_usd_unattributed`). The knowledge cron's calls are not metered at
  all, since they are shared across every trip and belong to no single one.
- **Prices are list prices** (`MODEL_PRICES`, checked 2026-11-08), not the
  invoice. Check the event's `cost_usd` total against the Anthropic console
  monthly.

## Wiring still to place (other tracks' files)

These are the coordinator's to place after the owning track merges. Each is
one `void track(...)` line. Names are already in `EVENT_NAMES`.

| File | Where | Event | Props |
|---|---|---|---|
| `app/api/bookings/[id]/approve/route.ts` | both `return refuse(402, …)` (the price-rise one and the plain shortfall) | `chip_in_requested` | `shortfall_cents`, `target_cents`, `collected_cents`, `rise: true/false`; `planId`, `groupId`, `userId` |
| `app/api/plans/[planId]/participation/route.ts` | after a successful `item_optouts` upsert / delete | `item_opted_out` / `item_opted_in` | `vertical` (category only), `planId`, `userId` |
| `app/api/cron/knowledge/route.ts` | once per daily run, beside `distillAll` | call `recordLedgersAtTripEnd(db)` from `lib/observe/ledger-at-end.ts`; report its counts in the response | n/a |
| `app/api/webhooks/stripe/route.ts` | the `contribution_succeeded` track call | (existing event) | add `payment_method`, `fee_cents`, so the event agrees with the row |
