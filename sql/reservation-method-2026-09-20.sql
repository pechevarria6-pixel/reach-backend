-- ─── How a restaurant takes a booking, not merely whether we found a link ──
-- The first version of this stored only which third-party platform a
-- restaurant used, so every other restaurant collapsed into 'none' — and the
-- app said "Call to book" to all of them. That is a guess about a place that
-- may take no bookings at all, may hold a waitlist instead, or may have its
-- own form.
--
-- Read off real pages before this column existed:
--   Valenti's, Southern Pines   "For Reservations … join waitlist"  → waitlist
--   Poole's Diner, Raleigh      a Reservations page, which is OpenTable
--   Desert Bistro, Moab         "Make a Reservation" → Tock
--   Casa Santa Ana              a number and online ordering, nothing else
--
-- The last is the common case, and the honest answer for it is not a guess.
--
-- Run in the Supabase SQL editor. Safe to re-run. Every venue gains a null,
-- which means Reach has not settled it yet and will ask again.

alter table public.discovery_venues
  add column if not exists reservation_method text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'discovery_venues_method_known') then
    alter table public.discovery_venues add constraint discovery_venues_method_known check (
      reservation_method is null
      or reservation_method in ('third_party', 'own_form', 'waitlist', 'phone', 'walk_in')
    );
  end if;
end $$;

-- ── Why 'unknown' is not one of the values ──────────────────────────────
-- A restaurant we have not settled keeps a null and stays in the queue. There
-- is no stored state meaning "we had a look and gave up", because that is not
-- an answer to put in front of somebody planning dinner.
