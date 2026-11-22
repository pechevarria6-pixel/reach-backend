-- ─── Coordinates for destination profiles, from our own sweep (2026-11-22) ──
-- The selector's 150 km spread rule needs lat/lng, and every
-- destination_profiles row had none. discovery_areas holds the point Reach
-- itself swept each city around — our own placement of that city, not a
-- guess — so where a profile's city has one, it takes it. Rows with no sweep
-- area stay null (unknown); they need a geocoding pass, not a guess.
-- Only fills nulls: a coordinate somebody set by hand is never overwritten.
-- Data only; reversible by setting the same rows back to null.

begin;

update public.destination_profiles d
set lat = a.lat,
    lng = a.lng,
    updated_at = now()
from (
  select lower(city) as c,
         (array_agg(lat order by created_at))[1] as lat,
         (array_agg(lng order by created_at))[1] as lng
  from public.discovery_areas
  where lat is not null and lng is not null
  group by lower(city)
) a
where a.c = lower(d.city)
  and d.lat is null
  and d.lng is null;

commit;

-- Verify:
--   select count(*) filter (where lat is not null) as placed, count(*) as total from public.destination_profiles;
--   -- 2026-11-22 dry run: 10 rows placed (8 places, San Juan stored three times), 16 still null
