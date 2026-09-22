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

## Common-sense check (mandatory on all work)

Every screen, itinerary, recommendation and piece of copy has to pass one
question before it ships: **does this make sense for this specific person,
this trip, and this context?** The rule above is the principle; this is the
check that applies it, and it applies to generated content — itineraries,
recommendations, notifications — exactly as much as to code.

- **Never reference things that don't exist.** No "check into the hotel" when
  no hotel was booked. An itinerary step may only reference a booking that is
  actually in that trip's data.
- **Never claim a capability that isn't real.** No "we're on it", no "booked",
  without a working booking link or a completed reservation behind it. When
  Reach can't book something, say so and hand the person somewhere that can.
- **Never assume or invent a fact about a venue.** Reservation options, hours
  and links come from the venue's own data. Walk-in only means walk-in only.
  A missing website link is a bug, not a shrug.
- **Match the language to the context.** Solo trip gets singular copy
  ("You're all set"), never group copy ("Everyone's in"). A night out is a
  single-event plan, never a full-day itinerary unless the person chose "Make
  a day of it".
- **No redundancy.** Never show the same information or the same action twice
  on one screen — Pay and Book It as separate tabs, Jump Back In alongside the
  trips tab.
- **Solve problems before they are problems.** Always leave the person a next
  option. Tickets come from more than one source — Ticketmaster, StubHub,
  SeatGeek, the venue's own box office — so one sold-out vendor never ends a
  plan. The same goes for hotels, restaurants and activities: a single point
  of failure in a plan is a bug. When one path fails the next should already
  be on the screen, not something they have to go and find.

Ask it out loud: *would a real person reading this be confused or misled?* If
yes, fix the logic underneath, not the sentence on top. Rewording a screen
that is wrong about the world just makes the wrongness harder to find.

Each of these is here because it has already happened:

| rule | what it cost |
|---|---|
| nothing that doesn't exist | a seven-night trip came back as one day and $34, and saved without complaint |
| no invented capability | "Reach will book this" over a restaurant Reach cannot book — removed once, reintroduced the same day by a fix to something else |
| no invented venue facts | every food query required a cuisine tag, so Washington returned nothing and the app phrased our gap as a fact about the city |
| copy matches context | a solo plan put everything in the approval queue and told the one person on it that it was waiting on the others |
| no redundancy | the owner's own list — Pay + Book It, Jump Back In + trips |
| a next option ready | Ticketmaster sold out for J. Cole in Fayetteville and the plan stopped there, with StubHub and SeatGeek still selling |

Some of this is enforced and some of it is not, and it is worth knowing which:
`check:promises` and `check:vocabulary` catch the false-capability strings,
`check:solo-copy` catches a sentence that speaks for other people on a screen
somebody can reach alone, `tests/unit/grounding.test.ts` holds the venue rule,
and the two contracts in `lib/contracts/` stop a fact being dropped between the
row and the screen. **Nothing enforces the redundancy rule**, and the attempt
is written up below so nobody spends the afternoon on it twice.

### Why redundancy has no guard

It was built and thrown away. A script can find every pair of actions in one
component that navigate to the same place with the same arguments, and with
three refinements — skip `.map()` bodies (a list is not a duplicate), skip
opposite arms of a ternary, skip conditions pinning the same variable to
different strings (`atab==="overview"` against `atab==="itinerary"`) — it gets
from 14 pairs to 8.

It stops there, and the last step is the one that matters: **nothing in the
syntax distinguishes a convenient second entry point from a confusing
duplicate.** The persistent ✎ in the plan screen's header goes where "Edit plan
details" goes, and that is a normal pattern, not a defect. Shipping the check
would have meant eight allowlist entries nobody could justify, which is worse
than no check — see `check:solo-copy`, where every entry carries the reason it
is allowed.

What the scan is good for is a list to read. These pairs share a destination
and can appear together; each is a judgement call, not a bug:

    GroupsScreen         createGroup                    ×2
    GroupDetailScreen    editGroup / createPlan         ×3, ×2
    GroupTripScreen      planDetail                     ×2
    PlanDetailScreen     editItinerary / checkout       ×4, ×3
    ReachApp             setTab groups / setTab home    ×2, ×2

It did earn its keep. Two real faults came out of it, both on the home screen:
a "3 trips on the go · See all →" card that went to the Groups tab the nav bar
already reaches, next to an "Upcoming trips · See all →" header doing the same
thing in the same words; and a "＋ New plan" tile that resumed a half-finished
draft, because `CreatePlanFlow` restored the draft on mount whatever brought
you there. Two affordances that read as different things, and the one labelled
"New" was the one telling the lie.

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

- `sql/finish-idempotency-2026-09-21.sql` — the duplicate rows are gone, so
  the indexes can build. But the reason they were deleted (f89a3eb, "Duffel
  says the orders do not exist") was a bad check: cancel sent the airline
  booking reference as Duffel's order id (fixed in 53fc140). SFYVFK was on
  Duffel's test carrier; **MHW2Y3 still needs checking in the Duffel
  dashboard.**
- Harvest coverage is thin: ~8 pages in 20 give anything up, and sites that
  build themselves with scripts are recorded `needs_render` rather than
  guessed at.
- Four cron entries on a plan that documents two.
- `TEST_EMAIL` points at the owner's real account, so e2e acts on real data.

`QA-LEDGER.md` has the full record of what was walked and what was found.
`NAV-GRAPH.md` has the screens.
