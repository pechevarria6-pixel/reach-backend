# The weekly map load

The sweep (`/api/discovery/sweep`) asks Overpass about one town at a time.
Overpass is donated capacity, and it took 72 seconds to answer "nothing" for
Washington. This is the other road to the same map: once a week a GitHub
Action downloads each state's OpenStreetMap extract from Geofabrik, keeps the
places worth going to around the towns people plan trips to, and writes them
into `discovery_venues`, the table the itinerary menu is read from.

```
plans / discovery_areas / destination_profiles
        │  scripts/ingest/build-seeds.mjs   (Nominatim, 1 request a second)
        ▼
ingest_seeds  ── one row per town per Geofabrik region its 100-mile circle touches
        │  .github/workflows/osm-ingest.yml (Mondays 06:17 UTC, one job per region)
        ▼
Geofabrik .osm.pbf ─osmium tags-filter─▶ travel kinds with a name and a website
        │  scripts/ingest/osm-ingest.mjs → lib/discovery/ingest.ts
        ▼
discovery_venues (upsert on osm_type, osm_id, interest) ──▶ placesFor() menu
        │
        └─ gone_at stamped after two good runs in a row did not see a place
```

## Setting it up (the owner, once)

### 1. Run the migration

Run `sql/world-data-phase1-2026-09-24.sql` in the Supabase SQL editor. It is
safe to run twice. It adds:

- `ingest_seeds`: the towns, unique on `(lower(name), region)` (kept as a
  generated `name_key` column so PostgREST can upsert on it);
- `ingest_runs`: one row per region per run, which is how the job knows when
  the last *good* run started;
- `discovery_venues.region` and `discovery_venues.gone_at`, plus two partial
  indexes on the live rows.

Before it runs, nothing changes for anybody: the menu reader asks for
`gone_at`, sees the column is missing, and reads exactly as it did before;
Discover does the same. The ingest script checks for the tables before it
downloads anything and exits naming this file.

### 2. Build the seeds

From the repository root, with `.env.local` in place:

```
node scripts/ingest/build-seeds.mjs            # dry run: prints every town and its regions
node scripts/ingest/build-seeds.mjs --write    # stores them in ingest_seeds
node scripts/ingest/build-seeds.mjs --only Raleigh --write
```

Each town costs about thirteen Nominatim requests (its centre, eight points on
its rim and four halfway out, so a town near a state line gets a row in every
file its circle reaches) at one a second, so forty towns take around ten
minutes. Re-running is safe: rows are upserted, `radius_miles` and
`last_ingested_at` are left alone, and nothing is deleted. To stop reading a
town, delete its rows by hand (and see "A run that keeps too little" below).

A place in a country `lib/discovery/regions.ts` does not know is logged and
skipped. That is deliberate: a wrong Geofabrik path does not 404, it redirects
to the home page with a 200. To add a country, add its path to the table there
after checking it resolves to a real `.osm.pbf`.

### 3. Add the two secrets to GitHub

The repository is public. The workflow reads exactly two secrets, only through
`env:`, and prints neither.

In GitHub: **Settings → Secrets and variables → Actions → New repository
secret**, twice:

| Name | Value |
|---|---|
| `SUPABASE_URL` | The project URL, `https://<project-ref>.supabase.co` — the same value as `NEXT_PUBLIC_SUPABASE_URL` in Vercel. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Project Settings → API → `service_role` key. |

Nothing else: no variables, no environments, no other secrets. Add them as
*repository* secrets, not environment secrets, or the jobs will not see them.

### 4. Run it once by hand

**Actions → OSM ingest → Run workflow**. Leave *region* empty to load every
region with seeds, or type one (e.g. `north-america/us/north-carolina`). The
first run retires nothing — it has no previous run to compare with.

GitHub turns scheduled workflows off on a public repository after 60 days
without a commit. If the Monday runs stop, that is the first thing to check.

## What a run does

For each region, in its own job (at most two at once, to be polite to
Geofabrik):

1. Downloads `https://download.geofabrik.de/<region>-latest.osm.pbf`, unless
   this ISO week's copy is in the Actions cache and its MD5 matches the one
   Geofabrik publishes. The first bytes must be a PBF header (`OSMHeader`)
   and the checksum must match, or the job fails.
2. `osmium tags-filter`, three passes: the travel kinds (built from the same
   selectors the sweep sends to Overpass — `tagsFor()` in
   `lib/discovery/osm.ts` plus lodging and `amenity=bar/cafe/pub/restaurant`),
   then `website | contact:website | url`, then `name`.
