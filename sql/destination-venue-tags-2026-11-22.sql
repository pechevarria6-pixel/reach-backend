-- ─── What each destination holds, by interest (destination diversity, Task 3) ──
-- Owner runs this after sql/destination-diversity-2026-11-22.sql, with a dry
-- run first. Names checked against the live schema on 2026-11-22.
--
-- The selector's tags for a place are the interests its verified venues hold
-- (lib/destination-candidates.ts), so a pick that matches "breweries" is a
-- town where we hold breweries. PostgREST cannot group, and reading every
-- venue row per request would be ~500k rows, so the counting happens here.
--
-- Only for cities that have a destination profile: the selector never needs
-- the rest, and the join keeps the view small.

create or replace view public.destination_venue_tags
with (security_invoker = true) as
select d.id as destination_id,
       v.interest,
       count(*)::integer as venues
from public.destination_profiles d
join public.discovery_venues v
  on v.city = d.city
 and v.gone_at is null
 and v.interest is not null
group by d.id, v.interest;

-- Server-only, like the tables under it.
revoke all on public.destination_venue_tags from anon, authenticated;
grant select on public.destination_venue_tags to service_role;

-- Verify:
--   select count(*) from public.destination_venue_tags;                 -- > 0
--   select interest, venues from public.destination_venue_tags
--    where destination_id = (select id from destination_profiles where city = 'Asheville' limit 1)
--    order by venues desc limit 10;
