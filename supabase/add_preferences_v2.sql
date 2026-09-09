-- Run this in Supabase SQL Editor
-- Adds all lifestyle preference columns

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS travel_style TEXT,
  ADD COLUMN IF NOT EXISTS trip_frequency TEXT,
  ADD COLUMN IF NOT EXISTS budget_range TEXT,
  ADD COLUMN IF NOT EXISTS climate_preference TEXT DEFAULT 'any',
  ADD COLUMN IF NOT EXISTS dietary_needs TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS seat_preference TEXT DEFAULT 'hotel',
  ADD COLUMN IF NOT EXISTS favorite_activities TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cuisines TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS music_genres TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS dining_vibe TEXT,
  ADD COLUMN IF NOT EXISTS drink_style TEXT,
  ADD COLUMN IF NOT EXISTS nightlife_style TEXT,
  ADD COLUMN IF NOT EXISTS concert_types TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS activity_vibe TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_minor BOOLEAN DEFAULT FALSE;

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'users' AND table_schema = 'public'
ORDER BY ordinal_position;

-- Add No Way José column
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS no_way_jose TEXT[] DEFAULT '{}';
