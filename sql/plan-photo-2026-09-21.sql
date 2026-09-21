-- ─── A picture of the place somebody is actually going ──────────────────
-- A trip card carried the same orange gradient as every other card, so Moab
-- and Charleston and Puerto Vallarta all looked identical — on the screen
-- whose whole job is to make somebody want to go.
--
-- The source is Wikimedia Commons, reached through Wikipedia's page image.
-- Commons hosts only freely licensed media, so there is no question about
-- whether the picture may be shown, and every file carries its photographer
-- and licence. Both are stored beside the picture, because a photograph is
-- somebody's work and the credit travels with it or the picture does not.
--
-- Verified against five real destinations before this column existed:
--
--   Moab, Utah             Quintin Soloviev   CC BY 4.0
--   Puerto Vallarta        Microstar          CC BY-SA 4.0
--   Charleston, SC         Chris Pruitt       CC BY-SA 3.0
--   Raleigh                Abhiram Juvvadi    CC BY-SA 4.0
--
-- Run in the Supabase SQL editor. Safe to re-run.

alter table public.plans
  add column if not exists image_url text,
  -- Who took it and under what. Never null when image_url is set: a picture
  -- without its credit is somebody's work used without saying whose, so the
  -- code drops the photograph rather than showing it bare.
  add column if not exists image_credit text,
  -- The file's page on Commons, so the credit can be followed to the source.
  add column if not exists image_source text;

comment on column public.plans.image_credit is
  'Photographer and licence, e.g. "Quintin Soloviev · CC BY 4.0". Shown wherever the picture is.';
