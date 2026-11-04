-- ─── Learning how every restaurant takes a booking, not sixty of them ────
-- On 2026-11-04 Reach knew how 60 of 229,253 restaurants take a booking. The
-- platforms cron (app/api/discovery/platforms) had nowhere to write "looked,
-- and the page did not say", so an unsettled restaurant came round again
-- every night, and it never saw the 176k restaurants filed under "places to
-- eat". The code is fixed and works without this file; this file lets it:
--
--   1. record each look and its outcome, so a restaurant waits out the
--      harvester's back-off instead of being re-read nightly;
--   2. store SevenRooms, Yelp and TheFork as the platforms they are, instead
--      of leaving those restaurants unsettled;
--   3. say where an answer came from — the restaurant's own page, or its
--      OpenStreetMap entry;
--   4. send the rows stored with a link that books nothing back to be read.
--
-- Run in the Supabase SQL editor. Safe to re-run: every statement checks
-- before it changes anything. Nothing anybody can see changes until the
-- cron's next run.

-- ── 1. Where a look is recorded ─────────────────────────────────────────
alter table public.discovery_venues
  add column if not exists reservation_checked_at timestamptz;

-- settled | nothing_found | blocked | unreachable. Null is "never looked".
alter table public.discovery_venues
  add column if not exists reservation_check text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'discovery_venues_reservation_check_known') then
    alter table public.discovery_venues add constraint discovery_venues_reservation_check_known check (
      reservation_check is null
      or reservation_check in ('settled', 'nothing_found', 'blocked', 'unreachable')
    );
  end if;
end $$;

-- ── 2. The platforms a restaurant can be on ─────────────────────────────
-- Dropped and re-added with the wider list. Every value the old check
-- allowed is still allowed, so no existing row can fail it.
alter table public.discovery_venues drop constraint if exists discovery_venues_platform_known;
alter table public.discovery_venues add constraint discovery_venues_platform_known check (
  reservation_platform is null
  or reservation_platform in ('resy', 'opentable', 'tock', 'sevenrooms', 'yelp', 'thefork', 'none')
);

-- ── 3. Where the answer came from ───────────────────────────────────────
alter table public.discovery_venues
  add column if not exists reservation_source text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'discovery_venues_reservation_source_known') then
    alter table public.discovery_venues add constraint discovery_venues_reservation_source_known check (
      reservation_source is null or reservation_source in ('site', 'osm')
    );
  end if;
end $$;

-- The 60 rows settled before today were all read off the restaurant's page.
update public.discovery_venues
   set reservation_source = 'site'
 where reservation_method is not null
   and reservation_source is null;

-- ── 4. Indexes the cron's queries need ──────────────────────────────────
-- Without these, "unsettled restaurants, oldest look first" is a scan of
-- 600k rows, and PostgREST times out (it did, reading this table today).
create index if not exists discovery_venues_reservation_queue
  on public.discovery_venues (reservation_checked_at nulls first)
  where kind = 'restaurant' and reservation_method is null;

create index if not exists discovery_venues_reservation_osm
  on public.discovery_venues (id)
  where kind = 'restaurant' and reservation_method is null and reservation_checked_at is null
    and ((osm_tags->>'reservation') = 'no'
      or (osm_tags->>'reservation:website') is not null
      or (osm_tags->>'reservation:phone') is not null);

-- ── 5. Links that book nothing, sent back to be read ────────────────────
-- Read back today: a stylesheet (Ronnie Sushi, ".../reserve-css.css"), Resy's
-- bare widget host with no restaurant in it, Zenchef's bare host, an events
-- page. The app already refuses these when it reads them (usableStoredUrl in
-- lib/booking/reservations.ts); clearing them puts the restaurant back in the
-- queue so the stricter reader can settle it properly. Only the link-shaped
-- faults are matched here — nothing is cleared for being merely unfamiliar.
update public.discovery_venues
   set reservation_platform = null,
       reservation_method = null,
       reservation_url = null,
       reservation_source = null,
       reservation_check = null,
       reservation_checked_at = null
 where reservation_url is not null
   and (
        reservation_url ~* '\.(css|js|mjs|json|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|pdf|xml)(\?|#|$)'
     or reservation_url ~* '^https?://(www\.|widgets\.)?resy\.com/?([?#].*)?$'
     or reservation_url ~* '^https?://(www\.)?opentable\.[a-z.]+/?([?#].*)?$'
     or reservation_url ~* '^https?://bookings\.zenchef\.com/?([?#].*)?$'
     or reservation_url ~* '/book-an-event'
     or reservation_url ~* '^https?://hotels\.cloudbeds\.com/'
   );

-- The five rows marked 'none' with no method were asked before the method
-- column existed and never answered. 'none' with no method is not an answer.
update public.discovery_venues
   set reservation_platform = null
 where reservation_platform = 'none'
   and reservation_method is null;

-- ── What this does NOT do ───────────────────────────────────────────────
-- It stores nothing fetched from OpenTable, Resy, Tock, SevenRooms, Yelp or
-- TheFork: only links a restaurant published, or its map entry gave.
