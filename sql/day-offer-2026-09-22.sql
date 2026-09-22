-- ─── Keep the day around the evening ─────────────────────────────────────
-- Run me. Written 2026-09-22.
--
-- A night out is one evening. The two things somebody could do earlier that
-- same day are an OFFER — "let's make a day of it" — deliberately kept off
-- the itinerary, because a night out answered with a whole day is the app
-- deciding how long somebody's evening is.
--
-- That offer lives in browser memory and nowhere else, so it disappears on
-- reload: the button is there when the plan is generated and gone when the
-- plan is opened again. The choice is not lost because somebody declined it,
-- it is lost because they came back.
--
-- One jsonb column, holding the same rows the itinerary uses.

alter table public.plans
  add column if not exists day_offer jsonb;

comment on column public.plans.day_offer is
  'Daytime slots offered but not added — the "let''s make a day of it" rows for a night out. Not part of the itinerary: these are only on the plan if somebody accepts them, at which point they move into itinerary_items and this is emptied.';
