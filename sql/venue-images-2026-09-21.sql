-- ─── A picture of the actual place ──────────────────────────────────────
-- Discover shows every card on the same orange gradient, so a jazz bar, a
-- pottery studio and a taqueria all look like the same thing — which is the
-- opposite of what a card is for.
--
-- The source is the venue's own og:image: the picture they chose to be shown
-- when somebody shares a link to them. Their photo, of their room, published
-- for exactly this purpose. Nothing is scraped out of the page body and
-- nothing is guessed at, so a venue that publishes none keeps the gradient
-- rather than getting somebody else's photograph.
--
-- Measured across six real venue sites before this column existed: two had
-- one. A third of cards gain a real picture, and none gains a wrong one.
--
-- Run in the Supabase SQL editor. Safe to re-run.

alter table public.discovery_venues
  add column if not exists image_url text,
  -- Where it came from, so a picture can always be traced back — and so a
  -- later source (a ticketing provider's event art, say) can be told apart
  -- from a venue's own.
  add column if not exists image_source text;

comment on column public.discovery_venues.image_url is
  'The venue''s own og:image, read from their site by the harvest. Never scraped from the page body.';
