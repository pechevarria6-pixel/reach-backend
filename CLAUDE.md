# Working on Reach

Notes for whoever picks this up next. Written 2026-09-21, after a long day of
finding out how this codebase actually fails.

---

## The one rule everything else follows from

**Reach may only state what it has verified.** Not "is probably right", not
"the model is usually good at this" — verified, from a row we hold or a page
we read, with somewhere to point.

This is not a style preference. It is the product: a group plans a trip
around what this app says, and a plausible sentence that turns out to be
wrong strands somebody outside a laundrette at eight in the evening. Every
serious bug found on 2026-09-21 was a version of breaking this rule, and
nearly all of them read beautifully right up until somebody checked.

Concretely:
- The generator is handed a menu of verified venues and may name **only**
  those. A town we hold nothing for gets an itinerary that names no venues,
  and that is the correct answer, not a degraded one.
- Output is read back against the same menu. A name nothing vouches for is
  softened — the claim goes, the shape of the evening stays.
- Prices are labelled as estimates, because nobody has rung a hotel.
- "Reach will book this" appears only where Reach can actually book it.
- A field that cannot be answered honestly is nullable. See `payment` in
  `lib/trip-schema.ts` for the pattern and the reasoning.

## How to find bugs here

**Open the screen.** Every serious defect on 2026-09-21 was found by
looking at a screen or reading a database row. None was found by a passing
test, a green build, or a 200 response. Several survived all three:

- The API returned the ticket URL correctly, the row stored it correctly,
  and the client's field list dropped it — so the button was not there.
- `/api/geo` answered 200 with `{"hits":[]}` to every search for two hours.
- A seven-night trip came back as one day and $34 and saved without complaint.
- The harvester reported `{"read":20,"events":23}` while one venue failed to
  store on every run and the two richest pages lost everything to truncation.

**Read the log, not the summary.** Both harvester bugs were plainly in the
log and invisible in the response.

**Measure against the source.** When a lookup feels thin, count what the map
actually holds. `outdoors` was finding 8 things in a city with 2,028 and
nothing said so. See the audit in commit 1715375.

## Things that have bitten more than once

**A fact the app already holds, not passed on.** This is the dominant bug
shape here, seven times in one day: the plan type that said it was a
concert, the city that said where, the listing that said which venue, the
URL that said where to buy, the act's name sitting in the title, the venue's
website, what's on there. Each was known and each stopped one layer short.
When something is missing from a screen, check whether it is *absent* or
merely *undelivered*.

**Client field lists.** `convertPlan` and the post-build refresh in
`components/reach-app.jsx` each carry a hand-written list of fields. Adding a
column and forgetting these means it works once after generating and
vanishes on reload. The comments there say this has happened three times.

**`Number(searchParams.get('x'))` is 0, and 0 is finite.** A missing
coordinate became Null Island twice. `lib/discovery/where.ts` exists to stop
it; use `whereFrom`.

**Postgres refuses an upsert naming one row twice.** Dedupe before writing.
The sweep does; the harvester did not, and one venue failed silently for
weeks.

**Read-then-write is not idempotent.** Two simultaneous requests both read
"nothing there" and both write. Stripe intents, bookings and contributions
all needed a unique index, not a check. A double-tap is two concurrent
requests, not two sequential ones.

## Verifying a deploy

Status codes and local chunk hashes both lie. Read the chunk that the
signed-in `/home` actually references and look for a string you just added.
A server-only change does not move the client chunk, so check behaviour
instead. See `reach-confirming-a-deploy` in the memory directory.

**`vercel.json` cron schedules:** this account is on Hobby, which runs a cron
**once a day**. A sub-daily schedule is not a slower cron — the deployment is
silently rejected and nothing appears in the deployments list at all. That
cost two commits before anyone noticed.

## Running things

- `npm run verify` gates everything. **Do not pipe it into grep and chain a
  commit** — grep's exit code hides the failure, and that shipped over a red
  build twice in one day. Use `npm run verify && git commit`.
- Migrations are written here and run by the owner. PostgREST does rows, not
  schema; there is no SQL-exec function on this project.
- Driving the API from Node beats a browser tab for anything long — a
  backgrounded tab is throttled and stalls silently. Re-read the session
  cookie before every call; Clerk rotates `__session`. See
  `reach-driving-the-api-from-the-terminal`.

## Guards

`npm run verify` runs a dozen checks, each written after a real failure.
Before trusting a new one, **plant the bug back and watch it fire** — a
guard that has never failed has not been tested. `check:promises`,
`check:writes`, `check:responses`, `check:client-fetch`, `check:idempotency`
and `check:spelling` have all caught something real.

## Where the knowledge comes from

```
OpenStreetMap ──sweep──▶ discovery_venues ──▶ the menu the generator may name from
      │                         │
      │                    harvest reads each venue's own page
      │                         ▼
      └──────────────▶ discovery_events ──▶ "what's on", shown on the row
Ticketmaster ─────────▶ discovery_events ──▶ real gigs, with a ticket link
```

The sweep is scheduled, never in a request: Overpass took 72 seconds to
answer "nothing" for Washington. If a destination holds no venues, the
honest itinerary names none — fix it by sweeping, not by loosening the rule.

## Still open

- `sql/finish-idempotency-2026-09-21.sql` — two unique indexes, blocked on
  the owner deciding between two real Duffel orders (`MHW2Y3`, `SFYVFK`).
- Harvest coverage is thin: ~8 pages in 20 give anything up, and sites that
  build themselves with scripts are recorded `needs_render` rather than
  guessed at.
- Four cron entries on a plan that documents two.
- `TEST_EMAIL` points at the owner's real account, so e2e acts on real data.

`QA-LEDGER.md` has the full record of what was walked and what was found.
`NAV-GRAPH.md` has the screens.
