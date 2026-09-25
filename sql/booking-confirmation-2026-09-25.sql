-- ─── "I've got it" — the confirmation number somebody brings back ────────
-- Run me. Written 2026-09-25. Safe to run twice.
--
-- Some bookings Reach cannot finish itself. The row carries a redirect_url,
-- the screen says "Finish on <provider> →", and the person books it there.
-- When they come back and tap "I've got it", the one fact worth keeping is
-- the confirmation number the provider gave them, so the trip wallet can
-- show it next to the booking instead of sending them to their inbox.
--
-- It goes on the booking row, not on the itinerary line. itinerary_items
-- already has a confirmation_number, but that is for lines somebody booked
-- entirely on their own with no booking row at all; a redirected booking has
-- a row, and the number belongs with the row that says where it was booked,
-- by whom, and at what price. (Owner decision 12: a new column.)
--
-- Probed 2026-09-25: bookings.confirmation_number answers 42703.
--
-- What this column is NOT: proof. Reach did not see the provider's
-- confirmation, so the screen shows it as what the person entered ("You
-- entered ABC123"), never as "Confirmed by Reach". A row's status is still
-- the only thing that says a booking is confirmed.
--
-- Until this runs, POST /api/bookings/[id]/confirmation fails soft on 42703:
-- "I've got it" still works, the number is simply not kept, and the log
-- names this file.

alter table public.bookings
  add column if not exists confirmation_number text;

do $$
begin
  -- Something a person typed into one box. An empty string is not a number;
  -- the route stores null for "I didn't get one".
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.bookings'::regclass and conname = 'bookings_confirmation_number_shape') then
    alter table public.bookings add constraint bookings_confirmation_number_shape
      check (confirmation_number is null
             or char_length(btrim(confirmation_number)) between 1 and 100);
  end if;
end $$;

comment on column public.bookings.confirmation_number is
  'Confirmation number the member entered on "I''ve got it" after finishing a redirected booking elsewhere. Typed by a person, not verified by Reach — show it as entered.';
