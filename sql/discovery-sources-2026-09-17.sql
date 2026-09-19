-- ─── Venues from somewhere other than OpenStreetMap ─────────────────────
-- discovery_venues was written for one source. osm_type and osm_id are NOT
-- NULL and the uniqueness rule is (osm_type, osm_id, interest), so a brewery
-- from Open Brewery DB — which has a uuid and no OSM id — cannot be stored at
-- all. This makes room for other sources without touching what is already in
-- the table.
--
-- Run in the Supabase SQL editor before wiring lib/providers/openbrewerydb.ts
-- into the sweep. Safe to re-run: every statement is IF NOT EXISTS or
-- conditional, and existing rows keep working exactly as they are.

-- Where the row came from. Everything already in the table came from OSM.
alter table discovery_venues add column if not exists source text not null default 'osm';
-- That source's own id for the place. Null for OSM rows, which have osm_id.
alter table discovery_venues add column if not exists external_id text;

-- OSM ids stop being required, because a brewery has none. The pair still has
-- to make sense: an OSM row needs its ids, any other source needs an
-- external_id, and neither can be half-filled.
alter table discovery_venues alter column osm_type drop not null;
alter table discovery_venues alter column osm_id drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'discovery_venues_identified') then
    alter table discovery_venues add constraint discovery_venues_identified check (
      (source = 'osm' and osm_type is not null and osm_id is not null)
      or (source <> 'osm' and external_id is not null)
    );
  end if;

  -- One row per place per interest, the same rule as OSM rows have, but for a
  -- source keyed by its own id. Partial, so OSM rows are untouched by it.
  if not exists (select 1 from pg_class where relname = 'discovery_venues_external_once') then
    create unique index discovery_venues_external_once
      on discovery_venues (source, external_id, interest)
      where external_id is not null;
  end if;
end $$;

create index if not exists discovery_venues_source on discovery_venues (source);

-- ── Interest values, written one way ────────────────────────────────────
-- The uniqueness rule is case-sensitive, so the same interest written two
-- ways stored the same venue twice: "Pottery & crafts" and "pottery & crafts"
-- both exist today, and Discover can show one place twice because of it.
--
-- Order matters here. Lowering the values first would make a row collide with
-- the lowercase twin that already exists, and the unique rule would refuse the
-- whole update — so the duplicates go first, then the survivors are folded.
delete from discovery_venues v
using discovery_venues keep
where v.id <> keep.id
  and lower(v.interest) = lower(keep.interest)
  and v.name = keep.name
  and coalesce(v.osm_id, -1) = coalesce(keep.osm_id, -1)
  and coalesce(v.external_id, '') = coalesce(keep.external_id, '')
  and (v.found_at > keep.found_at
       or (v.found_at = keep.found_at and v.id > keep.id));

update discovery_venues set interest = lower(interest) where interest <> lower(interest);
