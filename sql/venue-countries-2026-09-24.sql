-- ─── Which country a venue is in, from the map rather than the file ──────
-- Run me. Written 2026-09-24. Safe to run twice. The map load
-- (scripts/ingest/osm-ingest.mjs) refuses to start until it has run.
--
-- Geofabrik cuts every extract wide of the border. Poland's Lubuskie covers
-- the whole of central Frankfurt (Oder); Saxony covers Zgorzelec; Mexico's
-- file covers San Luis, Arizona. So `region` (the file a row was read from)
-- does not say which country the place is in, and a border check that read
-- it dropped a Frankfurt trip's own town hall as "in Poland".
--
-- `countries` is what the load could tell (lib/discovery/geofabrik.ts,
-- countriesAt): the file's own country for a point no other country's file
-- holds; in the overlap, the feature's addr:country or its number written in
-- full; failing both, every candidate — "DE or PL" — which the border check
-- keeps for a trip to either, because nothing on the map says which.
--
-- Null for rows the load has not rewritten yet and for the sweep's rows; the
-- border check then reads `region` as it did before (real-places.ts
-- acrossTheBorder). Every live row is rewritten by its region's next load.
alter table public.discovery_venues
  add column if not exists countries text[];

comment on column public.discovery_venues.countries is
  'ISO 3166-1 codes the place may be in: one where the map says, every candidate where two countries'' Geofabrik files overlap and it does not. Written by scripts/ingest/osm-ingest.mjs; null = not yet known, read region instead.';
