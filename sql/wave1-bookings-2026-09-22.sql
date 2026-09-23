-- ─── Wave 1: booking correctness (M1 and M2) ────────────────────────────
-- Run me. Written 2026-09-22. Safe to run twice. Nothing here deletes a row
-- or changes one that exists.
--
-- Until this runs the app keeps working, and says so in the log naming this
-- file:
--   * approval claims a booking on approved_at instead of the 'booking'
--     status (lib/booking/claim.ts);
--   * a price rise is written straight into price_cents, as it always was,
--     instead of waiting in pending_price_cents for somebody to accept it.


-- ── M1: 'booking' — claimed by one approval, at the provider right now ──
-- Two presses of "Book it" both read awaiting_approval, both reached the
-- airline, and the group owned two flights. Approval now moves the row to
-- 'booking' with a conditional update before it calls the provider, so only
-- one press can.

-- Postgres names an inline CHECK bookings_status_check, but this table was
-- created from more than one file, so every CHECK that lists the statuses is
-- dropped by what it says rather than by a name we assume.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.bookings'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%awaiting_approval%'
  loop
    execute format('alter table public.bookings drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.bookings add constraint bookings_status_check
  check (status in ('quoted', 'awaiting_approval', 'booking', 'pending',
                    'confirmed', 'redirected', 'failed', 'cancelled'));

-- A row mid-booking is as live as a row can be, so the one-live-booking-per-
-- thing rule must count it. The index may not exist yet: its creation is
-- blocked on the two real Duffel orders for the same flight (MHW2Y3,
-- SFYVFK — see sql/finish-idempotency-2026-09-21.sql, which now creates it
-- with 'booking' included). It is only rebuilt here if it is already there,
-- so this file never fails on those two rows.
do $$
begin
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'bookings_one_live_per_thing') then
    drop index public.bookings_one_live_per_thing;
    create unique index bookings_one_live_per_thing
      on public.bookings (plan_id, idempotency_key)
      where idempotency_key is not null
        and status in ('quoted', 'awaiting_approval', 'booking', 'pending', 'confirmed');
  end if;
end $$;


-- ── M2: pending_price_cents — a new price nobody has agreed to yet ──────
-- When a re-quote at approval came back dearer, the new price was written
-- into price_cents at once. The total rose under a group that had paid the
-- old one, and anybody could send { acceptNewPrice: true } to skip the check
-- altogether. The new price now waits here; it becomes the price only when
-- somebody accepts it, and "accept" means nothing unless there is one here.

alter table public.bookings
  add column if not exists pending_price_cents integer
    check (pending_price_cents is null or pending_price_cents > 0);

comment on column public.bookings.pending_price_cents is
  'A re-quoted price higher than price_cents, waiting to be accepted. Written and cleared only by /api/bookings/[id]/approve.';


-- ── Check ───────────────────────────────────────────────────────────────
-- Expect the constraint to list 'booking', and one row for the column.
select pg_get_constraintdef(oid) from pg_constraint where conname = 'bookings_status_check';
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'bookings' and column_name = 'pending_price_cents';

-- Rows stuck mid-booking. Each may have an order at the provider — check
-- the provider's dashboard before touching one. Nothing retries them.
--   select id, vertical, provider, approved_at from public.bookings where status = 'booking';
