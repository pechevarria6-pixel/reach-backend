-- ═══ THE REST OF THE BOOKING MIGRATION, AND THE CONTRIBUTION ONE ═══
-- Run in the Supabase SQL editor, top to bottom. Read step 2 before step 3.

-- ── 1. Did the index actually build? ────────────────────────────────────
-- The column landed when you ran the file. The index almost certainly did
-- not, because duplicates were live and a unique index refuses to build over
-- them. No row returned = it did not build.

select indexname from pg_indexes
 where tablename = 'bookings' and indexname = 'bookings_one_live_per_thing';


-- ── 2. What is blocking it ──────────────────────────────────────────────
-- One group: five live bookings for the same flight, RDU → PVR on
-- 2026-11-02, created by the double-tap this migration exists to prevent.

--   2fa18cf0-ca80-497e-9cd8-34e933e683f3  pending    concierge  CNC-MU8MQC6Y
--   47e09bf2-5509-498f-8c6d-decd0d48e12a  pending    concierge  CNC-MU8MQHFG
--   dd908032-0634-4299-a349-ef05314855fa  pending    concierge  CNC-MU8MWNPA
--   e8a47917-cf95-46ef-906c-16db355214f3  confirmed  duffel     MHW2Y3    ← REAL ORDER
--   31cb8b7b-cdec-49d3-adbf-36070375bdf0  confirmed  duffel     SFYVFK    ← REAL ORDER
--
-- The three `concierge` rows are internal requests. No provider holds an
-- order for them and nothing was charged; cancelling them cancels nothing in
-- the world.
--
-- MHW2Y3 and SFYVFK are real Duffel orders. CHECK THOSE IN THE DUFFEL
-- DASHBOARD FIRST. If one is a live booking you want, keep it and cancel the
-- other there as well as here — marking a row 'cancelled' in this table does
-- not cancel a flight.
--
-- Re-run this any time to see the current state:

select b.id, b.status, b.provider, b.provider_ref, b.price_cents,
       b.request_payload->'flight' as flight, b.created_at
  from public.bookings b
 where b.status in ('quoted','awaiting_approval','pending','confirmed')
   and b.plan_id = '30c78ed1-b351-4815-9107-a8ffed264348'
 order by b.created_at;


-- ── 3. Clear the duplicates you do not want ─────────────────────────────
-- Nothing above deletes anything, and neither does this until you uncomment
-- it. 'cancelled' is outside the index's WHERE clause, so cancelling a row
-- takes it out of the way without losing the record of it.
--
-- The three internal requests, which are safe to cancel:

-- update public.bookings set status = 'cancelled', updated_at = now()
--  where id in ('2fa18cf0-ca80-497e-9cd8-34e933e683f3',
--               '47e09bf2-5509-498f-8c6d-decd0d48e12a',
--               'dd908032-0634-4299-a349-ef05314855fa');

-- And whichever Duffel order you decided against, AFTER cancelling it in
-- Duffel. Put the id in yourself; I am deliberately not choosing.

-- update public.bookings set status = 'cancelled', updated_at = now()
--  where id = '<the one you cancelled in Duffel>';


-- ── 4. Now the index builds ─────────────────────────────────────────────
-- A double-tap can no longer write two live bookings for one thing. Scoped
-- to live statuses, so a retry after a failure still works, and null
-- tolerant so a payload we cannot read never collides with another.

create unique index if not exists bookings_one_live_per_thing
  on public.bookings (plan_id, idempotency_key)
  where idempotency_key is not null
    and status in ('quoted', 'awaiting_approval', 'pending', 'confirmed');


-- ── 5. The same problem, one table over ─────────────────────────────────
-- Found by walking checkout once Stripe was in test mode. Stripe's
-- idempotency key means a double-tap gets back the SAME payment intent —
-- and the insert underneath it still ran twice:
--
--   0bb01d61  pending  $918.81  pi_3UIDYI5GB2FVY7o60RXdYQmY
--   c90c5e97  pending  $918.81  pi_3UIDYI5GB2FVY7o60RXdYQmY
--
-- The webhook finds contributions by intent id, so one payment of $918.81
-- would have been recorded twice: $1,837.62 collected against a $918.81
-- target, and the plan calling itself funded on half the money taken.
--
-- Those two rows were mine, from the test, and are already removed.

create unique index if not exists contributions_one_per_intent
  on public.contributions (stripe_payment_intent, user_id)
  where stripe_payment_intent is not null;

-- If that refuses, something else is duplicated. This finds it:
--
--   select stripe_payment_intent, user_id, count(*),
--          array_agg(id), array_agg(status)
--     from public.contributions
--    where stripe_payment_intent is not null
--    group by 1, 2 having count(*) > 1;
--
-- Keep the row the webhook has touched — the succeeded one if there is one,
-- otherwise the oldest — and delete the rest by id.


-- ── 6. Confirm both are in place ────────────────────────────────────────

select indexname from pg_indexes
 where indexname in ('bookings_one_live_per_thing', 'contributions_one_per_intent');
-- Expect two rows.
