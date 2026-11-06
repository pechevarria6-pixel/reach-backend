-- Venue counts per candidate town, shared by every server instance.
-- Written by lib/recommendations/holdings.ts; read before counting, so a cold
-- instance no longer recounts hundreds of towns (London alone is 16k rows)
-- while Discover's reads wait behind it. Safe to run more than once.
create table if not exists public.town_holdings (
  key         text primary key,
  counts      jsonb not null,
  floor       boolean not null default false,
  counted_at  timestamptz not null default now()
);
create index if not exists town_holdings_counted_at on public.town_holdings (counted_at);
alter table public.town_holdings enable row level security;
-- No policies: only the service role (the server) reads or writes it.
