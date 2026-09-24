-- ─── Climate: what the weather is usually like, month by month ──────────
-- Run me. Written 2026-09-24. Safe to run twice.
--
-- One row per place Reach knows (the map load's seeds and the world list),
-- holding NASA POWER's monthly normals: twelve values per variable, January
-- first. Filled by scripts/ingest/climate.mjs from the weekly GitHub Action;
-- refreshed at most once a year, because forty-year averages do not move.
--
-- Until this runs, nothing breaks: lib/climate-store.ts reads a missing table
-- or column (PGRST205 / 42P01 / 42703) as "no climate held", ideas are kept
-- and never described as having passed a weather no-go, and the loader
-- refuses to start and names this file.
--
-- Source: NASA POWER climatology (https://power.larc.nasa.gov), NASA Langley
-- Research Center, funded through the NASA Earth Science Division. NASA data
-- carries no restriction on commercial use; it asks to be credited and never
-- to be presented as endorsing anything.

create table if not exists public.place_climate (
  id               uuid primary key default gen_random_uuid(),
  -- The town as the seed or the world list names it.
  name             text not null,
  -- nameKey() in lib/discovery/regions.ts: case, accents and spacing folded.
  name_key         text not null,
  -- ISO 3166-1 alpha-2 where we know it. Null for a seed whose region does
  -- not say; the reader then only matches a name held once.
  country          text,
  -- Rounded to two places (about a kilometre). POWER's cells are half a
  -- degree, so nothing finer means anything, and rounding is what makes the
  -- same town from two seed regions one row.
  lat              numeric(6,2) not null,
  lng              numeric(7,2) not null,
  -- Twelve monthly normals each, index 1 = January.
  t2m              real[] not null,   -- mean air temperature at 2 m, °C
  t2m_range        real[] not null,   -- mean daily max − min at 2 m, °C
  precip_mm_day    real[] not null,   -- PRECTOTCORR, mean mm per day
  rh2m             real[],            -- relative humidity at 2 m, %
  cloud_pct        real[],            -- cloud amount, %
  wind_ms          real[],            -- wind speed at 2 m, m/s
  -- The grid cell's average ground height from POWER — not the town's.
  grid_elevation_m real,
  source           text not null default 'NASA POWER',
  -- The climatological period POWER reported using, e.g. '1981–2020'.
  period           text not null,
  fetched_at       timestamptz not null default now(),
  constraint place_climate_once unique (name_key, lat, lng),
  constraint place_climate_twelve check (
    array_length(t2m, 1) = 12 and array_length(t2m_range, 1) = 12 and array_length(precip_mm_day, 1) = 12
    and (rh2m is null or array_length(rh2m, 1) = 12)
    and (cloud_pct is null or array_length(cloud_pct, 1) = 12)
    and (wind_ms is null or array_length(wind_ms, 1) = 12)
  )
);

create index if not exists place_climate_name_key on public.place_climate (name_key);

comment on table public.place_climate is
  'NASA POWER monthly climate normals per place Reach knows. Written by scripts/ingest/climate.mjs (service role); readable by anyone.';

-- ── Read-only for the app's keys, written by the job ────────────────────
-- Averages of public NASA data, nothing personal: anyone may read them. Only
-- the service role (which bypasses row level security) writes.
alter table public.place_climate enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'place_climate' and policyname = 'place_climate_read') then
    create policy place_climate_read on public.place_climate for select to anon, authenticated using (true);
  end if;
end $$;

grant select on public.place_climate to anon, authenticated;
revoke insert, update, delete, truncate on public.place_climate from anon, authenticated;
