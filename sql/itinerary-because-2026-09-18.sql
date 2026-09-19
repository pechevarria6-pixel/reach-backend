-- ─── Whose wish this bit of the trip is ─────────────────────────────────
-- The itinerary is now written from what each member said about this trip:
-- their summary, the thing they want to make sure happens, the thing they
-- would rather avoid. The plan that comes back genuinely answers them —
-- "Walk down to Playa Los Muertos for sunset" exists because somebody wrote
-- "watch the sunset from the beach".
--
-- Nothing recorded the connection, so the itinerary could answer a person
-- and never tell them. One column, so a line can say whose it is.
--
-- Run in the Supabase SQL editor. Safe to re-run. Nothing existing changes;
-- every row simply gains a null, which reads as "no particular reason".

alter table public.itinerary_items add column if not exists because text;

-- ── What this does NOT do ───────────────────────────────────────────────
-- It holds a short sentence the model wrote about the plan — "Peter asked
-- for one big night out" — and never anybody's answers. What somebody said
-- stays in plan_preferences, readable only by them.
