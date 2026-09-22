-- ─── Three sign-offs before a trip is ready to go ────────────────────────
-- Run me. Written 2026-09-22.
--
-- A plan is finished by checking three pages in order: the overview, the
-- budget, and every booking and reservation. Each sign-off is kept here —
-- when and by whom — so the tabs unlock in order for everybody on the trip
-- and "ready to go" means somebody actually looked, not that a bar filled.
--
-- Until this runs the screen keeps the checks in that browser only and says
-- so. Safe to run twice.

alter table public.plans
  add column if not exists review jsonb;

comment on column public.plans.review is
  'Sign-offs, in order: {"overview":{"at","by"},"budget":{...},"bookings":{...}}. Written only by /api/plans/[planId]/review, which refuses a step before the one ahead of it and refuses "bookings" while anything is still to book.';
