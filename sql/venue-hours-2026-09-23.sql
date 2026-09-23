-- ─── What the map already says about a venue ─────────────────────────────
-- Run me. Written 2026-09-23. Safe to run twice.
--
-- OpenStreetMap carries opening hours, a phone number, and tags for what a
-- place serves and takes (cuisine, diet:*, payment:*, reservation). The sweep
-- read them and threw them away, so the itinerary could only guess whether a
-- stop was open that evening or took cards. Phone already has a column; these
-- are the other two. Until this runs the sweep saves venues without them.

alter table public.discovery_venues
  add column if not exists opening_hours text,
  add column if not exists osm_tags jsonb;

comment on column public.discovery_venues.opening_hours is
  'OSM opening_hours, as mapped (e.g. "Mo-Th 11:00-22:00;Fr-Sa 11:00-23:00"). Raw; parsed where it is read.';
comment on column public.discovery_venues.osm_tags is
  'The OSM tags that describe the visit: cuisine, diet:*, payment:*, reservation, takeaway, outdoor_seating, wheelchair, drink:*.';
