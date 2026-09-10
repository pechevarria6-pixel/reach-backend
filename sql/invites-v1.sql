-- ─── Group invites ───────────────────────────────────────────────────────
-- Run AFTER core-schema.sql.
--
-- Before this, you could only add someone to a group if they already had an
-- account: POST /api/groups/[id]/members looked them up by email and 404'd
-- otherwise. Invites let you name someone who has never signed in; the row is
-- claimed automatically the first time they authenticate with that address.

CREATE TABLE IF NOT EXISTS public.group_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,

  -- Always stored lowercased; claiming matches on exact equality.
  email TEXT NOT NULL,

  invited_by UUID REFERENCES public.users (id) ON DELETE SET NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),

  -- Opaque, unguessable; used by the shareable accept link.
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

-- Claiming looks up every pending invite for an address at sign-in.
CREATE INDEX IF NOT EXISTS group_invites_email_idx
  ON public.group_invites (email) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS group_invites_group_idx
  ON public.group_invites (group_id);

ALTER TABLE public.group_invites ENABLE ROW LEVEL SECURITY;
