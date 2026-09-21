-- ─── One booking per thing, enforced by the database ────────────────────
-- POST /api/bookings ended in a plain insert with no idempotency key and no
-- check for what was already there, so every call created a row. A
-- double-tapped "Book everything", a retry after a dropped connection, or a
-- refresh at the wrong moment each made another one.
--
-- What that looks like in this table today:
--
--   4×  flight · RDU → PVR · 2026-11-02   awaiting_approval, pending, pending, confirmed
--   3×  flight · RDU → PVR · 2026-11-02   cancelled, pending, confirmed
--
-- For a restaurant that is a duplicated table. For a flight it is a second
-- order with a real fare attached.
--
-- The route now checks before it writes, which stops a retry and a
-- double-tap where the first request has landed. It cannot stop two requests
-- in flight at the same moment — which is exactly what a fast double-tap
-- sends — because both read an empty result before either writes. Only the
-- database can settle that, so it does.

-- The identity of the thing being booked: "flight:rdu|pvr|2026-11-02|…".
-- Computed by the route (lib/booking/duplicate.ts → identityOf) and null
-- when a payload carries nothing identifying, which must never collide.
alter table public.bookings
  add column if not exists idempotency_key text;

-- Only bookings that are actually in play. A failed or cancelled booking is
-- not a duplicate — it is the reason somebody is pressing the button again,
-- and a constraint that blocked the retry would be worse than the bug.
--
-- Nulls never collide in Postgres, so rows with nothing identifiable are
-- unaffected, which is the behaviour we want: we do not claim two things we
-- cannot read are the same thing.
create unique index if not exists bookings_one_live_per_thing
  on public.bookings (plan_id, idempotency_key)
  where idempotency_key is not null
    and status in ('quoted', 'awaiting_approval', 'pending', 'confirmed');

-- Existing duplicates are left exactly as they are. This index only
-- constrains what is written from here on, and creating it will FAIL if the
-- rows above are still live. Check first:
--
--   select plan_id, request_payload->'flight' as flight, count(*), array_agg(status)
--   from public.bookings
--   where status in ('quoted','awaiting_approval','pending','confirmed')
--   group by 1, 2 having count(*) > 1;
--
-- Nothing here deletes anything. If that query returns rows, decide which
-- one is real and cancel the others by hand — a booking is somebody's money
-- and a migration should never pick for them.
