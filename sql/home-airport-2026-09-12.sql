-- ─── Home airport ────────────────────────────────────────────────────────
-- Run this in Supabase → SQL Editor. Safe to run more than once.
--
-- The departure airport was guessed from browser geolocation against a fixed
-- table of 50-odd US cities. If someone denied location, lived outside those
-- cities, or was away from home when they planned, the guess was wrong or
-- null — and a wrong departure airport makes every flight estimate wrong,
-- which makes every trip's total wrong.
--
-- These columns let a person state it once. The guess stays as the fallback.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS home_airport TEXT,
  ADD COLUMN IF NOT EXISTS home_city    TEXT;

COMMENT ON COLUMN public.users.home_airport IS
  'IATA code the person departs from, e.g. SFO. Set by them, beats geolocation.';
COMMENT ON COLUMN public.users.home_city IS
  'Display city for the home airport, e.g. "San Francisco, CA".';
