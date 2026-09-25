-- ─── "Sam suggests Bar X · 👍 2" ─────────────────────────────────────────
-- Run me. Written 2026-09-25. Safe to run twice.
--
-- Before a group trip is locked in, any member can suggest a different pick
-- for one line of the itinerary; the others can 👍 it; the organiser
-- applies it. (After lock, only the organiser changes a line, and that goes
-- through the booking path, not through here.) Nothing stores a suggestion
-- today — probed 2026-09-25, itinerary_item_suggestions answers PGRST205.
--
-- itinerary_item_suggestions      one member's "how about this instead"
-- itinerary_item_suggestion_votes one 👍 per person per suggestion
--
-- What a suggestion may name is the same as what the generator may name:
-- a place on the verified menu for that slot (tests/unit/grounding.test.ts).
-- candidate_ref is that place's stable ref ("osm:12345", as in
-- recommendation_feedback.item_ref), and the route resolves it against the
-- menu before writing. This table never holds a free-typed venue name as if
-- it were a place; "Something else…" free text goes through the grounded
-- single-slot regeneration, and only what that returns can be suggested.
--
-- Solo trips have nobody to suggest to. The route refuses; the screen never
-- shows it.

create table if not exists public.itinerary_item_suggestions (
  id             uuid primary key default gen_random_uuid(),
  plan_id        uuid not null references public.plans(id) on delete cascade,
  -- A rebuilt itinerary replaces its lines (lib/itinerary-replace.ts), and a
  -- suggestion about a line that no longer exists has nothing to apply to.
  item_id        uuid not null references public.itinerary_items(id) on delete cascade,
  suggested_by   uuid not null references public.users(id) on delete cascade,
  candidate_ref  text not null,
  -- What the menu said about it when it was suggested: name, kind, street,
  -- estimated price. A snapshot for display; candidate_ref is the identity.
  candidate      jsonb not null default '{}'::jsonb,
  -- The one line on why, as the person wrote it. Optional.
  note           text check (note is null or char_length(note) <= 280),
  status         text not null default 'open'
                   check (status in ('open', 'applied', 'withdrawn', 'dismissed')),
  decided_by     uuid references public.users(id) on delete set null,
  decided_at     timestamptz,
  created_at     timestamptz not null default now(),
  check ((status = 'open') = (decided_at is null))
);

-- Two people suggesting the same bar for the same line is one suggestion
-- with two 👍, not two cards. And a double-tapped "Suggest" is two
-- concurrent inserts; this turns the second into a conflict.
create unique index if not exists itinerary_item_suggestions_one_open
  on public.itinerary_item_suggestions (item_id, candidate_ref)
  where status = 'open';

create index if not exists itinerary_item_suggestions_by_plan
  on public.itinerary_item_suggestions (plan_id, status);

alter table public.itinerary_item_suggestions enable row level security;

create table if not exists public.itinerary_item_suggestion_votes (
  suggestion_id  uuid not null references public.itinerary_item_suggestions(id) on delete cascade,
  user_id        uuid not null references public.users(id) on delete cascade,
  created_at     timestamptz not null default now(),
  -- One 👍 per person per suggestion.
  primary key (suggestion_id, user_id)
);

create index if not exists itinerary_item_suggestion_votes_by_user
  on public.itinerary_item_suggestion_votes (user_id);

alter table public.itinerary_item_suggestion_votes enable row level security;

comment on table public.itinerary_item_suggestions is
  'A member''s suggested replacement for one itinerary line, before lock. candidate_ref names a place on the verified menu; only the organiser applies it. Never on a solo trip.';
comment on table public.itinerary_item_suggestion_votes is
  'One 👍 per person per suggestion.';

-- Read and written only through the app's own server with the service role;
-- no policy for anon or authenticated, on purpose.
