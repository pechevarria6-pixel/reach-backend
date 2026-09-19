-- ─── Why this trip, kept ────────────────────────────────────────────────
-- Generation writes a line per option saying what it does about what
-- somebody actually asked for — "Kyle's Aspen ski trip, booked early
-- November for lower rates". Those lines were on the card the group chose
-- from and then vanished the moment they chose, because nothing stored them.
--
-- So the one screen everybody returns to said nothing about why the trip is
-- what it is, and the answer to "why is this here" lived only in a response
-- that had already been thrown away.
--
-- text[] rather than jsonb, matching dealbreakers and vote_options on this
-- same table: it is a list of sentences, and the table already has a way of
-- holding one.
--
-- Run in the Supabase SQL editor. Safe to re-run. Nothing existing changes.

alter table public.plans add column if not exists why_chosen text[];

-- ── What this does NOT do ───────────────────────────────────────────────
-- It stores no preferences and no answers. These are sentences the model
-- wrote about the plan, already shown to the whole group on the card they
-- picked; nobody's own words are copied here.
