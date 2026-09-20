-- ─── The tips that were claims about somebody else's business ───────────
-- The line under each itinerary item is generated, and some of it asserts
-- things only the business could confirm:
--
--   "Milt's is cash-only and has no ATM inside"
--   "Woody's charges a cover only after 9pm on weekends"
--   "Antica Forma's bar seats fill fast after 6pm — go right at open (5pm)"
--   "MARC will fire and hold your glazed pottery … they'll ship it for a fee"
--   "Tamarisk's patio tables all face the river"
--
-- Eleven of the Moab plan's twenty-six. Every one confident, specific,
-- checkable, and checked by nobody. Somebody plans an evening around a 5pm
-- opening and finds a dark window.
--
-- The other fifteen are not claims on anyone's business — weather, crowds,
-- terrain, cell signal — and they stay. Being wrong about the heat at Corona
-- Arch costs an hour. Being wrong about Milt's costs the meal.
--
-- Where a real traveller has written about the same place, their words go in
-- instead, credited. Where nobody has, the item carries no tip, which is a
-- plainer screen and an honest one.

alter table itinerary_items
  -- Moved, not destroyed, for the same reason as payment_note_unverified:
  -- this is the record of what the product was telling people.
  add column if not exists subtitle_unverified text,
  -- Which kinds of claim it was making, so the call can be reviewed rather
  -- than taken on trust — 'money', 'hours', 'availability', 'service',
  -- 'named'. Nothing decides anything from this; it is here to be read.
  add column if not exists subtitle_claims text;

comment on column itinerary_items.subtitle_unverified is
  'A generated tip that asserted something about a named business. Set aside by the verification pass, never shown.';
