-- ─── Destination concentration, weekly (destination diversity, Task 6) ──
-- The study's headline metric, on Reach's own rows: of all the places
-- offered (or booked) in a week, what share went to the five most frequent.
-- The fixture tripwire (tests/unit/destination-tripwire.test.ts) holds it
-- at or under 0.40; this is the same number from production.
--
--   served: one `destination_served` event per place an options set showed
--           (app/api/trips/generate/route.ts), keyed by destination id.
--   booked: one per plan with at least one confirmed booking, keyed by the
--           plan's destination city, in the week its first booking was made.
--
-- Read-only, security_invoker like the other pilot views, service role only.
-- Names checked against the live schema on 2026-11-22. bookings.plan_id is
-- text while plans.id is uuid, hence the cast (as in pilot-metrics).

create or replace view public.pilot_destination_concentration
with (security_invoker = true) as
with served as (
  select date_trunc('week', e.created_at)::date as week,
         e.props->>'destination_id'               as place
  from public.events e
  where e.name = 'destination_served'
    and coalesce(e.props->>'destination_id', '') <> ''
),
booked as (
  select date_trunc('week', min(b.created_at))::date as week,
         lower(btrim(p.destination_city))            as place
  from public.plans p
  join public.bookings b on b.plan_id = p.id::text and b.status = 'confirmed'
  where coalesce(btrim(p.destination_city), '') <> ''
  group by p.id, p.destination_city
),
counted as (
  select 'served'::text as kind, week, place, count(*)::integer as n from served group by week, place
  union all
  select 'booked'::text, week, place, count(*)::integer from booked group by week, place
),
ranked as (
  select kind, week, place, n,
         row_number() over (partition by kind, week order by n desc, place) as rk
  from counted
)
select kind,
       week,
       sum(n)::integer                                    as total,
       count(*)::integer                                  as places,
       sum(n) filter (where rk <= 5)::integer             as top5,
       round(sum(n) filter (where rk <= 5)::numeric / nullif(sum(n), 0), 3) as top5_share
from ranked
group by kind, week
order by kind, week desc;

revoke all on public.pilot_destination_concentration from anon, authenticated;
grant select on public.pilot_destination_concentration to service_role;

-- Verify:
--   select * from public.pilot_destination_concentration;   -- empty until the switch is on
