-- ─── Where a trip is, as a point ─────────────────────────────────────────
-- Run me. Written 2026-09-25. Safe to run twice.
--
-- The trip map ("where you're going / where you've been") and the pin in
-- the booked moment need a point for each plan. plans holds the destination
-- as words — destination_city, destination_country, and on older trips only
-- the title — and nothing a map can draw. Probed 2026-09-25: a PostgREST
-- select of plans.destination_lat answers 42703, column does not exist.
--
-- destination_lat    where Nominatim put the destination (locatePlan in
-- destination_lng    lib/discovery/geocode.ts — the same geocoder the venue
--                    boxes use, so the pin and the venues agree on the town)
-- destination_label  the name Nominatim gave that point, shown beside the
--                    pin so the person can see which "Portland" we mean
--
-- The rule these columns carry: a point is stored only when a lookup found
-- one. A lookup that failed (timeout, 503) stores nothing, and a plan with no
-- point draws no pin — it is never guessed from the country, never placed at
-- a default, and never 0,0. The constraints below make the last two true
-- whatever the code does.
--
-- Until this runs the geocode step and GET /api/me/trips-map should treat
-- 42703 as "no points yet" and draw nothing, rather than fail the request.

alter table public.plans
  add column if not exists destination_lat numeric(10, 7),
  add column if not exists destination_lng numeric(10, 7),
  add column if not exists destination_label text;

do $$
begin
  -- Both or neither: half a point is not a place.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.plans'::regclass and conname = 'plans_destination_point_whole') then
    alter table public.plans add constraint plans_destination_point_whole
      check ((destination_lat is null) = (destination_lng is null));
  end if;

  -- On the planet.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.plans'::regclass and conname = 'plans_destination_point_in_range') then
    alter table public.plans add constraint plans_destination_point_in_range
      check (destination_lat is null
             or (destination_lat between -90 and 90 and destination_lng between -180 and 180));
  end if;

  -- Not Null Island. A missing coordinate read as Number(null) is 0, and 0
  -- is finite — that has put a point in the Gulf of Guinea twice already
  -- (CLAUDE.md, lib/discovery/where.ts). No trip goes to 0,0.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.plans'::regclass and conname = 'plans_destination_point_not_null_island') then
    alter table public.plans add constraint plans_destination_point_not_null_island
      check (destination_lat is null or not (destination_lat = 0 and destination_lng = 0));
  end if;
end $$;

comment on column public.plans.destination_lat is
  'Latitude of the destination as Nominatim found it (lib/discovery/geocode.ts locatePlan). Null when no lookup has succeeded — never guessed, never 0,0.';
comment on column public.plans.destination_lng is
  'Longitude, paired with destination_lat: both or neither.';
comment on column public.plans.destination_label is
  'The place name Nominatim returned for that point, e.g. "Portland, Oregon, United States". Shown next to the pin.';

-- Nothing is backfilled here. scripts/backfill-plan-coords.mjs does that,
-- one request a second (Nominatim's usage policy), and prints until the
-- owner runs it for real.
--
-- Check after running:
--   select count(*) filter (where destination_lat is not null) as with_point,
--          count(*) as plans
--     from public.plans;
