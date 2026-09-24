-- ─── World data, phase 1: the weekly map load ────────────────────────────
-- Run me. Written 2026-09-24. Safe to run twice.
--
-- The sweep asks Overpass about one town at a time, and Overpass took 72
-- seconds to answer "nothing" for Washington. This is the other road: once a
-- week a GitHub Action downloads each state's OpenStreetMap extract from
-- Geofabrik, keeps the places worth going to around the towns people plan
-- trips to, and writes them into discovery_venues. See docs/INGEST.md.
--
-- Until this runs, nothing in the app changes: the venue reader asks for
-- `gone_at`, falls back to reading without it when the column is missing,
-- and the ingest script refuses to start and names this file.

-- ── Seeds: the towns the job reads around ───────────────────────────────
-- One row per town per Geofabrik region. A town near a border has a row in
-- each file its circle reaches: Washington's thirty miles are mostly
-- Maryland and Virginia, and reading only the District's file would miss
-- most of it.
--
-- Thirty miles because nothing reads further: the itinerary menu reads a
-- twenty-five mile box nearest first, Discover fifteen. It was a hundred,
-- which fetched whole neighbouring states and nations to keep places
-- nothing would ever show.
create table if not exists public.ingest_seeds (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  lat              double precision not null,
  lng              double precision not null,
  -- Geofabrik's path, e.g. "north-america/us/north-carolina".
  region           text not null,
  radius_miles     integer not null default 30,
  -- plan, area, profile — or several, comma-joined, when more than one asked.
  source           text not null,
  last_ingested_at timestamptz,
  created_at       timestamptz not null default now(),
  -- The unique rule is on the name folded for case, accents and spacing,
  -- and the region. PostgREST can only name columns as an upsert's conflict
  -- target, not expressions, so the folded name is a column of its own.
  -- Written by scripts/ingest/build-seeds.mjs (nameKey in
  -- lib/discovery/regions.ts), not generated here: lower(name) keeps the
  -- accent, so "Rincón" one week and "Rincon" the next were two rows for a
  -- town the code treats as one. unaccent() is not immutable, so it cannot
  -- sit in a generated column without a wrapper that claims it is.
  name_key         text not null
);

-- For a database that ran an earlier draft of this file: the generated
-- column becomes a plain one (its values stay, already lowered), and the
-- default radius comes down to thirty.
alter table public.ingest_seeds alter column name_key drop expression if exists;
alter table public.ingest_seeds alter column radius_miles set default 30;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ingest_seeds_once') then
    alter table public.ingest_seeds add constraint ingest_seeds_once unique (name_key, region);
  end if;
end $$;

create index if not exists ingest_seeds_region on public.ingest_seeds (region);

comment on table public.ingest_seeds is
  'Towns the weekly OSM load reads around, one row per Geofabrik region their circle touches. Rebuilt by scripts/ingest/build-seeds.mjs.';

-- ── Runs: what each weekly load did ─────────────────────────────────────
-- A place is retired only after two good runs in a row have not seen it, so
-- the job has to know when the last good run started and how much it kept.
-- Stored here rather than guessed from timestamps on the venue rows.
create table if not exists public.ingest_runs (
  id           uuid primary key default gen_random_uuid(),
  region       text not null,
  started_at   timestamptz not null,
  finished_at  timestamptz,
  -- running, ok, failed. Only 'ok' runs count towards retiring anything.
  status       text not null default 'running',
  kept         integer,
  written      integer,
  retired      integer,
  -- Venues kept per seed name: {"Raleigh": 812, "Durham": 440}.
  per_seed     jsonb,
  detail       text
);

create index if not exists ingest_runs_region_started on public.ingest_runs (region, started_at desc);

-- ── Venues: where they came from, and when they went ───────────────────
alter table public.discovery_venues
  add column if not exists region text,
  add column if not exists gone_at timestamptz;

comment on column public.discovery_venues.region is
  'Geofabrik region the weekly load last read this venue from. Null for rows only the sweep has written; the load never retires those.';
comment on column public.discovery_venues.gone_at is
  'Set when two good weekly loads in a row did not see this venue inside a circle they read. Never deleted: events and bookings point here. Cleared if it reappears.';

-- The reader asks for the live venues in a box; the load asks for its own
-- region's live venues not seen lately.
create index if not exists discovery_venues_live_lat_lng
  on public.discovery_venues (lat, lng) where gone_at is null;
create index if not exists discovery_venues_region_seen
  on public.discovery_venues (region, last_seen_at) where gone_at is null;

-- ── Nobody but the job ─────────────────────────────────────────────────
-- Both tables are bookkeeping for a service-role job. With row level
-- security on and no policies, the anon and signed-in keys the app ships
-- can neither read nor write them; the service role is unaffected.
alter table public.ingest_seeds enable row level security;
alter table public.ingest_runs enable row level security;
