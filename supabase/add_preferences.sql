-- Run this in your Supabase SQL Editor

ALTER TABLE public.users 
  ADD COLUMN IF NOT EXISTS travel_style TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS trip_frequency TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS budget_range TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS favorite_activities TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_minor BOOLEAN DEFAULT FALSE;

SELECT column_name FROM information_schema.columns 
WHERE table_name='users' AND table_schema='public' ORDER BY ordinal_position;
