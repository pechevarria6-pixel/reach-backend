-- ─── A second place to buy a ticket ──────────────────────────────────────
-- Run me. Written 2026-09-22.
--
-- One seller is a single point of failure: J. Cole sold out on Ticketmaster
-- in Fayetteville and the plan ended there, with the box office still
-- selling. The app now offers StubHub and VividSeats searches beside the
-- seller's own link, and the one source it cannot offer is the venue itself.
--
-- On an event line, venue_website already holds the TICKET url — the
-- Ticketmaster page — so there is nowhere to put the venue's own address.
-- This adds it.
--
-- Nine of the ninety-six Ticketmaster venues in discovery_events already
-- match a venue we hold a website for, including The Lemon Tree, whose site
-- is literally boxofficeaberdeen.com. Those can be filled in immediately;
-- the rest fill in as the venue sweep reaches them.

alter table public.itinerary_items
  add column if not exists venue_box_office text;

comment on column public.itinerary_items.venue_box_office is
  'The venue''s own website, for a ticketed event whose venue_website is a seller''s page. Never the same host as venue_website — offering one link twice under two headings is not a second source.';
