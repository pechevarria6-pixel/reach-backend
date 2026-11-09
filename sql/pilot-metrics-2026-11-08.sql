-- ─── Pilot metrics (business model §3, §4G M1 and M4) ───────────────────
-- Every number the pilot is judged on, as a SELECT. Written by the Observe
-- track (REACH-PILOT-GATE-2026-11-08.md §A5); executed only by the
-- coordinator, AFTER these, in this order:
--
--   sql/events-2026-09-20.sql          the events table (already run)
--   sql/preferences-v1.sql             item_optouts (already run)
--   sql/pilot-gate-2026-11-08.sql      contributions.payment_method,
--                                      contributions.stripe_fee_cents,
--                                      bookings.lane, bookings.commission_cents
--
-- Run before the pilot-gate migration, this fails on the first missing
-- column, inside the transaction, and changes nothing. Safe to re-run.
--
-- What is here:
--   pilot_num(), pilot_bool()        read a props value without a bad one
--                                    taking the whole view down
--   pilot_trip_metrics               one row per plan — the owner's own test
--                                    trips included, which is how the view is
--                                    checked before the pilot has any rows
--   pilot_organizer_conversion       one row per person who joined via invite
--   pilot_group_metrics              one row per group
--   pilot_reconnection               "When did you last see this group in
--                                    person?" — answers counted
--   pilot_metrics_between(from, to)  every §3 metric, one row each, for plans
--                                    created in a window
--   pilot_metrics                    the same for all time
--
-- Where each number comes from, and what it cannot see yet, is in
-- docs/pilot/METRICS.md. Truth comes from the rows where rows hold it
-- (bookings, contributions, plans, group_invites) and from events only for
-- moments no row keeps: funded, a 402, the debrief, the ledger at trip end,
-- what a model call cost.
--
-- None of these is readable from a browser: each view runs with the
-- caller's rights (security_invoker) and anon/authenticated are revoked.
-- The owner reads them in the SQL editor or with the service role.

begin;

-- ── Reading props safely ──────────────────────────────────────────────
-- props is jsonb written by code, but one malformed value cast with ::numeric
-- would fail every row of every view below. A bad value reads as null.
create or replace function public.pilot_num(v text) returns numeric
  language sql immutable as $$
  select case when v ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then v::numeric end
$$;

create or replace function public.pilot_bool(v text) returns boolean
  language sql immutable as $$
  select case lower(coalesce(v, '')) when 'true' then true when 'false' then false end
$$;

