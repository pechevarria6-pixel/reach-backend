-- ─── Reach core schema ───────────────────────────────────────────────────
-- The tables the app has always depended on but that were never checked in:
-- they existed only in the live Supabase project, so the repo could not be
-- stood up from scratch. Run this FIRST, before bookings.sql.
--
-- Safe to run against an existing database: every statement is IF NOT EXISTS
-- or ADD COLUMN IF NOT EXISTS, so it will not clobber live data.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── users ────────────────────────────────────────────────────────────────
-- `id` is the identifier every other table references. `clerk_id` is the
-- external identity; it is never stored anywhere but here.
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  auth_provider TEXT DEFAULT 'email',
  date_of_birth DATE,
  is_minor BOOLEAN,
  phone TEXT,
  first_name TEXT,
  last_name TEXT,
  ktn TEXT,
  loyalty_programs JSONB,
  stripe_customer_id TEXT,

  -- Encrypted PII (see lib/encryption.ts) — never stored in plaintext.
  passport_number_enc TEXT,
  tsa_precheck_enc TEXT,
  global_entry_enc TEXT,

  -- Preference quiz
  seat_preference TEXT,
  dietary_needs TEXT,
  climate_preference TEXT,
  travel_style TEXT,
  trip_frequency TEXT,
  budget_range TEXT,
  favorite_activities TEXT[],
  cuisines TEXT[],
  music_genres TEXT[],
  dining_vibe TEXT,
  drink_style TEXT,
  nightlife_style TEXT,
  concert_types TEXT[],
  activity_vibe TEXT[],
  no_way_jose TEXT[],

  -- Consent + GDPR
  consent_personalized BOOLEAN DEFAULT false,
  consent_analytics BOOLEAN DEFAULT false,
  consent_marketing BOOLEAN DEFAULT false,
  consent_third_party BOOLEAN DEFAULT false,
  consent_recorded_at TIMESTAMPTZ,
  deletion_requested_at TIMESTAMPTZ,
  deletion_scheduled_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_clerk_idx ON public.users (clerk_id);
CREATE INDEX IF NOT EXISTS users_email_idx ON public.users (email);

-- ── groups ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  emoji TEXT,
  created_by UUID REFERENCES public.users (id) ON DELETE SET NULL,
  wallet_balance_cents INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS group_members_user_idx ON public.group_members (user_id);
CREATE INDEX IF NOT EXISTS group_members_group_idx ON public.group_members (group_id);

-- ── plans ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'trip'
    CHECK (type IN ('trip', 'restaurant', 'concert', 'weekend')),
  status TEXT NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning', 'voting', 'approved', 'booked', 'completed', 'cancelled')),
  start_date DATE,
  end_date DATE,
  budget_cents INTEGER NOT NULL DEFAULT 0,
  accommodation TEXT,
  vibe TEXT,
  destination_style TEXT,
  dealbreakers TEXT[] DEFAULT '{}',
  vote_options TEXT[] DEFAULT '{}',
  created_by UUID REFERENCES public.users (id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  booked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plans_group_idx ON public.plans (group_id);

-- ── votes ────────────────────────────────────────────────────────────────
-- One vote per member per plan; the API relies on this constraint.
CREATE TABLE IF NOT EXISTS public.votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.plans (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  option TEXT NOT NULL,
  voted_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (plan_id, user_id)
);

-- ── itinerary_items ──────────────────────────────────────────────────────
-- `scheduled_time` is TEXT on purpose: it holds human labels like
-- "Day 2 PM" and "7:30 PM" as often as it holds a clock time.
CREATE TABLE IF NOT EXISTS public.itinerary_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.plans (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('flight', 'hotel', 'activity', 'restaurant', 'transport')),
  title TEXT NOT NULL,
  subtitle TEXT,
  scheduled_time TEXT,
  confirmation_number TEXT,
  is_confirmed BOOLEAN NOT NULL DEFAULT false,
  booking_source TEXT,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS itinerary_plan_idx ON public.itinerary_items (plan_id, sort_order);

-- ── payments ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID REFERENCES public.plans (id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.users (id) ON DELETE SET NULL,
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  stripe_refund_id TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'refunded', 'partially_refunded')),
  split_method TEXT CHECK (split_method IN ('personal', 'wallet', 'split')),
  mfa_verified BOOLEAN NOT NULL DEFAULT false,
  refund_amount_cents INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_intent_idx ON public.payments (stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS payments_plan_idx ON public.payments (plan_id);

-- ── supporting tables ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.loyalty_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  program_name TEXT NOT NULL,
  tier TEXT,
  points INTEGER,
  number_enc TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users (id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource TEXT,
  resource_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  success BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_user_idx ON public.audit_logs (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users (id) ON DELETE CASCADE,
  clerk_id TEXT,
  email TEXT,
  scheduled_for TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Row Level Security ───────────────────────────────────────────────────
-- Every API route uses the service-role key, which bypasses RLS, and all
-- authorization happens in lib/auth.ts. RLS is enabled anyway so that the
-- anon key (shipped to the browser) cannot read anything directly.
ALTER TABLE public.users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itinerary_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_programs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deletion_requests ENABLE ROW LEVEL SECURITY;
