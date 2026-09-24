# The map load

The sweep (`/api/discovery/sweep`) asks Overpass about one town at a time.
Overpass is donated capacity, and it took 72 seconds to answer "nothing" for
Washington. This is the other road to the same map: GitHub Actions downloads
each region's OpenStreetMap extract from Geofabrik, keeps **every** place in
it worth going to, and writes them into `discovery_venues`, the table the
itinerary menu and Discover are read from.

It runs by itself, every day. Nobody needs to press **Run workflow**.

```
plans / discovery_areas / destination_profiles / the world list
        │  scripts/ingest/build-seeds.mjs  (every day; Nominatim only for towns never placed)
        ▼
ingest_places (what the geocoder said, once per town)   ingest_seeds (town × region)
        │
        │  the region list: every US state and territory, the UK's nations,
        │  Mexico, the world list's files, and every region a seed lands in
        ▼
.github/workflows/osm-ingest.yml   Mondays: every region.  Other days: only the new, newly seeded or overdue.
        │  two regions at a time, in batches of at most 200 (GitHub's matrix limit is 256)
        ▼
Geofabrik .osm.pbf ─osmium tags-filter─▶ travel kinds with a name and a website, the whole file
        │  scripts/ingest/osm-ingest.mjs → lib/discovery/ingest.ts
        ▼
discovery_venues (upsert on osm_type, osm_id, interest) ──▶ placesFor() menu, Discover
        │
        └─ gone_at stamped only after two different downloads missed a place
```

## The schedule

| when (UTC) | what |
|---|---|
| every day, 04:43 (06:17 Mondays) | **Seeds**: rebuild the seed list from every plan, Discover area and queued profile |
| Mondays 06:17 | **Load** every region on the list |
| Tuesday to Sunday 04:43 | **Load** only the regions that need it now: never loaded (a plan to Lyon put Rhône-Alpes on the list yesterday), gained their first seed, or overdue (their last good run is more than 7½ days old — a Monday that failed is retried on Tuesday, and every day after until it works) |

One run at a time (`concurrency: osm-ingest`), and within a run two regions
at a time, which is what Geofabrik asks of downloaders. A full Monday is
about 105 regions and 28 GB of downloads; most regions take a few minutes,
England and California longer. Each region's job is given
`30 + MB/15` minutes (England 143, the US Virgin Islands 30) by
`regionMinutes()` in `lib/discovery/ingest-schedule.ts`.

The list is cut into three batches of at most 200 (`planBatches`), which run
one after another. A red region never stops the rest of its batch
(`fail-fast: false`) or the next batch (`if: !cancelled()`). If the list ever
grows past 600 regions the **Which regions** job fails and says so, rather
than dropping any: add a `batch-4` job to the workflow and raise `BATCHES`.

## Setting it up (the owner, once)

### 1. Run the migrations

In the Supabase SQL editor, in this order; both are safe to run twice:

1. `sql/world-data-phase1-2026-09-24.sql` (already run: `ingest_seeds`,
   `ingest_runs`, `discovery_venues.region` and `gone_at`).
