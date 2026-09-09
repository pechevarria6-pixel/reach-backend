-- Reach engine v3 — run AFTER bookings.sql in Supabase SQL Editor

-- Which external providers each user has pre-signed into (webview sessions).
-- We never store credentials — only the fact that a session exists on-device.
CREATE TABLE IF NOT EXISTS public.connected_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,                 -- Clerk id
  provider TEXT NOT NULL,                -- 'united','chase_travel','opentable','ticketmaster',...
  label TEXT,                            -- display name, e.g. "United MileagePlus"
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','expired','disconnected')),
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, provider)
);

-- Collect-then-approve: each member funds their share before execution.
CREATE TABLE IF NOT EXISTS public.contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id TEXT NOT NULL,
  group_id TEXT,
  user_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT DEFAULT 'USD',
  stripe_payment_intent TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','succeeded','failed','refunded')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contributions_plan_idx ON public.contributions (plan_id);

-- Post-trip ledger: on-trip extras + settle-up.
CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id TEXT NOT NULL,
  group_id TEXT,
  paid_by TEXT NOT NULL,                 -- Clerk id of who fronted it
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT DEFAULT 'USD',
  split_between TEXT[] NOT NULL,         -- Clerk ids sharing this expense
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expenses_plan_idx ON public.expenses (plan_id);
