-- ─── Events that belong to nobody's venue ───────────────────────────────
-- discovery_events was written for one source: the harvest, which reads a
-- venue's own page, so every row hangs off a venue we found first. Three
-- things now need to store an event that has no such venue:
--
--   * Ticketmaster listings, approved as the primary event source for the
--     pilot area — a ticketed gig has a venue name, not a row in our table
--   * Open Brewery DB and the other keyless providers
--   * a booking somebody made elsewhere and logged here, so the group's
--     money math stays whole
--
-- Run in the Supabase SQL editor. Safe to re-run: every statement is
-- IF NOT EXISTS or conditional. Nothing already in the table changes meaning —
-- existing rows are stamped 'harvest', which is what they are.

-- Where the row came from. Everything already there came from the harvest.
alter table discovery_events add column if not exists source text not null default 'harvest';
-- That source's own id for the event, so a second sweep updates rather than
-- duplicates. Null for harvested rows, which are identified by their venue.
alter table discovery_events add column if not exists external_id text;
-- Where it is, when the source says and we have no venue row to ask.
alter table discovery_events add column if not exists venue_name text;
alter table discovery_events add column if not exists lat double precision;
alter table discovery_events add column if not exists lng double precision;
alter table discovery_events add column if not exists city text;

-- A harvested row still belongs to a venue. Everything else does not, and
-- requiring one is what kept these providers out of the table.
alter table discovery_events alter column venue_id drop not null;

do $$
begin
  -- Identifiable either way: harvested rows by their venue, everything else
  -- by the source's own id. Neither can be half-filled.
  if not exists (select 1 from pg_constraint where conname = 'discovery_events_identified') then
    alter table discovery_events add constraint discovery_events_identified check (
      (source = 'harvest' and venue_id is not null)
      or (source <> 'harvest' and external_id is not null)
    );
  end if;

  -- One row per event per source. Partial, so the existing rule on
  -- (venue_id, title, when_text) keeps governing harvested rows untouched.
  if not exists (select 1 from pg_class where relname = 'discovery_events_external_once') then
    create unique index discovery_events_external_once
      on discovery_events (source, external_id)
      where external_id is not null;
  end if;
end $$;

-- Discover asks "what is on near here, soon", and after this it asks that of
-- rows with no venue as well.
create index if not exists discovery_events_where on discovery_events (city);
create index if not exists discovery_events_when on discovery_events (starts_on);
create index if not exists discovery_events_source on discovery_events (source);

-- ── What this does NOT do ───────────────────────────────────────────────
-- It does not delete anything, does not touch discovery_venues, and does not
-- change how a harvested row is read or written. After running it, the app
-- behaves exactly as it does today until the Ticketmaster caching is wired —
-- the columns simply exist to be written to.
