-- Reach savings v1 (NO CUSTODY) — run after engine-v3.sql
-- Reach tracks goals and pace; money stays in members' own accounts
-- until the approval-day funding collection.

CREATE TABLE IF NOT EXISTS public.savings_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id TEXT NOT NULL,
  group_id TEXT,
  user_id TEXT NOT NULL,                 -- Clerk id
  target_cents INTEGER NOT NULL CHECK (target_cents > 0),
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  target_date DATE NOT NULL,             -- funding deadline (trip date minus buffer)
  cadence TEXT NOT NULL DEFAULT 'weekly' CHECK (cadence IN ('weekly','biweekly','monthly')),
  per_period_cents INTEGER NOT NULL,     -- computed at creation
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (plan_id, user_id)
);

-- Self-reported progress check-ins ("I moved $50 to my trip fund").
CREATE TABLE IF NOT EXISTS public.savings_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES public.savings_goals(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS savings_checkins_goal_idx ON public.savings_checkins (goal_id);
