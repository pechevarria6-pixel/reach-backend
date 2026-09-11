-- ─── Catch-up migration ──────────────────────────────────────────────────
-- Run this once, in the Supabase SQL Editor. It is the only thing standing
-- between the live database and the current code.
--
-- Found by comparing every column the application reads or writes against
-- what the database actually has. Two of these were breaking features in
-- production right now:
--
--   users.no_way_jose  — selected by /api/groups/[id]/quiz-status and
--                        /api/trips/generate. Postgres rejects the whole
--                        query, so BOTH return 400: the quiz-status screen
--                        and AI trip generation are dead until this exists.
--
--   group_invites      — the table behind inviting someone who has no
--                        account yet.
--
-- The rest are columns the traveler-autofill path reads. They do not error,
-- because that query selects users(*), but every field comes back undefined,
-- so booking forms silently fail to prefill.
--
-- Safe to run more than once: every statement is IF NOT EXISTS.
--
-- Deliberately NOT wrapped in BEGIN/COMMIT. Inside a transaction a single
-- failing statement rolls back every other one, and the Supabase SQL editor
-- surfaces only the one error — which looks identical to "nothing happened".
-- Standalone statements apply independently, so a partial failure is visible
-- and the rest still lands.

-- ── users: preference and traveler columns the code expects ──────────────

-- Vetoes from the group preference quiz. Its absence is what breaks
-- quiz-status and trip generation.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS no_way_jose TEXT[];

-- Traveler autofill (lib/booking + /api/travelers). Without these, every
-- booking form asks for details the profile already has.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS ktn TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS loyalty_programs JSONB;

-- Encrypted PII, to match passport_number_enc and tsa_precheck_enc.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS global_entry_enc TEXT;

-- ── itinerary_items: which provider produced the row ─────────────────────
ALTER TABLE public.itinerary_items ADD COLUMN IF NOT EXISTS booking_source TEXT;

-- ── group_invites ────────────────────────────────────────────────────────
-- Lets you add someone who has never signed in. The invite is claimed the
-- first time that address authenticates.
CREATE TABLE IF NOT EXISTS public.group_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,

  -- Always stored lowercased; claiming matches on exact equality.
  email TEXT NOT NULL,

  invited_by UUID REFERENCES public.users (id) ON DELETE SET NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),

  -- Opaque and unguessable; used by the shareable accept link.
  token TEXT NOT NULL UNIQUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES public.users (id) ON DELETE SET NULL
);

-- One live invite per address per group. Partial, so a revoked or accepted
-- invite does not block re-inviting the same person later.
CREATE UNIQUE INDEX IF NOT EXISTS group_invites_pending_unique
  ON public.group_invites (group_id, email)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS group_invites_email_idx
  ON public.group_invites (email) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS group_invites_group_idx
  ON public.group_invites (group_id);

ALTER TABLE public.group_invites ENABLE ROW LEVEL SECURITY;

-- ── Verify ───────────────────────────────────────────────────────────────
-- Should return one row reading: all columns present | invites table ready
SELECT
  CASE WHEN (
    SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'users'
       AND column_name IN ('no_way_jose','first_name','last_name','phone',
                           'ktn','loyalty_programs','global_entry_enc')
  ) = 7 THEN 'all columns present' ELSE 'SOME COLUMNS STILL MISSING' END AS users_check,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'group_invites'
  ) THEN 'invites table ready' ELSE 'INVITES TABLE MISSING' END AS invites_check;
