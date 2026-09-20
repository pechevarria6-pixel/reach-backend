-- ─── Which platform a restaurant actually takes bookings on ─────────────
-- Reach does not book the table. The member does, on their own account and
-- their own card, because that is where their card's dining benefits live —
-- Amex opens doors on Resy, Chase on OpenTable — and a reservation made by
-- us on our card throws all of that away.
--
-- For that to work we have to know where to send them, and we have to know
-- it before they ask: looking it up live, per person, per tap, is a third
-- party in the critical path of a screen somebody is waiting on.
--
-- Run in the Supabase SQL editor. Safe to re-run. Nothing existing changes;
-- every venue simply gains a null, which reads as "we do not know yet" and
-- sends the member to the phone number instead of to a guess.

alter table public.discovery_venues
  add column if not exists reservation_platform text;

-- The restaurant's own booking page when the harvest found one. A link they
-- published beats anything we construct from a name.
alter table public.discovery_venues
  add column if not exists reservation_url text;

-- For the venues with no platform at all: the number you ring.
alter table public.discovery_venues
  add column if not exists phone text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'discovery_venues_platform_known') then
    alter table public.discovery_venues add constraint discovery_venues_platform_known check (
      reservation_platform is null
      or reservation_platform in ('resy', 'opentable', 'tock', 'none')
    );
  end if;
end $$;

-- 'none' is a decision — we looked and they take bookings some other way.
-- null is the absence of one. They are different, and the app says something
-- different for each.
create index if not exists discovery_venues_platform
  on public.discovery_venues (reservation_platform)
  where reservation_platform is not null;

-- ── What this does NOT do ───────────────────────────────────────────────
-- It stores no credentials of any kind, and nothing about anybody's card.
-- The perk line in the app comes from a static list of which card works with
-- which platform, not from reading a card anybody holds.
