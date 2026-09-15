-- ─── Discovery engine ────────────────────────────────────────────────────
-- Reach sources what there is to do from open data as well as from partner
-- catalogues. OpenStreetMap knows about the pottery studio that has never
-- been ticketed or reviewed; Overpass, the query API in front of it, is run
-- by volunteers and answers 504 under load and hangs when it is busy.
--
-- So nothing queries it while somebody is waiting. A background sweep fills
-- these tables and Discover reads them, which turns a fifteen second maybe
-- into a single indexed select.
--
-- Run once, in the Supabase SQL editor.

-- What we have been asked about, and when we last went and looked.
-- Coordinates are rounded to about seven miles so that everybody in a city
-- shares one area rather than each person minting their own.
create table if not exists discovery_areas (
  id            uuid primary key default gen_random_uuid(),
  lat           numeric(6,2) not null,
  lng           numeric(6,2) not null,
  city          text,
  interests     text[] not null default '{}',
  asked_count   integer not null default 1,
  last_asked_at timestamptz not null default now(),
  last_swept_at timestamptz,
  sweep_status  text,
  sweep_detail  text,
  created_at    timestamptz not null default now(),
  unique (lat, lng)
);

-- The places themselves. One row per thing on the map that has a name and a
-- website, because a card nobody can act on is not a card.
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
  last_seen_at  timestamptz not null default now(),
  unique (osm_type, osm_id, interest)
);

-- Discover asks "what is near this point, for these interests". Both of
-- those, in that order, are what the index has to serve.
create index if not exists discovery_venues_at
  on discovery_venues (lat, lng);
create index if not exists discovery_venues_interest
  on discovery_venues (interest);

-- These tables hold public map data and no personal information, so nothing
-- here is user-scoped. They are written only by the service role; the app
-- reads them through API routes like everything else.
alter table discovery_areas  enable row level security;
alter table discovery_venues enable row level security;
