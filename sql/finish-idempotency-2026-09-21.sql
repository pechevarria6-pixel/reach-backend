-- ═══ WHAT IS LEFT, AND IT HAS TO BE THE SQL EDITOR ═══
-- PostgREST does rows, not schema, so these two statements cannot be run
-- from the app's own credentials. Everything that COULD be done from there
-- has been: the three internal duplicate requests are cancelled.

-- ── 1. The three Duffel rows still blocking the booking index ───────────
-- All three are the same flight, RDU → PVR on 2026-11-02, so the unique
-- index will refuse to build while more than one is live.
--
--   off_0000BAY2TQIBo7vVgwVgrC  awaiting_approval  ← a QUOTE, never approved.
--                                                    No order was placed.
--   MHW2Y3                      confirmed          ← REAL ORDER
--   SFYVFK                      confirmed          ← REAL ORDER
--
-- CHECK MHW2Y3 AND SFYVFK IN DUFFEL BEFORE TOUCHING EITHER. Marking a row
-- cancelled here does not cancel a flight — if one is a live booking you do
-- not want, cancel it in Duffel first, then run the line below for it.
--
-- The unapproved quote is safe to clear on its own:

update public.bookings
   set status = 'cancelled', updated_at = now()
 where provider_ref = 'off_0000BAY2TQIBo7vVgwVgrC'
   and status = 'awaiting_approval';

-- Then whichever confirmed order you decided against, after cancelling it
-- in Duffel. One of MHW2Y3 / SFYVFK must remain live; they are the same
-- flight booked twice.

-- update public.bookings set status = 'cancelled', updated_at = now()
--  where provider_ref = '<MHW2Y3 or SFYVFK — whichever you cancelled>';


-- ── 2. The two indexes ─────────────────────────────────────────────────
-- 'booking' (a row an approval has claimed) was added 2026-09-22 with
-- sql/wave1-bookings-2026-09-22.sql. Listing it here is harmless whichever
-- of the two files runs first.

create unique index if not exists bookings_one_live_per_thing
  on public.bookings (plan_id, idempotency_key)
  where idempotency_key is not null
    and status in ('quoted', 'awaiting_approval', 'booking', 'pending', 'confirmed');

create unique index if not exists contributions_one_per_intent
  on public.contributions (stripe_payment_intent, user_id)
  where stripe_payment_intent is not null;


-- ── 3. Confirm ─────────────────────────────────────────────────────────

select indexname from pg_indexes
 where indexname in ('bookings_one_live_per_thing', 'contributions_one_per_intent');
-- Expect two rows. If the first is missing, more than one booking for that
-- flight is still live.