2. `sql/ingest-every-region-2026-09-24.sql` — **before the first
   whole-region load if you can**, so its indexes build over a few thousand
   rows rather than hundreds of thousands. It adds `ingest_places` (the
   geocoder's memory), three indexes (Discover's per-interest read and the
   harvester's two queues) and a tighter autovacuum setting for the weekly
   rewrite. Nothing waits for it: before it runs, the seed job remembers
   towns from `ingest_seeds` instead and says so in its log.
3. `sql/venue-countries-2026-09-24.sql` — adds `discovery_venues.countries`,
   which the border check reads (see "Across a border is not nearby"). **The
   map load refuses to start until it has run**: without the column a border
   venue would be judged by its region again. The menu and the booking
   lookup read the region as before until it runs.

### 2. The two secrets

The repository is public. The workflow reads exactly two secrets, only
through `env:`, and prints neither. In GitHub: **Settings → Secrets and
variables → Actions → New repository secret**, twice:

| Name | Value |
|---|---|
| `SUPABASE_URL` | The project URL, `https://<project-ref>.supabase.co` — the same value as `NEXT_PUBLIC_SUPABASE_URL` in Vercel. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Project Settings → API → `service_role` key. |

Add them as *repository* secrets, not environment secrets, or the jobs will
not see them.

### 3. That is all

Merge the branch. The next morning's run rebuilds the seeds and loads every
region that has never been loaded. There is nothing to press.

**One thing can stop it.** GitHub switches scheduled workflows off on a
public repository after 60 days without a commit. If the runs stop, that is
the first thing to check: **Actions → OSM ingest** shows a banner with an
*Enable workflow* button.

## When a region goes red

Open the red job (**Actions → OSM ingest → the run → Load (region) /
region**) and read the log, not the tick. Every run ends with
`kept N places as M rows; F failed; R marked gone`, the skip reasons, and
`seeds that kept nothing: X of Y`.

You usually need to do **nothing**: a region that failed is overdue by the
next morning and is retried every day until it works. What each failure
means:

| the log says | what it is | what to do |
|---|---|---|
| `download failed: HTTP 5xx`, `checksum mismatch`, `did not return a PBF` | Geofabrik mid-rebuild or a bad download | nothing; tomorrow's run tries again, and a same-day re-run uses the copy kept in the cache |
| `kept N places against M last time — a broken download looks like this` | fewer than half of last time's places | nothing, if it clears tomorrow. If it is red two days running, compare with Geofabrik's own count; if the drop is real (you changed what the load keeps), re-run that one region with *accept_drop* (below) |
| `… "Name" (interest): 23514 …` | one venue the database refuses | the log names it; it is a bug in `lib/discovery/ingest.ts` or a constraint, and a code fix |
| `stopped writing after 200 rows failed` | the database refusing everything (paused project, wrong key, out of disk) | check Supabase first: project status, then **Database → Disk usage** |
| `the database is not ready (…) — run sql/…` | a migration has not run | run the file named |
| `"x" is not a region … knows` | a region Geofabrik added after the table was written | `node scripts/ingest/world-regions.mjs` and commit the two generated files |
| the job hit its timeout | a hung download or a slow database | nothing; if it repeats, raise the minutes in `regionMinutes()` |

The **Seeds** job has its own row. A Nominatim refusal there is a yellow
warning (`stopped asking Nominatim …; N towns wait for the next run`), never
red: everything placed is written and the rest are placed tomorrow. Seeds
red means the database could not be read or written, and the load still
runs from the seeds already stored.

### Running one region by hand (only if you want to)

**Actions → OSM ingest → Run workflow**: *region* = one path, e.g.
`north-america/us/north-carolina`; leave *mode* as `due`. *accept_drop*
switches off the half-of-last-time guard and is refused unless a region is
named: with the region empty it would switch the guard off everywhere, and a
region that lost most of its extract upstream that week would be recorded as
good. With whole regions, nothing you do to the seeds can halve a region's
count; only a change to what the load keeps should.

## What a run does

For each region, in its own job:

1. Downloads `https://download.geofabrik.de/<region>-latest.osm.pbf`, unless
   a failed run of the same build kept it in the Actions cache (keyed on
   Geofabrik's published MD5). The first bytes must be a PBF header
   (`OSMHeader`) and the checksum must match, or the job fails. The cache is
   written **only when a load fails**: a week's downloads are about 28 GB and
   the cache holds 10, so caching every download would evict them all in
   turn, and a copy from a good run is never read again — Geofabrik rebuilds
   nightly, so next week's key is a new file.
2. `osmium tags-filter`, three passes: the travel kinds (built from the same
   selectors the sweep sends to Overpass — `tagsFor()` in
   `lib/discovery/osm.ts` plus lodging and `amenity=bar/cafe/pub/restaurant`),
   then `website | contact:website | url`, then `name`.
3. `osmium export` to GeoJSON lines, streamed into `ingestRegion()`
   (`lib/discovery/ingest.ts`), which decides everything else:
   - **every** place in the file is kept — the region is read whole, not in
     circles around the towns people have planned, so a town nobody has
     planned yet already holds what the map knows;
   - filed under every interest whose selectors match, using the sweep's own
     `matchesSelector`, so a venue from the load and the same venue from the
     sweep are the same row; lodging is filed as `places to stay` only;
   - caterers and the like are refused by the same `canTurnUp` rule;
   - written while the export streams, in batches of 500 grouped by which
     columns each row carries (so a row without a phone never writes NULL
     over one the platforms job found), and each `(osm_type, osm_id,
     interest)` sent once per run — Postgres refuses an upsert that names a
     row twice and takes the batch with it;
   - a batch that fails is retried row by row, so the log names the venue;
     after 200 rows fail the run stops writing, counts the rest as failed,
     and goes red.
4. Retires what has gone (below), stamps `ingest_seeds.last_ingested_at`, and
   records the run in `ingest_runs` with a count per seed.

The job exits non-zero if **any** row failed to store, if the download was not
a PBF, if osmium failed, or if the run kept too little.

**Per seed.** A seed no longer decides what is kept. Its count in
`ingest_runs.per_seed` is the number of places within its thirty miles in
this file — what the menu can see around that town. Every seed of the region
is listed, a town with nothing near it as 0, so `seeds that kept nothing` is
the number of towns whose itineraries will name no venues. An empty
`per_seed` means the region had no seeds when it ran; that is how the daily
run knows a region has gained its first.

Seed **names** are not printed. The Actions log is public, and a seed is a
town somebody put in a private plan — a small town's name beside a count
points at a person's trip. `per_seed` and `ingest_places` are readable only
with the service role; on your own machine, `--names` prints them.

To try the load without a download or a database:

```
node scripts/ingest/osm-ingest.mjs --region north-america/us/north-carolina \
  --features tests/unit/fixtures/ingest/raleigh.geojsonseq \
  --seeds tests/unit/fixtures/ingest/seeds.json --dry-run
node scripts/ingest/osm-ingest.mjs --plan --due      # reads the database: what tomorrow would load
```

## Where the seeds and the region list come from

`scripts/ingest/build-seeds.mjs --write` runs first in every workflow run.
A town is placed the way the menu places it: its name with whatever state
was typed after it ("Fayetteville, NC"), and the plan's country.

- **Once per town, ever.** Nominatim is asked only about a town it has never
  been asked about. The answer — found or not — is kept in `ingest_places`
  under the name, state and country as typed, and read back on every later
  run; "not found" is asked again after thirty days. Only an answer is
  kept: a request that failed (a 5xx, the 8-second timeout, the network, a
  body that is not JSON) is not "not found" and is asked again next run
  (`locateOrFail()`). Three failures in a row stop the asking for the run,
  the same way a 429 does. Every town whose request failed is named in a
  `::warning::` on every run, whether or not the run stopped: one town
  Nominatim fails on each morning, between successes, is remembered nowhere
  and would otherwise go unseeded in a green job with nothing said.
- **At most one request a second, at most 100 a run.** A 429 (or a 403, how
  Nominatim answers a blocked agent) stops the asking at once and cleanly:
  everything already placed is written, and the rest wait for tomorrow. The
  run stays green with a warning.
- **Which files a town's circle reaches** is answered from the polygons in
  Geofabrik's own index (`lib/discovery/geofabrik.ts`), not from thirteen
  more Nominatim requests. A file across a national border is never read on
  a town's word (San Diego's circle reaches Tijuana; Seoul's the DMZ).
- **A Discover area** (a point, no state) joins a town of the same name only
  within fifteen miles of it; otherwise it is a town of its own.
- **A wonder is not a town.** A plan to *Machu Picchu*, *Petra*, *Chichén
  Itzá*, *Taj Mahal*, *Colosseum*, *Christ the Redeemer*, *Great Wall* or
  *Pyramids of Giza* joins the world list's base towns for it
  (`siteBase()` in `lib/discovery/world-destinations.ts`) and costs the
  geocoder nothing. The menu for such a plan is read around the base town
  nearest the site (`siteTown()`): Aguas Calientes, Wadi Musa, Pisté, Agra,
  Rome, Rio, Huairou, Giza.

The region list (`regionList()` in `lib/discovery/regions.ts`) is every US
state and territory, England, Scotland, Wales, Mexico, the Bahamas, every
file in `world-regions.generated.ts`, and the region of every seed — 105
regions today. A region is only ever read if it is in
`lib/discovery/geofabrik-regions.generated.ts`, every file Geofabrik offers
that the lookup could pick (457: never a continent, an overlay such as US
Northeast, a country Geofabrik splits into pieces, or North Korea).

```
node scripts/ingest/build-seeds.mjs --cap 0 --names   # what it would store, asking Nominatim nothing
node scripts/ingest/world-regions.mjs                 # re-derive both generated files from Geofabrik's index
```

Re-run `world-regions.mjs` after changing the world list (the unit tests
fail until you do) or when a seed lands in a file Geofabrik added since.

## When a place has gone

A venue is marked `gone_at` when it was last seen before the start of the
previous good run from an earlier download — the latest good run that started
at least six days before this one. That is, neither this download nor the
previous one saw it. A second run in the same week ("Re-run all jobs", or a
daily run retrying an overdue region) reads the same or a newer extract of
the same week, so it is not a second miss and measures from last week.

Only the region's own rows are ever retired (`region` = the file being
read), and the whole file was read, so each of them was looked for. That is
what the thirty-mile circles used to have to guarantee: when only the
circles were read, a place outside every circle had not been looked for.
Rows the sweep wrote and the load never has (`region` is null) are never
retired by it. Rows are never deleted: events and bookings point at them. A
place that comes back has `gone_at` cleared by the next upsert.

Nothing is retired by a run that lost a write, or by one that kept under half
of what the last good run kept — a truncated download looks exactly like most
of a state closing. Such a run is recorded as `failed` and does not count as
"the last good run" next time. A region that honestly holds nothing (a run
that keeps nothing after a run that also kept nothing) is good; nothing kept
after a run that kept something is a broken download, *accept_drop* or not.

## How the menu and Discover use it

`placesFor()` (`lib/discovery/real-places.ts`) reads nearest first without
PostGIS: boxes of 2, 5, 12 and 25 miles, at most 500 rows each, stopping once
the menu can be filled, and leaving out of each wider box the kinds it
already has enough of. Rows with `gone_at` set and anything filed as `places
to stay` or mapped as lodging are never on it; a hotel is not dinner, and
Reach books rooms through its own providers, not these rows.

**Across a border is not nearby.** Mexico is read whole now, so Tijuana's
restaurants are in the table beside San Diego's and Ciudad Juárez's a mile
from downtown El Paso. The menu drops a row whose region's countries do not
include the trip's (`acrossTheBorder()`), and only when both are known: a
sweep row (no region) is kept, and Hong Kong's rows answer to "cn" because
that is what Nominatim calls Hong Kong. The booking screen's venue lookup
(`heldVenueNear()`) applies the same rule, so an El Paso dinner is never
offered the Juárez branch's +52 number. Discover does not have the trip's
country and does not filter yet (see "Still open").

The file a row was read from does not say which country it is in, because
Geofabrik cuts every polygon wide of the border, and not evenly. Mexico's
reaches north over San Luis, Arizona; Poland's Lubuskie covers the whole of
central Frankfurt (Oder) and is the smaller file there; Saxony covers
Zgorzelec; Languedoc-Roussillon covers Llívia. No rule over the polygons
alone can settle a point in that overlap: "the file loaded last" put San
Luis, AZ in Mexico on some days, and "the smallest file that holds it" put
Frankfurt's town hall in Poland on all of them, which dropped the city's own
venues from a Frankfurt trip.

So every row carries `countries` (`countriesAt()` in
`lib/discovery/geofabrik.ts`), and the border check reads it before the
region:

- a point no other country's file holds is this file's countries' — every
  row but a strip a few miles wide along each border;
- in the overlap, the feature's `addr:country` settles it, when it is one of
  the candidates; failing that, its number written in full (`+49…`,
  `0048…`), when the code belongs to one candidate file only (`+1` is the US
  and Canada both, so it settles San Luis against Mexico but not Detroit
  against Windsor);
- failing both, every candidate: `{DE,PL}`. The row is kept for a trip to
  either, because nothing on the map says which, and a venue a mile away
  across the Oder is a smaller wrong than a city's own town hall missing.

A file counts as a candidate only where its own country's polygons hold the
point: an extract carries a few features past its edge, and a Tijuana
taqueria read from California's file is Mexico's, as Mexico's file says.
The answer is the same whichever file reads the feature, so load order no
longer matters, and every file that holds a point writes it: none waits on
another country's load having run. Seeds follow the same rule the other way
round: the geocoder's country picks among the files that hold a town
(`regionAt(lat, lng, country)`), so Frankfurt (Oder) is seeded in
Brandenburg, not Lubuskie. The load reads Geofabrik's index for this (one
request; `--index <file>` for a copy on disk) and goes red if it cannot.

