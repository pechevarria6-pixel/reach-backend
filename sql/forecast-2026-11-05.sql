-- ─── Forecasts: what the weather is forecast to do, cached per place ────
-- Run me. Written 2026-11-05. Safe to run twice.
--
-- One row per (source, place): the latest forecast Reach fetched from MET
-- Norway (global, ~9 days) or the US National Weather Service (US only),
-- normalised to periods by lib/forecast.ts. Written by lib/forecast-store.ts
-- when somebody asks for a plan's weather, when a trip's days are written,
-- and by the pings run. Never by a schedule: on Hobby a cron runs once a day,
-- and a forecast once a day old is not the forecast.
--
-- Both sources forbid asking again too soon (MET Norway: never before the
-- response's Expires, and at most every three hours outside the Nordic
-- model). `next_ask_at` is that rule written down, and `lease_until` is the
-- claim that stops two requests at the same instant both asking: a request
-- takes the lease with a conditional update (or the insert below, whose
-- unique index refuses the second), and only the one that got it fetches.
--
-- Until this runs, nothing breaks and nothing is fetched: the store reads a
-- missing table (PGRST205 / 42P01) as "no forecast", and every day shows the
-- climate normals, labelled as usual weather, exactly as before.

create table if not exists public.place_forecast (
  id                uuid primary key default gen_random_uuid(),
  source            text not null check (source in ('met_norway', 'nws')),
  -- Rounded to two places (lib/forecast.ts forecastPoint): about a
  -- kilometre, finer than either model's grid, inside MET Norway's limit.
  lat               numeric(6,2) not null,
  lng               numeric(7,2) not null,
  -- 'pending'      claimed, first fetch in flight
  -- 'ok'           steps hold a forecast
  -- 'not_covered'  the NWS has no grid here (outside the US)
  -- 'failed'       the last fetch failed; steps keep the previous forecast, if any
  status            text not null default 'pending'
                    check (status in ('pending', 'ok', 'not_covered', 'failed')),
  -- The source's periods, normalised (lib/forecast.ts Step[]).
  steps             jsonb,
  -- The place's IANA zone, where the source names it (NWS /points).
  tz                text,
  -- When the source says it last ran its model.
  source_updated_at timestamptz,
  -- When Reach fetched what `steps` holds. Every sentence quotes this.
  fetched_at        timestamptz,
  -- The source's own Expires header.
  expires_at        timestamptz,
  -- The source's Last-Modified, sent back as If-Modified-Since.
  last_modified     text,
  -- The earliest the source may be asked again.
  next_ask_at       timestamptz not null default now(),
  -- A fetch in flight holds this until it finishes or the time passes.
  lease_until       timestamptz,
  -- NWS: the grid and its hourly-forecast link from /points, and when that
  -- was checked (the grid is cached, and re-checked now and then).
  meta              jsonb,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint place_forecast_once unique (source, lat, lng)
);

comment on table public.place_forecast is
  'Latest forecast per (source, place), from MET Norway or the NWS, normalised by lib/forecast.ts. Server only; written by lib/forecast-store.ts. Credit the source wherever it is shown.';

-- Server only. Forecast data is public, but the rows are the app's cache
-- and its claims on the sources' rate limits: no policy is granted to the
-- anon or authenticated roles, so only the service role reads or writes.
alter table public.place_forecast enable row level security;
revoke all on public.place_forecast from anon, authenticated;
