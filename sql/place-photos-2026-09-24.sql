-- ─── Real pictures of the real thing ────────────────────────────────────
-- Run me. Written 2026-09-24. Safe to run twice.
--
-- People want to see what they are being sent to — the band, the room, the
-- ballpark. The rule is the one every sentence in Reach follows: a picture
-- goes on a card only when something about THAT row says it is a picture of
-- that place or that act, and its credit travels with it. See
-- lib/discovery/place-photo.ts.
--
-- Until this runs the app keeps working exactly as before: venue cards show
-- the venue's own og:image where the harvest found one (credited to its
-- site), Ticketmaster cards show the act's image from the live response,
-- itinerary lines and cached events carry no picture, and trip ideas look
-- their destination up on Wikipedia as they did. Nothing fails; the log
-- names this file.

-- ── Venues ──────────────────────────────────────────────────────────────
-- image_url and image_source exist already (venue-images-2026-09-21.sql).
-- image_source is now 'wikimedia' (the map entry's own wikidata item or
-- Commons file) or 'og' (the venue's own website). Wikimedia wins: it
-- carries an author and a licence; og is what the venue chose to be shared.
alter table public.discovery_venues
  -- "Jane Doe / Wikimedia Commons, CC BY-SA 4.0". Never null when
  -- image_source is 'wikimedia': a file without a credit is not shown.
  add column if not exists image_credit text,
  -- The file's page on Commons, so the credit can be followed.
  add column if not exists image_link text,
  -- When the photo job last looked, found or not, so it is not asked again
  -- every night about a place with no picture.
  add column if not exists image_checked_at timestamptz;

comment on column public.discovery_venues.image_credit is
  'Author and licence of a Wikimedia image, e.g. "Jane Doe / Wikimedia Commons, CC BY-SA 4.0". Shown with the picture.';

-- ── Events ──────────────────────────────────────────────────────────────
-- A Ticketmaster event's own image (the act, else the event art, else its
-- venue), kept with the cached row so a cached gig looks like the live one.
alter table public.discovery_events
  add column if not exists image_url text,
  add column if not exists image_credit text;

-- ── Itinerary lines ─────────────────────────────────────────────────────
-- The photo of the verified venue a line names, attached by the generator
-- from the row it cited — never looked up by name.
alter table public.itinerary_items
  add column if not exists venue_image_url text,
  add column if not exists venue_image_credit text;

-- ── Destinations ────────────────────────────────────────────────────────
-- Wikipedia's page image for a destination, looked up once and kept, so a
-- trip idea or a plan card never waits on Wikipedia twice for Moab. A miss
-- is kept too (url null) so an unknown town is not asked about on every
-- generation; it is asked again after a fortnight.
create table if not exists public.destination_photos (
  -- lib/discovery/destination-photo.ts articleTitle(), lower-cased.
  destination  text primary key,
  url          text,
  width        integer,
  height       integer,
  credit       text,
  source       text,
  checked_at   timestamptz not null default now(),
  -- A picture is never stored without its credit.
  constraint destination_photos_credited check (url is null or credit is not null)
);
-- Read and written only by the app's own server, with the service key.
alter table public.destination_photos enable row level security;
