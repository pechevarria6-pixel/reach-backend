-- ─── Discovery engine ────────────────────────────────────────────────────
-- Reach sources what there is to do from open data as well as from partner
-- catalogues. OpenStreetMap knows about the pottery studio that has never
-- been ticketed or reviewed; Overpass, the query API in front of it, is run
-- by volunteers, answers 504 under load, and hangs rather than refusing when
-- it is merely busy. So nothing queries it while somebody is waiting: a
-- background sweep fills these tables and Discover reads them.
--
-- Run in the Supabase SQL editor. Every statement is safe to run twice, so
-- if it stops part way through you can fix that line and run the whole file
-- again without undoing anything.

-- Postgres 13 and later have gen_random_uuid() built in, but a project
-- restored from an older snapshot may not. Harmless when already present.
create extension if not exists pgcrypto;

-- ── Where we have been asked about ──────────────────────────────────────
-- Coordinates rounded to about seven miles, so everybody in a city shares
-- one area rather than each person minting their own and the sweep never
-- catching up.
create table if not exists discovery_areas (
  id            uuid primary key default gen_random_uuid(),
  lat           double precision not null,
  lng           double precision not null,
  city          text,
  interests     text[] not null default '{}',
  asked_count   integer not null default 1,
  last_asked_at timestamptz not null default now(),
  last_swept_at timestamptz,
  sweep_status  text,
  sweep_detail  text,
  created_at    timestamptz not null default now()
);

-- ── The places themselves ───────────────────────────────────────────────
-- One row per thing on the map that has a name and a website, because a
-- card nobody can act on is not a card.
create table if not exists discovery_venues (
  id            uuid primary key default gen_random_uuid(),
  osm_type      text not null,
  osm_id        bigint not null,
  name          text not null,
  lat           double precision not null,
  lng           double precision not null,
  city          text,
  website       text not null,
  -- Which of our interests this answers, in our words rather than OSM's.
  interest      text not null,
  -- What the map calls it: "pottery", "arts centre", "cooking school".
  kind          text,
  street        text,
  found_at      timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

-- Harvesting: going and reading the venue's own site for actual classes.
alter table discovery_venues add column if not exists last_harvested_at timestamptz;
alter table discovery_venues add column if not exists harvest_status text;

-- ── What is actually on ─────────────────────────────────────────────────
-- A venue is a place that is open on Tuesdays. This is "Wednesday, 7pm,
-- £45", read from the venue's own page. Everything here is quoted from that
-- page rather than inferred, because a made-up price is a lie about money
-- and a made-up date sends somebody to a locked door.
create table if not exists discovery_events (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references discovery_venues(id) on delete cascade,
  title         text not null,
  -- The date when the page states one, and the page's own words either way:
  -- "Wednesdays, 7-9pm" is useful and is not a date.
  starts_on     date,
  when_text     text,
  price_text    text,
  booking_url   text not null,
  interest      text,
  found_at      timestamptz not null default now(),
  -- A class list read in September is not to be trusted in December.
  stale_after   timestamptz not null default (now() + interval '21 days')
);

create index if not exists discovery_events_venue on discovery_events (venue_id);
create index if not exists discovery_events_fresh on discovery_events (stale_after);

-- ── Constraints and indexes, separately ─────────────────────────────────
-- Stated on their own rather than inline so that re-running the file cannot
-- fail on a constraint that already exists, and so a failure here names the
-- one thing that went wrong.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'discovery_areas_at') then
    alter table discovery_areas add constraint discovery_areas_at unique (lat, lng);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'discovery_venues_once') then
    alter table discovery_venues add constraint discovery_venues_once unique (osm_type, osm_id, interest);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'discovery_events_once') then
    alter table discovery_events add constraint discovery_events_once unique (venue_id, title, when_text);
  end if;
end $$;

-- Discover asks "what is near this point, for these interests", and those
-- two things in that order are what the index has to serve.
create index if not exists discovery_venues_at on discovery_venues (lat, lng);
create index if not exists discovery_venues_interest on discovery_venues (interest);

-- These hold public map data and no personal information, so nothing here is
-- user-scoped. They are written only by the service role, which bypasses RLS;
-- the app reads them through API routes like everything else. RLS is on so
-- that the anon key cannot read them directly.
alter table discovery_areas  enable row level security;
alter table discovery_venues enable row level security;
alter table discovery_events enable row level security;

-- ── Did it work? ────────────────────────────────────────────────────────
-- Run this on its own afterwards. Three rows means yes.
-- select table_name from information_schema.tables
--  where table_name in ('discovery_areas','discovery_venues','discovery_events');
