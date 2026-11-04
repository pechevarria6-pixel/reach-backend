-- ─── Reservation calls: the AI assistant that rings a restaurant ────────
-- Run me. Written 2026-11-04. Safe to run twice. Nothing here changes or
-- deletes a row that exists.
--
-- Until this runs, POST /api/bookings/[id]/call answers 503 naming this
-- file and no call is placed: the one-call-per-reservation rule, the daily
-- cap and the do-not-call list all live in these tables, and a call made
-- without them would be made without its limits.
--
-- No call reaches a restaurant whatever this file does. That is
-- RESERVATION_CALLS_MODE (off | test | live) and, for live,
-- RESERVATION_CALLS_LAWYER_APPROVED=yes — see lib/reservations/gate.ts.


-- ── reservation_calls: one row per call, written before the call is placed ──
create table if not exists public.reservation_calls (
  id                uuid primary key default gen_random_uuid(),
  booking_id        uuid not null references public.bookings(id) on delete cascade,
  plan_id           uuid not null,
  requested_by      uuid not null,
  -- test calls ring RESERVATION_TEST_NUMBER and never change a booking.
  mode              text not null check (mode in ('test', 'live')),
  provider          text not null check (provider in ('retell', 'vapi')),
  provider_call_id  text,
  -- The number actually rung (the test number in test mode) and the
  -- venue's own, which is what the do-not-call list and the landline check
  -- are about.
  dialed_number     text not null,
  venue_phone       text not null,
  -- The daily cap, held by the database: each call takes a numbered slot
  -- for its UTC day, and there are fifty. Two requests at the same instant
  -- cannot both take slot 50.
  call_day          date not null,
  day_slot          integer not null check (day_slot between 1 and 50),
  -- placing → calling (the provider took it) → settled, or
  -- placing → unknown (we could not read the provider's answer; a call may
  -- have rung, so it is never retried).
  status            text not null default 'placing'
                      check (status in ('placing', 'calling', 'unknown', 'settled')),
  -- The facts the call was built from: restaurant, date, time, party, name, notes.
  request           jsonb not null,
  opening           text not null,
  outcome           text check (outcome in ('confirmed', 'alternative_offered', 'no_availability',
                      'voicemail', 'no_answer', 'refused', 'do_not_call', 'needs_guest',
                      'unclear', 'failed_to_place')),
  -- The staff's own words the outcome rests on, and why a claim was doubted.
  staff_quote       text,
  outcome_detail    jsonb,
  -- Whether the first thing the assistant said was the full disclosure. A
  -- false here stops every later call (lib/reservations/call.ts).
  disclosed         boolean,
  transcript        jsonb,
  created_at        timestamptz not null default now(),
  placed_at         timestamptz,
  settled_at        timestamptz
);

-- One call per reservation, per mode: a test never uses up the real call.
create unique index if not exists reservation_calls_one_per_booking
  on public.reservation_calls (booking_id, mode);
create unique index if not exists reservation_calls_day_slot
  on public.reservation_calls (call_day, day_slot);
-- A provider's retried webhook finds the same row, never a second one.
create unique index if not exists reservation_calls_provider_call
  on public.reservation_calls (provider, provider_call_id)
  where provider_call_id is not null;
create index if not exists reservation_calls_undisclosed
  on public.reservation_calls (created_at) where disclosed = false;

comment on table public.reservation_calls is
  'AI reservation calls. Written by /api/bookings/[id]/call and settled by /api/webhooks/reservation-call. Never deleted by the app except a claim the provider refused before anything rang.';


-- ── reservation_do_not_call: a restaurant that said stop, forever ──────
-- Nothing in the app deletes from this table. "Please stop calling" is
-- honoured permanently, as Google does for Duplex.
create table if not exists public.reservation_do_not_call (
  phone       text primary key,
  reason      text not null check (reason in ('asked', 'refused', 'owner')),
  call_id     uuid references public.reservation_calls(id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.reservation_do_not_call is
  'Venue numbers (E.164) the reservation assistant must never ring again. Append-only: nothing in the app removes a row.';

-- Both tables are server-only (the service key); no member reads them directly.
alter table public.reservation_calls enable row level security;
alter table public.reservation_do_not_call enable row level security;


-- ── Check ───────────────────────────────────────────────────────────────
-- Expect two rows.
select table_name from information_schema.tables
 where table_schema = 'public' and table_name in ('reservation_calls', 'reservation_do_not_call');
