-- ─── Every region, every day: the geocoder's memory and the indexes ──────
-- Run me. Written 2026-09-24. Safe to run twice. Best run BEFORE the first
-- whole-region load (see docs/INGEST.md): each index below then builds over a
-- few thousand rows in a moment. Run after, over hundreds of thousands, each
-- `create index` holds a write lock on discovery_venues while it builds —
-- a minute or two, during which the map load's writes wait. Nothing breaks.
--
-- Nothing in the app waits for this file. Before it runs:
--   - build-seeds.mjs finds no ingest_places, says so in its log, and
--     remembers towns from the seeds already stored in ingest_seeds;
--   - every query below still works, only without an index made for it.
--
-- Sizes, measured 2026-09-24 by running the load's own rules (rowsFor in
-- lib/discovery/ingest.ts) over eight real Geofabrik extracts:
--
--   region                 download   places     rows   rows per MB
--   District of Columbia      21 MB    1,893    2,259     108
--   Île-de-France            338 MB   12,610   14,841      44
--   England                1,696 MB   50,323   56,137      33
--   California             1,329 MB   25,100   29,550      22
--   Kanto                    511 MB    8,012    9,540      19
--   North Carolina           428 MB    6,056    7,046      16
--   Mexico                   645 MB    5,280    6,184      10
--   Puerto Rico               74 MB      419      476       6
--
-- The base list (105 files, 27.7 GB of downloads) at those densities —
-- US states 20 rows/MB, Europe 38, Asia 19, elsewhere 10 — is about 670,000
-- rows. A row is about 0.6 kB in the heap (the measured JSON averaged
-- 384–539 bytes, plus the columns the load does not write) and about 0.4 kB
-- across the indexes including the three below: roughly 0.7 GB. Every row is
-- rewritten every week (last_seen_at), and the dead versions are reused
-- after autovacuum rather than returned, so plan on up to twice that: 1.4 GB
-- of the 8 GB on Supabase Pro. Each region a plan adds costs its download
-- size times 10–40 rows. Even the whole planet (about 80 GB of extracts,
-- most of it sparse) would be of the order of 2 million rows, 2–4 GB.

-- ── What the geocoder has said, so no town is asked about twice ─────────
-- One row per town as typed: the name folded, the state and country typed
-- with it (queryKey in lib/discovery/seed-build.ts). lat/lng null means
-- Nominatim found nothing; that is remembered too, and asked again after
-- thirty days rather than every morning.
create table if not exists public.ingest_places (
  query_key    text primary key,
  name         text not null,
  lat          double precision,
  lng          double precision,
  country_code text,
  asked_at     timestamptz not null default now()
);

comment on table public.ingest_places is
  'Nominatim''s answer for each town the seed job has placed, so it is geocoded once. Written by scripts/ingest/build-seeds.mjs. Town names come from private plans: service role only.';

-- A town somebody typed into a private plan. Nobody but the job.
alter table public.ingest_places enable row level security;

-- ── Indexes for a table a hundred times larger ──────────────────────────
-- Discover reads one interest at a time in a box, live rows only, sixty at a
-- time (cachedVenues, lib/discovery/cache.ts). The (lat, lng) index finds the
-- box and then checks every row in it for the interest; in central London
-- that is tens of thousands of rows to find sixty pottery studios. Interest
-- first finds them directly.
create index if not exists discovery_venues_live_interest_at
  on public.discovery_venues (interest, lat, lng) where gone_at is null;

-- The harvester's never-read queue: never harvested, not marked skip, live,
-- oldest id first, sixty rows (app/api/discovery/harvest/route.ts). About a
-- quarter of the rows the load writes are kinds worth reading, so this is
-- the index that keeps the nightly read a few pages of an index rather than
-- a walk of the table in id order.
create index if not exists discovery_venues_harvest_new
  on public.discovery_venues (id)
  where last_harvested_at is null and harvest_status is null and gone_at is null;

-- The harvester's re-read queue: read before, live, oldest reading first.
create index if not exists discovery_venues_harvest_due
  on public.discovery_venues (last_harvested_at)
  where last_harvested_at is not null and gone_at is null;

-- Kept, not replaced: discovery_venues_at (lat, lng) with no gone_at filter
-- still serves the sweep's "what does this area hold" read, which asks
-- without one; the partial discovery_venues_live_lat_lng serves the menu.

-- ── Reclaiming the weekly rewrite sooner ────────────────────────────────
-- The weekly refresh updates every row. With the default scale factor
-- (20% of the table dead before autovacuum starts), a whole region's old
-- versions can sit for days; at 5% the space is reused within the run.
alter table public.discovery_venues set (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);

analyze public.discovery_venues;

-- ── Did it work? ────────────────────────────────────────────────────────
-- Run on its own afterwards. Four rows means yes.
-- select relname from pg_class where relname in
--   ('ingest_places', 'discovery_venues_live_interest_at', 'discovery_venues_harvest_new', 'discovery_venues_harvest_due');
-- And the size, whenever you want it:
-- select pg_size_pretty(pg_total_relation_size('public.discovery_venues'));