3. `osmium export` to GeoJSON lines, streamed into `ingestRegion()`
   (`lib/discovery/ingest.ts`), which decides everything else:
   - within `radius_miles` of a seed, or not written;
   - filed under every interest whose selectors match, using the sweep's own
     `matchesSelector`, so a venue from the load and the same venue from the
     sweep are the same row; lodging is filed as `places to stay` only;
   - caterers and the like are refused by the same `canTurnUp` rule;
   - one row per `(osm_type, osm_id, interest)` before writing, because
     Postgres refuses an upsert that names a row twice and takes the batch
     with it;
   - upserted in batches of 500 grouped by which columns each row carries, so
     a row without a phone number never writes NULL over one the platforms
     job found. `phone` (made dialable), `city` and `street` are written only
     when the map has them; `website` always is; `opening_hours` and the
     visit tags (`osm_tags`) are written as the map has them now;
   - a batch that fails is retried row by row, so the log names the venue.
4. Retires what has gone (below), stamps `ingest_seeds.last_ingested_at`, and
   records the run in `ingest_runs` with per-seed counts.

The job exits non-zero if **any** row failed to store, if the download was not
a PBF, if osmium failed, or if the run kept too little. Read the log, not the
green tick: every run prints `kept N places as M rows; F failed; R marked
gone`, the skip reasons, and a count per seed.

To try the script without a download or a database:

```
node scripts/ingest/osm-ingest.mjs --region north-america/us/north-carolina \
  --features tests/unit/fixtures/ingest/raleigh.geojsonseq \
  --seeds tests/unit/fixtures/ingest/seeds.json --dry-run
```

## When a place has gone

A venue is marked `gone_at` when it was last seen before the start of the
previous good run — that is, neither last week's run nor this week's saw it —
and only inside a circle this run actually read. Rows are never deleted:
events and bookings point at them. A place that comes back has `gone_at`
cleared by the next upsert. Rows the sweep wrote and the load never has
(`region` is null) are never retired by it.

Nothing is retired by a run that lost a write, or by one that kept under half
of what the last good run kept — a truncated download looks exactly like most
of a state closing. Such a run is recorded as `failed` and does not count as
"the last good run" next week.

**A run that keeps too little on purpose.** After deliberately removing or
shrinking seeds, the next run will keep less and fail that check. Run it once
from *Run workflow* with *accept_drop* ticked.

## How the menu uses it

`placesFor()` (`lib/discovery/real-places.ts`) reads nearest first without
PostGIS: boxes of 2, 5, 12 and 25 miles, stopping once the menu can be filled,
and leaving out of each wider box the kinds it already has enough of. Rows
with `gone_at` set and anything filed as `places to stay` or mapped as lodging
are never on it; a hotel is not dinner, and Reach books rooms through its own
providers, not these rows (the `/bookable` stay line never reads this table).

Each place carries `street` and `hours` (the map's `opening_hours`). The menu
prints them as `hours per OpenStreetMap: …` and tells the model they are
volunteers' notes, never to be stated as certain. A place is dropped only when
the plan has dates **and** the hours parse **and** they say closed for the
whole evening (a single-date night out) or the whole day (anything else) on
every day of the plan. No hours, hours that do not parse, `unknown`, or a
holiday rule we cannot place all keep it.

## Licences and obligations

**OpenStreetMap data — ODbL 1.0.** Everything this job writes is © OpenStreetMap
contributors under the Open Database Licence.

- *Attribution.* Wherever venue data is shown, the screen must credit
  "© OpenStreetMap contributors" with a link to
  <https://www.openstreetmap.org/copyright>. The app does this with
  `OsmCredit` in `components/reach-app.jsx`. Any new surface that shows
  venues (an email, a shared itinerary, a PDF) needs the same credit.
- *Share-alike applies to the database, not to what is made from it.*
  `discovery_venues` is a Derivative Database. Itineraries and screens are
  Produced Works and need only the attribution. If we ever *publicly* offer the
  venue database itself (an export, a public API returning rows in bulk), we
  must offer it under the ODbL, or offer the means to recreate it — this
  repository's filter code is that means.
- *Keep it separable.* Rows from other sources (`source` other than `osm`)
  should stay distinguishable, which the `source` column already does.

**Geofabrik** extracts are free and carry the same ODbL terms. Their only ask
is not to hammer the server: the job downloads each region at most once a week
(cached, checksum-verified) and never more than two at once.

**Nominatim** (seed building only): at most one request a second, with an
identifying User-Agent, and no bulk geocoding. The seed list is a few dozen
towns and the script spaces its requests 1.1 seconds apart and caches rim
points within a run.

**`opening_hours` npm package — LGPL-3.0-only.** Used unmodified as an npm
dependency, on the server only (`lib/discovery/hours.ts`, reached from API
routes, never from the client bundle). Nothing is distributed to users, so the
LGPL's distribution terms are not triggered. If it is ever bundled into client
code, the app must ship its licence text and allow the library to be replaced
(which a separate npm dependency already does). Its own dependencies are
`suncalc` (BSD-2-Clause) and `i18next` (MIT).