The index's own country codes are not trusted blind either. On 2026-09-24 it
gave French Polynesia, Wallis and Futuna, Clipperton, Tokelau and American
Oceania Vanuatu's code, and Pitcairn the Marshall Islands', which would have
dropped every Tahiti venue from a Papeete trip. `COUNTRY_OF` and
`GEOCODER_ALSO` in `lib/discovery/geofabrik.ts` settle them (checked against
Nominatim: Papeete and Cayenne answer "fr", Guam and Pago Pago "us"), and
`world-regions.mjs` refuses to write while any code sits on two unrelated
files.

Each place carries `street` and `hours` (the map's `opening_hours`). The menu
prints them as `hours per OpenStreetMap: …` and tells the model they are
volunteers' notes, never to be stated as certain. A place is dropped only when
the plan has dates **and** the hours parse **and** they say closed for the
whole evening (food, drink and shows on a night out) or the whole day
(anything else) on every day of the plan.

Discover (`cachedVenues()`, `lib/discovery/cache.ts`) reads each interest on
its own, sixty rows at a time, in a 3-mile then a 15-mile box.

## How big it gets

Measured on 2026-09-24 by running the load's own rules over eight real
extracts:

| region | download | places | rows | rows/MB |
|---|---:|---:|---:|---:|
| District of Columbia | 21 MB | 1,893 | 2,259 | 108 |
| Île-de-France | 338 MB | 12,610 | 14,841 | 44 |
| England | 1,696 MB | 50,323 | 56,137 | 33 |
| California | 1,329 MB | 25,100 | 29,550 | 22 |
| Kanto | 511 MB | 8,012 | 9,540 | 19 |
| North Carolina | 428 MB | 6,056 | 7,046 | 16 |
| Mexico | 645 MB | 5,280 | 6,184 | 10 |
| Puerto Rico | 74 MB | 419 | 476 | 6 |

(North Carolina's thirty-mile circles kept 1,789 places; the whole state is
6,056. Puerto Rico's circles already covered most of the island: 383 of 419.)

The 105 base regions are 27.7 GB of downloads; at those densities (US 20
rows/MB, Europe 38, Asia 19, elsewhere 10) that is about **670,000 rows**
against 3,339 today. At about 1 kB a row with its indexes, **0.7 GB live, up
to 1.4 GB** with the dead versions the weekly rewrite leaves for autovacuum
to reuse — of the 8 GB on Supabase Pro. A region a plan adds costs its
download size × 10–40 rows. Even the whole planet would be of the order of 2
million rows, 2–4 GB. Check it any time with
`select pg_size_pretty(pg_total_relation_size('public.discovery_venues'));`.

**What stays bounded at 200 times the rows.** Every reader is capped and
now has an index made for it:

- the menu: at most 500 rows a box, four boxes, plus 500 per food asked
  for, on `discovery_venues_live_lat_lng`;
- Discover: 60 rows per interest per box, on the new
  `discovery_venues_live_interest_at (interest, lat, lng)`;
- the harvester: 20 venues a night, from two reads of 60 rows each, on the
  new `discovery_venues_harvest_new` and `discovery_venues_harvest_due`;
- the platforms job: 20 restaurants a run; the booking lookup: 20 rows by
  name in a box; the sweep's "what does this area hold": PostgREST's
  1,000-row cap.

## What it does to the harvester

The load adds places the harvester (`/api/discovery/harvest`, twenty venues a
night) has never read — about a quarter of all rows are kinds worth reading,
so roughly 150,000 once the base list is in. The nightly work does not grow
with them: the read is capped and indexed, and each night is shared — up to
half re-reads, the rest never-read, and a share one side cannot use goes to
the other (`lib/discovery/harvest-queue.ts`) — so the listings on screens
today never go stale behind the new venues. Venues marked `gone_at` are not
read. At twenty a night the never-read queue will not empty; which of them
it reads first is in "Still open".

## Still open

- **Which never-read venues the harvester reads first.** The queue is oldest
  id first, which with the whole world loaded is effectively random: a venue
  in a town somebody has planned is no likelier to be read than one in a
  town nobody has. Reading venues near seeds first needs a distance order
  the database cannot give without PostGIS or a stored "near a seed" flag.
- **Discover and borders.** Discover's seeker has a point but no country,
  so it does not drop rows across a border the way the menu does.
- **Which regions exist.** Geofabrik occasionally adds or re-cuts extracts;
  `geofabrik-regions.generated.ts` is regenerated by hand (above).

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
is not to hammer the server: the job downloads each region at most once per
run, verifies it against Geofabrik's checksum, and never more than two at
once. The index (`index-v1.json`, 3.8 MB) is fetched once a day by the seed
job.

**Nominatim** (seed building only): at most one request a second, with an
identifying User-Agent, at most 100 a day, each town asked about once ever,
and nothing at all after a 429. That is the usage policy's "no heavy use"
and "cache results" both.

**`opening_hours` npm package — LGPL-3.0-only.** Used unmodified as an npm
dependency, on the server only (`lib/discovery/hours.ts`, reached from API
routes, never from the client bundle). Nothing is distributed to users, so the
LGPL's distribution terms are not triggered. If it is ever bundled into client
code, the app must ship its licence text and allow the library to be replaced
(which a separate npm dependency already does). Its own dependencies are
`suncalc` (BSD-2-Clause) and `i18next` (MIT).

## Climate normals (the `climate` job)

The same workflow runs a second, independent job, **Climate normals**, which
fills `place_climate` (`sql/climate-2026-09-24.sql`, run it first) with NASA
POWER's monthly climatology for every seed and world destination:
`node scripts/ingest/climate.mjs --cap 150`. It asks only for places with no
row or a row over a year old, one request at a time with a pause, retrying a
429/5xx with backoff, and never writes a failed answer. A failure turns the
job red; the map load does not wait on it.

- `--dry-run` counts what would be fetched (no requests to POWER, no writes).
- `--sample "Moab,Cusco"` fetches and prints, never writes.

Source and terms: NASA POWER (https://power.larc.nasa.gov). NASA data is not
copyrighted and carries no restriction on commercial use; POWER asks to be
credited ("Data from NASA Langley Research Center's POWER project, funded
through the NASA Earth Science Division") and nothing may imply NASA
endorses Reach. Every screen line carries "NASA POWER 1981–2020 averages for
the area, not a forecast". See `lib/climate.ts` for what the numbers are and
are not — in particular they are grid-cell averages at the cell's height,
not the town's.
