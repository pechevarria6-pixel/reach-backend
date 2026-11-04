-- The venue row an itinerary line cites, by id.
--
-- A table is booked on a platform with the restaurant's id there, carried in
-- its booking link. That id was found by looking the line's venue NAME up
-- near the trip — so a chain's other branch, a few miles off with the same
-- name, could supply it, and Reach would have booked a table at the wrong
-- address under somebody's name. From here the id comes only from the exact
-- row the line was written from (lib/reservations/table-venue.ts).
--
-- Written by the generator from the menu row the slot cites, and by a swap
-- from the new row. Null for every line written before this, and for a line
-- that cites no row: those are handed off with their own link or number,
-- never booked instantly. Safe to run more than once.
alter table public.itinerary_items
  add column if not exists venue_ref uuid references public.discovery_venues (id) on delete set null;
