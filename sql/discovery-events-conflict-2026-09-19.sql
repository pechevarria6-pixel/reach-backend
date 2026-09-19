-- ─── Making the uniqueness rule usable, not just true ───────────────────
-- Correcting sql/discovery-events-sources-2026-09-18.sql, which created
--
--   create unique index discovery_events_external_once
--     on discovery_events (source, external_id)
--     where external_id is not null;
--
-- A partial index enforces uniqueness perfectly well. It cannot be used to
-- RESOLVE a conflict: Postgres will only infer a partial index for
-- "on conflict (source, external_id)" when the statement repeats the index's
-- own where-clause, and PostgREST has no way to send one. So every cache
-- write failed with 42P10 — "no unique or exclusion constraint matching the
-- ON CONFLICT specification" — and Discover quietly stored nothing.
--
-- The predicate is not needed. In a unique index NULLs are distinct from one
-- another, so every harvested row (external_id null) coexists happily under
-- a plain rule, and rows that do have an id are still unique per source.
--
-- Run in the Supabase SQL editor. Safe to re-run.

drop index if exists discovery_events_external_once;

create unique index if not exists discovery_events_external_once
  on public.discovery_events (source, external_id);

-- ── Why this is safe ────────────────────────────────────────────────────
-- Harvested rows have no external_id, and a unique index treats each null as
-- its own value — so a thousand harvested rows for one source never collide.
-- The rule that governs them is still (venue_id, title, when_text), which is
-- untouched.