-- ── One row per plan ──────────────────────────────────────────────────
create or replace view public.pilot_trip_metrics with (security_invoker = true) as
with ev as (
  select e.plan_id,
    min(e.created_at) filter (where e.name = 'plan_fully_funded')  as fully_funded_at,
    min(e.created_at) filter (where e.name = 'booking_confirmed')  as first_confirmed_event_at,
    min(e.created_at) filter (where e.name = 'booking_approved')   as first_approved_at,
    min(e.created_at) filter (where e.name = 'chip_in_requested')  as first_chip_in_at,
    count(*)          filter (where e.name = 'chip_in_requested')  as chip_in_requests,
    count(*)          filter (where e.name = 'item_opted_out')     as optout_events,
    count(*)          filter (where e.name = 'ai_generation')      as ai_calls,
    count(*)          filter (where e.name = 'ai_generation'
                                and public.pilot_bool(e.props->>'priced') is not true) as ai_calls_unpriced,
    coalesce(sum(public.pilot_num(e.props->>'cost_usd'))      filter (where e.name = 'ai_generation'), 0) as ai_cost_usd,
    coalesce(sum(public.pilot_num(e.props->>'input_tokens'))  filter (where e.name = 'ai_generation'), 0) as ai_input_tokens,
    coalesce(sum(public.pilot_num(e.props->>'output_tokens')) filter (where e.name = 'ai_generation'), 0) as ai_output_tokens
  from public.events e
  where e.plan_id is not null
  group by e.plan_id
),
-- The organiser's last word on the trip, if they gave one more than once.
debrief as (
  select distinct on (e.plan_id) e.plan_id, e.created_at, e.props
  from public.events e
  where e.name = 'debrief_submitted' and e.plan_id is not null
  order by e.plan_id, e.created_at desc
),
-- The first read after the trip ended is the one that counts.
ledger_end as (
  select distinct on (e.plan_id) e.plan_id, e.created_at, e.props
  from public.events e
  where e.name = 'ledger_at_trip_end' and e.plan_id is not null
  order by e.plan_id, e.created_at asc
),
bk as (
  select b.plan_id,
    count(*) filter (where b.status = 'confirmed')                            as confirmed_bookings,
    count(*) filter (where b.status = 'confirmed' and b.mode = 'native')      as native_confirmed,
    count(*) filter (where b.status = 'confirmed' and b.mode = 'redirect')    as redirect_confirmed,
    count(*) filter (where b.status = 'confirmed' and b.mode = 'concierge')   as concierge_confirmed,
    -- No confirmed_at column: updated_at is when the row last changed, which
    -- for a confirmed booking is normally the confirmation. Used only when
    -- the booking_confirmed event is missing, and flagged as such.
    min(b.updated_at) filter (where b.status = 'confirmed')                   as first_confirmed_row_at,
    coalesce(sum(b.price_cents) filter (where b.status = 'confirmed'), 0)     as booked_cents,
    coalesce(sum(b.commission_cents) filter (where b.status = 'confirmed'), 0) as take_cents,
    count(*) filter (where b.status = 'confirmed' and b.commission_cents is null
                       and b.mode <> 'concierge')                             as confirmed_without_commission
  from public.bookings b
  group by b.plan_id
),
ct as (
  select c.plan_id,
    count(*) filter (where c.status = 'succeeded')                                       as paid_contributions,
    count(*) filter (where c.status = 'succeeded' and c.payment_method = 'us_bank_account') as ach_contributions,
    count(*) filter (where c.status = 'succeeded' and c.payment_method = 'card')         as card_contributions,
    count(*) filter (where c.status = 'succeeded' and c.payment_method is null)          as method_unknown,
    coalesce(sum(c.amount_cents - coalesce(c.refunded_cents, 0))
             filter (where c.status in ('succeeded', 'partially_refunded')), 0)          as collected_cents,
    -- Stripe keeps its fee on a refund, so a refunded share still cost one.
    coalesce(sum(c.stripe_fee_cents)
             filter (where c.status in ('succeeded', 'refunded', 'partially_refunded')), 0) as fee_cents,
    coalesce(sum(c.stripe_fee_cents) filter (where c.status = 'succeeded'
                                              and c.payment_method = 'us_bank_account'), 0) as ach_fee_cents,
    coalesce(sum(c.stripe_fee_cents) filter (where c.status = 'succeeded'
                                              and c.payment_method = 'card'), 0)         as card_fee_cents,
    count(*) filter (where c.status = 'succeeded' and c.stripe_fee_cents is null)        as fee_unknown
  from public.contributions c
  group by c.plan_id
),
oo as (
  select o.plan_id, count(*) as optouts_now, count(distinct o.user_id) as people_sitting_out
  from public.item_optouts o
  group by o.plan_id
)
select
  p.id                                         as plan_id,
  p.group_id,
  p.type,
  p.status,
  p.created_by,
  p.created_at,
  p.start_date,
  p.end_date,
  (select count(*) from public.group_members gm where gm.group_id = p.group_id) as members,

  -- Proposed → funded
  ev.fully_funded_at,
  (ev.fully_funded_at is not null)                                   as funded,
  -- Committed: funded, or something booked. A plan with no pooled money
  -- (book-your-own, a redirect-only night out) never fires
  -- plan_fully_funded and would otherwise always read as unfunded.
  (ev.fully_funded_at is not null or coalesce(bk.confirmed_bookings, 0) > 0) as committed,

  -- Inception → booked
  coalesce(ev.first_confirmed_event_at, bk.first_confirmed_row_at)   as first_booked_at,
  case when ev.first_confirmed_event_at is not null then 'event'
       when bk.first_confirmed_row_at is not null then 'row_updated_at' end as first_booked_source,
  round((extract(epoch from (coalesce(ev.first_confirmed_event_at, bk.first_confirmed_row_at) - p.created_at))
         / 3600)::numeric, 1)                                         as inception_to_booked_hours,

  -- Bookings and take (L4)
  coalesce(bk.confirmed_bookings, 0)        as confirmed_bookings,
  coalesce(bk.native_confirmed, 0)          as native_confirmed,
  coalesce(bk.redirect_confirmed, 0)        as redirect_confirmed,
  coalesce(bk.concierge_confirmed, 0)       as concierge_confirmed,
  coalesce(bk.booked_cents, 0)              as booked_cents,
  coalesce(bk.take_cents, 0)                as take_cents,
  coalesce(bk.confirmed_without_commission, 0) as confirmed_without_commission,

  -- Money in, how it was paid, and what Stripe kept (P1, P6)
  coalesce(ct.paid_contributions, 0)        as paid_contributions,
  coalesce(ct.ach_contributions, 0)         as ach_contributions,
  coalesce(ct.card_contributions, 0)        as card_contributions,
  coalesce(ct.method_unknown, 0)            as method_unknown,
  coalesce(ct.collected_cents, 0)           as collected_cents,
  coalesce(ct.fee_cents, 0)                 as fee_cents,
  coalesce(ct.ach_fee_cents, 0)             as ach_fee_cents,
  coalesce(ct.card_fee_cents, 0)            as card_fee_cents,
  coalesce(ct.fee_unknown, 0)               as fee_unknown,

  -- AI cost (C3)
  coalesce(ev.ai_calls, 0)                  as ai_calls,
  coalesce(ev.ai_calls_unpriced, 0)         as ai_calls_unpriced,
  coalesce(ev.ai_cost_usd, 0)               as ai_cost_usd,
  coalesce(ev.ai_input_tokens, 0)           as ai_input_tokens,
  coalesce(ev.ai_output_tokens, 0)          as ai_output_tokens,

  -- Concierge minutes: no source yet. Nothing records how long a person
  -- spent on a concierge item, so this is 0 and margin omits it — say so in
  -- any readout. When a source exists (a concierge_minutes event, or a
  -- column on bookings) it replaces this 0 and the cost per minute below.
  0::numeric                                as concierge_minutes,
  0::numeric                                as concierge_cost_cents,

  -- Contribution margin (M4): take − payment fees − AI cost − concierge.
  -- Cents, numeric because AI cost is fractions of a cent.
  round(coalesce(bk.take_cents, 0)
        - coalesce(ct.fee_cents, 0)
        - coalesce(ev.ai_cost_usd, 0) * 100
        - 0, 2)                             as contribution_margin_cents,

  -- 402 "chip in": asked, and resolved = funded or approved after the first ask.
  coalesce(ev.chip_in_requests, 0)          as chip_in_requests,
  ev.first_chip_in_at,
  (ev.first_chip_in_at is not null
    and (ev.fully_funded_at > ev.first_chip_in_at or ev.first_approved_at > ev.first_chip_in_at)) as chip_in_resolved,

  -- Per-item opt-out: who sits something out now, and whether anybody ever did.
  coalesce(oo.optouts_now, 0)               as optouts_now,
  coalesce(oo.people_sitting_out, 0)        as people_sitting_out,
  coalesce(ev.optout_events, 0)             as optout_events,

  -- Zero post-trip IOUs (lib/observe/ledger-at-end.ts)
  le.created_at                             as ledger_read_at,
  public.pilot_num(le.props->>'open_lines') as open_iou_lines,
  public.pilot_num(le.props->>'open_cents') as open_iou_cents,
  public.pilot_bool(le.props->>'solo')      as ledger_solo,
  case when le.plan_id is null then null
       else coalesce(public.pilot_num(le.props->>'open_lines'), 0) = 0 end as zero_iou,

  -- Organiser debrief (A7 / M2; the Verify track's form)
  d.created_at                              as debrief_at,
  public.pilot_num(d.props->>'hours')       as organizer_hours,
  public.pilot_num(d.props->>'messages')    as organizer_messages,
  public.pilot_num(d.props->>'nps')         as nps_score,
  public.pilot_bool(d.props->>'would_run_again') as would_run_again
from public.plans p
left join ev         on ev.plan_id = p.id
left join debrief d  on d.plan_id  = p.id
left join ledger_end le on le.plan_id = p.id
-- bookings.plan_id and contributions.plan_id are text in production (engine-v3),
-- plans.id is uuid: compared as text, or the view fails with 42883.
left join bk         on bk.plan_id = p.id::text
left join ct         on ct.plan_id = p.id::text
left join oo         on oo.plan_id = p.id;

-- ── Member → organizer ────────────────────────────────────────────────
-- Joined via an invitation (the accepted invite row, or invite_signup for an
-- account made from one), then created a plan of their own afterwards.
create or replace view public.pilot_organizer_conversion with (security_invoker = true) as
with joined as (
  select user_id, min(joined_at) as joined_at
  from (
    select gi.accepted_by as user_id, gi.accepted_at as joined_at
      from public.group_invites gi
     where gi.accepted_by is not null and gi.accepted_at is not null
    union all
    select e.user_id, e.created_at
      from public.events e
     where e.name = 'invite_signup' and e.user_id is not null
  ) j
  group by user_id
)
select
  j.user_id,
  j.joined_at,
  (select min(p.created_at) from public.plans p
    where p.created_by = j.user_id and p.created_at > j.joined_at) as first_plan_after_join_at,
  exists (select 1 from public.plans p
           where p.created_by = j.user_id and p.created_at > j.joined_at) as became_organizer
from joined j;

-- ── Per group ─────────────────────────────────────────────────────────
create or replace view public.pilot_group_metrics with (security_invoker = true) as
select
  g.id                                                         as group_id,
  (select count(*) from public.group_members gm where gm.group_id = g.id) as members,
  count(p.id) filter (where p.status <> 'cancelled')           as trips,
  count(p.id) filter (where p.status <> 'cancelled'
                        and p.created_at > now() - interval '365 days') as trips_last_365_days,
  min(p.created_at)                                            as first_plan_at,
  max(p.created_at)                                            as last_plan_at,
  -- Active: planned anything that was not called off in the last year.
  bool_or(p.status <> 'cancelled' and p.created_at > now() - interval '365 days') as active
from public.groups g
left join public.plans p on p.group_id = g.id
group by g.id;

-- ── Reconnection: "When did you last see this group in person?" ───────
create or replace view public.pilot_reconnection with (security_invoker = true) as
select
  coalesce(e.props->>'answer', 'unanswered') as answer,
  count(*)                                   as answers,
  count(distinct e.group_id)                 as groups,
  min(e.created_at)                          as first_at,
  max(e.created_at)                          as last_at
from public.events e
where e.name = 'reconnection_answered'
group by 1;

-- ── Every §3 metric, one row each ─────────────────────────────────────
-- For plans created in [from, to). A metric with no data has a null value
-- and its denominator says 0 — never a zero that reads as a result.
create or replace function public.pilot_metrics_between(from_at timestamptz, to_at timestamptz)
returns table (
  metric text, value numeric, numerator numeric, denominator numeric,
  unit text, baseline numeric, target text, source text
)
language sql stable security invoker as $$
  with t as (
    select * from public.pilot_trip_metrics
     where created_at >= from_at and created_at < to_at
  ),
  conv as (
    select * from public.pilot_organizer_conversion
     where joined_at >= from_at and joined_at < to_at
  ),
  ai_unattributed as (
    select coalesce(sum(public.pilot_num(e.props->>'cost_usd')), 0) as usd, count(*) as calls
      from public.events e
     where e.name = 'ai_generation' and e.plan_id is null
       and e.created_at >= from_at and e.created_at < to_at
  ),
  grp as (
    select t.group_id, count(*) as trips
      from t where t.status <> 'cancelled'
     group by t.group_id
  ),
  span as (
    -- Days the window actually covers, for annualising.
    -- An empty window falls back to now, never to −infinity: subtracting an
    -- infinite timestamp is an error, and this runs even when t is empty.
    select greatest(1, extract(epoch from (least(to_at, now())
             - coalesce((select min(created_at) from t), least(to_at, now())))) / 86400) as days
  ),
  recon as (
    select count(*) as answers from public.events e
     where e.name = 'reconnection_answered' and e.created_at >= from_at and e.created_at < to_at
  )
  -- Cast once on the way out, so the result matches the declared columns on
  -- every Postgres version rather than relying on implicit coercion.
  select m.metric::text, m.value::numeric, m.numerator::numeric, m.denominator::numeric,
         m.unit::text, m.baseline::numeric, m.target::text, m.source::text
  from (
  select 'proposed_to_funded', round(count(*) filter (where funded)::numeric / nullif(count(*), 0), 3),
         count(*) filter (where funded), count(*), 'ratio', 0.24, 'materially above 0.24',
         'plans created; plan_fully_funded event'
    from t
  union all
  select 'proposed_to_committed', round(count(*) filter (where committed)::numeric / nullif(count(*), 0), 3),
         count(*) filter (where committed), count(*), 'ratio', 0.24, 'materially above 0.24',
         'plans created; funded or a booking confirmed (counts plans with no pooled money)'
    from t
  union all
  select 'member_to_organizer', round(count(*) filter (where became_organizer)::numeric / nullif(count(*), 0), 3),
         count(*) filter (where became_organizer), count(*), 'ratio', null, '> 0.30',
         'group_invites accepted + invite_signup; plans.created_by after joining'
    from conv
  union all
  select 'organizer_hours_per_trip', round(avg(organizer_hours), 1),
         sum(organizer_hours), count(organizer_hours), 'hours', 19, 'below 19',
         'debrief_submitted.hours'
    from t
  union all
  select 'organizer_messages_per_trip', round(avg(organizer_messages), 1),
         sum(organizer_messages), count(organizer_messages), 'messages', 83, 'below 83',
         'debrief_submitted.messages'
    from t
  union all
  -- NPS: % promoters (9–10) minus % detractors (0–6), on a −100…100 scale.
  select 'post_trip_nps',
         round(100.0 * (count(*) filter (where nps_score >= 9) - count(*) filter (where nps_score <= 6))
               / nullif(count(nps_score), 0), 1),
         count(*) filter (where nps_score >= 9) - count(*) filter (where nps_score <= 6),
         count(nps_score), 'nps', 50, '50+', 'debrief_submitted.nps (0–10)'
    from t
  union all
  select 'would_run_again', round(count(*) filter (where would_run_again)::numeric / nullif(count(would_run_again), 0), 3),
         count(*) filter (where would_run_again), count(would_run_again), 'ratio', null, 'measure',
         'debrief_submitted.would_run_again'
    from t
  union all
  select 'inception_to_booked_hours_median',
         round((percentile_cont(0.5) within group (order by inception_to_booked_hours))::numeric, 1),
         null, count(inception_to_booked_hours), 'hours', null, 'measure',
         'plans.created_at → first booking_confirmed (or the confirmed row''s updated_at)'
    from t
  union all
  -- Annualised only once the window covers four weeks: one trip in three
  -- days is not 120 trips a year, and a number like that would be quoted.
  select 'trips_per_active_group_per_year',
         case when (select days from span) >= 28
              then round(avg(grp.trips) * 365 / (select days from span), 2) end,
         sum(grp.trips), count(*), 'trips/group/year', null, 'measure',
         'non-cancelled plans per group in the window, annualised by its length (null under 28 days)'
    from grp
  union all
  select 'zero_post_trip_iou_rate',
         round(count(*) filter (where zero_iou)::numeric / nullif(count(zero_iou), 0), 3),
         count(*) filter (where zero_iou), count(zero_iou), 'ratio', null, 'measure',
         'ledger_at_trip_end (group trips; solo plans excluded)'
    from t where ledger_solo is not true
  union all
  select 'chip_in_resolution_rate',
         round(count(*) filter (where chip_in_resolved)::numeric / nullif(count(*) filter (where chip_in_requests > 0), 0), 3),
         count(*) filter (where chip_in_resolved), count(*) filter (where chip_in_requests > 0), 'ratio', null, 'measure',
         'chip_in_requested (402 on approve) → plan_fully_funded or booking_approved after it'
    from t
  union all
  select 'item_optout_usage_rate',
         round(count(*) filter (where optouts_now > 0 or optout_events > 0)::numeric
               / nullif(count(*) filter (where confirmed_bookings > 0 or paid_contributions > 0), 0), 3),
         count(*) filter (where optouts_now > 0 or optout_events > 0),
         count(*) filter (where confirmed_bookings > 0 or paid_contributions > 0), 'ratio', null, 'measure',
         'item_optouts rows + item_opted_out events, over plans with a booking or a payment'
    from t
  union all
  select 'take_cents_per_trip', round(avg(take_cents), 0), sum(take_cents), count(*), 'cents', null, 'measure',
         'bookings.commission_cents (confirmed)'
    from t where confirmed_bookings > 0
  union all
  select 'payment_fee_cents_per_trip', round(avg(fee_cents), 0), sum(fee_cents), count(*), 'cents', null, 'measure',
         'contributions.stripe_fee_cents'
    from t where paid_contributions > 0
  union all
  select 'ai_cost_usd_per_trip', round(avg(ai_cost_usd), 4), sum(ai_cost_usd), count(*), 'usd', null, 'measure',
         'ai_generation.cost_usd, plans with at least one call'
    from t where ai_calls > 0
  union all
  select 'ai_cost_usd_unattributed', round((select usd from ai_unattributed), 4), null,
         (select calls from ai_unattributed), 'usd', null, 'measure',
         'ai_generation with no saved plan (options before a plan existed)'
  union all
  select 'contribution_margin_cents_per_trip', round(avg(contribution_margin_cents), 0),
         sum(contribution_margin_cents), count(*), 'cents', null, '~20000 now → ~60000 on a $10K trip',
         'take − payment fees − AI cost − concierge minutes (concierge has no source yet: 0)'
    from t where confirmed_bookings > 0 or paid_contributions > 0
  union all
  select 'ach_share_of_contributions',
         round(sum(ach_contributions)::numeric / nullif(sum(ach_contributions) + sum(card_contributions), 0), 3),
         sum(ach_contributions), sum(ach_contributions) + sum(card_contributions), 'ratio', null, 'measure',
         'contributions.payment_method (succeeded; unknown method excluded)'
    from t
  union all
  select 'reconnection_answers', (select answers from recon), null, null, 'answers', null, 'measure',
         'reconnection_answered — distribution in pilot_reconnection'
  ) m(metric, value, numerator, denominator, unit, baseline, target, source)
$$;

create or replace view public.pilot_metrics with (security_invoker = true) as
  select * from public.pilot_metrics_between('-infinity'::timestamptz, 'infinity'::timestamptz);

-- Not for browsers. The anon key ships to every phone.
revoke all on public.pilot_trip_metrics, public.pilot_organizer_conversion,
              public.pilot_group_metrics, public.pilot_reconnection, public.pilot_metrics
  from anon, authenticated;
revoke all on function public.pilot_metrics_between(timestamptz, timestamptz) from public, anon, authenticated;

comment on view public.pilot_metrics is
  'Every business-model §3 pilot metric, one row each, all time. pilot_metrics_between(from, to) for a window. Sources: docs/pilot/METRICS.md.';

commit;

-- Verification (run after; each must return rows):
--   select * from public.pilot_metrics;                          -- 19 rows
--   select plan_id, status, ai_cost_usd, contribution_margin_cents
--     from public.pilot_trip_metrics order by created_at desc limit 5;   -- the owner's test trips
--   select * from public.pilot_metrics_between(now() - interval '7 days', now());
