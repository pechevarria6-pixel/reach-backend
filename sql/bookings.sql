-- Reach booking engine — run in Supabase SQL Editor
CREATE TABLE IF NOT EXISTS public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id TEXT NOT NULL,
  group_id TEXT,
  booked_by TEXT NOT NULL,          -- Clerk user id
  vertical TEXT NOT NULL CHECK (vertical IN ('flight','hotel','activity','event','restaurant')),
  provider TEXT NOT NULL,           -- liteapi | kiwi | viator | ticketmaster | concierge
  mode TEXT NOT NULL CHECK (mode IN ('native','redirect','concierge')),
  status TEXT NOT NULL DEFAULT 'awaiting_approval'
    CHECK (status IN ('quoted','awaiting_approval','pending','confirmed','redirected','failed','cancelled')),
  approved_by TEXT,                 -- Clerk user id of approver
  approved_at TIMESTAMPTZ,
  provider_ref TEXT,                -- confirmation number / booking id
  redirect_url TEXT,
  price_cents INTEGER,
  currency TEXT DEFAULT 'USD',
  detail TEXT,
  request_payload JSONB,
  response_payload JSONB,
  error TEXT,
  fulfilled_by TEXT,                -- ops user who confirmed a concierge ticket
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_plan_idx ON public.bookings (plan_id);
CREATE INDEX IF NOT EXISTS bookings_status_idx ON public.bookings (status) WHERE status = 'pending';
