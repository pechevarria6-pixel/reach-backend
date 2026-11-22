# REACH — Destination Diversity + User Expectations (2026-11-22)

Directive for Claude Code. Save in the repo root beside the other `REACH-*.md` files.

**Read this first.** This was written without access to the repo. Every file path, table name, column name and test-runner call below is a best guess from earlier directives. Task 0 is to check them against the real code and the live schema and adjust before writing anything. Where the repo already does something listed here, mark it done in `STATUS.md` and move on.

## Why

A study by Najafi and Costa (University of Aveiro), reported in the Wall Street Journal, put 14 travel questions three times each to 10 AI systems. Findings that apply to Reach:

1. A handful of destinations dominate. For sustainable destinations in Europe, 10 places took nearly 53% of mentions.
2. "Alternatives" are neighbours. Alternatives to Santorini were mostly nearby Greek islands: a different place, the same crowded area.
3. Generic wording ("hidden gems", "avoid crowds") produces the same shortlist every time.
4. Claims such as "eco-friendly" or "less crowded" arrive without evidence, and the systems guess instead of admitting gaps.
5. A place recommended to everyone as quiet or sustainable stops being either.

Reach's venue-level grounding already solves this one level down. This directive applies the same rule to the destination itself: **code chooses the place, the model writes the pitch.**

## Rules for this work

- Branch `feat/destination-diversity`. Do not push to `main`; a push to `main` deploys to production. Open a PR.
- `npm run verify` must be green before every commit. No piping verify through grep.
- No migrations run by the agent. Peter pastes SQL into Supabase after checking names.
- Stripe stays untouched by this work.
- Vocabulary guard still applies. Do not use "costed"; use "priced".

---

## Part A — Destination selection

### Task 0 — Ground truth

Report in `STATUS.md`:

- Where destinations are chosen today (expected: `app/api/trips/generate`, stage 1). Is the destination picked by the model from free recall, or from `destination_profiles`?
- Actual columns on `destination_profiles`, `groups.taste_profile`, `plan_preferences`, and the events table.
- Which unit-test runner the 270 unit tests use.
- Whether onboarding already stores crowd tolerance or accessibility needs.

### Task 1 — Migration (owner runs it)

`sql/destination-diversity-2026-11-22.sql`. Verify every name first.

```sql
-- Candidate metadata the selector needs
alter table destination_profiles
  add column if not exists region text,
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists popularity_score numeric,      -- 0 (obscure) .. 1 (headline)
  add column if not exists popularity_source text,        -- where the figure came from
  add column if not exists crowd_by_month jsonb,          -- {"1":0.2,...,"12":0.9}, null if unknown
  add column if not exists evidence jsonb default '{}'::jsonb;

-- How often each destination has been offered, across all groups
create table if not exists destination_exposure (
  destination_id uuid not null references destination_profiles(id) on delete cascade,
  served_on date not null default current_date,
  served_count integer not null default 0,
  primary key (destination_id, served_on)
);

-- One-tap onboarding answer
alter table users
  add column if not exists crowd_tolerance text
  check (crowd_tolerance in ('avoid','fine','love'));
```

`popularity_score` must come from a real figure (visitor counts, NPS visitation data for parks, arrivals data). If no figure exists for a destination, leave it null. Null is treated as unknown, never as "quiet".

### Task 2 — Selector (new file, pure functions)

`lib/destination-select.ts`. No I/O, no model calls, fully unit-testable.

```ts
export type Tier = 'saver' | 'fair' | 'stretch';

export interface Candidate {
  id: string;
  name: string;
  region: string | null;
  lat: number | null;
  lng: number | null;
  popularity: number | null;        // 0..1, null = unknown
  crowdThisMonth: number | null;    // 0..1, null = unknown
  servedLast30d: number;            // from destination_exposure
  pricedPerPersonCents: number;     // estimate for this group and these dates
  travelMinutes: number;            // from the group's home airports / city
  tags: string[];
  verifiedVenueCount: number;
}

export interface GroupContext {
  budgetPerPersonCents: number;
  tagWeights: Record<string, number>;   // from taste_profile + trip inputs + blurb
  crowdTolerance: 'avoid' | 'fine' | 'love';  // strictest member wins
  excludedIds: Set<string>;             // dismissed, vetoed, already visited
  maxTravelMinutes: number | null;
}

export interface Pick { tier: Tier; candidate: Candidate; score: number; reasons: string[]; }

const HEADLINE = 0.8;          // popularity at or above this is a headline destination
const MIN_SPREAD_KM = 150;     // no two options closer than this
const MIN_VENUES = 5;          // below this we cannot write an honest itinerary

export function haversineKm(a: {lat:number;lng:number}, b: {lat:number;lng:number}): number {
  const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function tierFor(c: Candidate, g: GroupContext): Tier | null {
  const r = c.pricedPerPersonCents / g.budgetPerPersonCents;
  if (r <= 0.8) return 'saver';
  if (r <= 1.0) return 'fair';
  if (r <= 1.2) return 'stretch';
  return null;                                  // over the guardrail: never offered
}

export function score(c: Candidate, g: GroupContext): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let s = 0;

  // 1. Fit to what the group actually said. This is the only positive term.
  for (const t of c.tags) {
    const w = g.tagWeights[t];
    if (w) { s += w; reasons.push(`tag:${t}`); }
  }

  // 2. Popularity penalty. Unknown popularity gets no bonus and no penalty.
  if (c.popularity != null) s -= 0.6 * c.popularity;

  // 3. Crowd tolerance, only when we hold a real figure for this month.
  if (c.crowdThisMonth != null) {
    if (g.crowdTolerance === 'avoid') s -= 1.0 * c.crowdThisMonth;
    if (g.crowdTolerance === 'love')  s += 0.3 * c.crowdThisMonth;
    if (g.crowdTolerance === 'avoid' && c.crowdThisMonth <= 0.3) reasons.push('evidence:quiet-this-month');
  }

  // 4. Exposure dampening: the more groups we have sent here lately, the less we push it.
  s -= 0.25 * Math.log1p(c.servedLast30d);

  // 5. Shorter trips to get there win ties.
  s -= c.travelMinutes / 1200;

  return { score: s, reasons };
}

function compatible(c: Candidate, chosen: Candidate[]): boolean {
  for (const o of chosen) {
    if (c.region && o.region && c.region === o.region) return false;
    if (c.lat != null && c.lng != null && o.lat != null && o.lng != null &&
        haversineKm({lat: c.lat, lng: c.lng}, {lat: o.lat, lng: o.lng}) < MIN_SPREAD_KM) return false;
    if ((c.popularity ?? 0) >= HEADLINE && (o.popularity ?? 0) >= HEADLINE) return false;
  }
  return true;
}

/** Returns up to three picks, one per tier where possible. Fewer is a valid, honest answer. */
export function pickThree(all: Candidate[], g: GroupContext): Pick[] {
  const ranked = all
    .filter(c => !g.excludedIds.has(c.id))
    .filter(c => c.verifiedVenueCount >= MIN_VENUES)
    .filter(c => g.maxTravelMinutes == null || c.travelMinutes <= g.maxTravelMinutes)
    .map(c => ({ c, tier: tierFor(c, g), ...score(c, g) }))
    .filter(x => x.tier !== null && x.reasons.some(r => r.startsWith('tag:')))
    .sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id));   // stable

  const picks: Pick[] = [];
  for (const tier of ['saver', 'fair', 'stretch'] as Tier[]) {
    const hit = ranked.find(x => x.tier === tier &&
      !picks.some(p => p.candidate.id === x.c.id) &&
      compatible(x.c, picks.map(p => p.candidate)));
    if (hit) picks.push({ tier, candidate: hit.c, score: hit.score, reasons: hit.reasons });
  }
  // Fill empty tiers with the best remaining compatible candidate of any tier.
  for (const x of ranked) {
    if (picks.length >= 3) break;
    if (picks.some(p => p.candidate.id === x.c.id)) continue;
    if (!compatible(x.c, picks.map(p => p.candidate))) continue;
    picks.push({ tier: x.tier as Tier, candidate: x.c, score: x.score, reasons: x.reasons });
  }
  return picks;
}

/** Share of all servings taken by the k most-served destinations. The study's headline metric. */
export function topKShare(servedIds: string[], k = 5): number {
  if (servedIds.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const id of servedIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const top = [...counts.values()].sort((a, b) => b - a).slice(0, k).reduce((a, b) => a + b, 0);
  return top / servedIds.length;
}
```

Notes on behaviour:

- A candidate with no matching tag is never offered. A pick must trace to something a member said.
- The selector is deterministic. Day-to-day variety comes from exposure dampening and exclusions, not from randomness, so results are reproducible in tests.
- Weights (0.6, 0.25, 150 km, 0.8) are starting values. Put them in one config object and tune against Task 6.

### Task 3 — Wire it into generation

In the generate route:

1. Build `GroupContext` from saved member preferences, `groups.taste_profile`, each member's trip input, and tags extracted from the blurb. **A bare blurb never reaches destination choice on its own.** "skiing" becomes skiing + budget + dates + home airports + exclusions.
2. Load candidates from `destination_profiles` (plus exposure counts) and call `pickThree`.
3. Pass the chosen destinations to the model as fixed input. The prompt asks for a pitch and itinerary for each named place. The model may not add, swap or rename a destination; the existing read-back validator rejects output naming any other.
4. If `pickThree` returns fewer than three, show fewer. Copy: "We found two that really fit. Want us to widen the search?" Widening relaxes travel time first, then spread distance; it never relaxes the tag-match rule.
5. If the user named a specific place at creation, skip selection for that slot. Diversity applies only to open-ended requests.
6. After options are shown, upsert `destination_exposure` for each one. Check the write error.

### Task 4 — Evidence-backed claims

`lib/claims.ts`:

```ts
// Each claim word may appear in a pitch only if the named evidence key is present.
export const CLAIM_EVIDENCE: Record<string, string> = {
  'less crowded': 'evidence:quiet-this-month',
  'uncrowded': 'evidence:quiet-this-month',
  'off the beaten path': 'evidence:low-popularity',
  'eco-friendly': 'evidence:sustainability-source',
  'sustainable': 'evidence:sustainability-source',
};
export const BANNED_ALWAYS = ['hidden gem', 'best-kept secret', 'undiscovered'];

export function unsupportedClaims(text: string, reasons: string[]): string[] {
  const t = text.toLowerCase();
  const bad = BANNED_ALWAYS.filter(w => t.includes(w));
  for (const [phrase, key] of Object.entries(CLAIM_EVIDENCE))
    if (t.includes(phrase) && !reasons.includes(key)) bad.push(phrase);
  return bad;
}
```

- Run `unsupportedClaims` in the read-back step. On a hit, regenerate that pitch once with the phrase forbidden; on a second hit, strip the sentence.
- Add `BANNED_ALWAYS` to `check:vocabulary`.
- Each option card gets one "Why this" line built from `reasons` in code, not written by the model: "Three of you picked surf · 2 h drive · quiet in March". No reasons, no line.

### Task 5 — Crowd tolerance (one tap)

One onboarding question, skippable, editable in Profile: "Busy places?" → Love the buzz / Don't mind / Rather avoid. Group value is the strictest member's answer. Check whether accessibility needs are already captured; if not, report it in `STATUS.md` and do not add it without Peter's go-ahead (quiz length is capped).

### Task 6 — Tripwire tests

Unit tests for `lib/destination-select.ts` (adapt to the repo's runner):

- three picks never share a region and are never within 150 km of each other
- at most one headline destination per set
- an excluded or untagged candidate is never returned
- thin data returns fewer than three picks, never padding
- **the study's method:** 8 fixture groups with different tastes and budgets, each run 3 times against the fixture catalog. Same group → identical picks all 3 runs. Across groups → `topKShare(all, 5) <= 0.40`. Build fails above it.

Production metric: a view over the events table reporting weekly `topKShare` for served and for booked destinations. Add both to the pilot metrics list.

---

## Part B — User expectations checklist

Each item names the expectation, what Reach should do, and how to tell it is done. Audit first; several of these are already built.

| Expectation | Task | Done when |
|---|---|---|
| Useful | Every screen answers "what do I do next?" with one action (shared next-action logic) | No screen in the flow inventory has zero or two primary actions |
| Easy to use | Trip creation stays one screen; no step asks for something already saved | E2E: create trip in under 60 s with a saved profile |
| Time-saving | Log time from "generate" to first option visible; show options as each completes instead of all at once | p50 and p95 recorded in events; first option visible before the full set finishes |
| Productivity | One share link gets a member from tap to "input submitted" | E2E covers invite → onboarding → trip input in one run |
| Clear interface | Status chips only, human error messages with a next step | Vocabulary guard green; every 4xx the client can receive has mapped copy |
| Engaging | "Why this" line on each option (Task 4); celebration on booking | Rendered-content test asserts the line appears with real reasons |
| Consistent branding | All colors and fonts come from the token file (dark and light sets, Fraunces + Inter) | Lint rule or grep check: no raw hex outside the token file |
| User support | Help entry in Profile: short FAQ + "Message us" form that emails the founder | Form submit returns success only after the email provider accepts it; failure shows a real error |
| Data privacy | Plain-language "Who sees what" page: members see ready/needs-details, never each other's details; link to Privacy Policy | Page exists and matches actual API field exposure (test asserts other members' fields are absent) |
| Analytics for users | "Your Reach" card: trips taken, places pinned, days since each group last got together | Numbers derived from bookings/events rows, never estimated |

Not in scope here: account deletion execution and anything touching custody. Both stay with the lawyer track.

---

## Part C — Travel-app feature expectations

A second list of what travellers expect from travel apps. Most of it maps to things Reach has built or planned; the job is to audit each, close the gap, and say plainly what Reach will not do. Audit first and record the state of each row in `STATUS.md`.

### Booking and planning

| Expectation | Task | Done when |
|---|---|---|
| Transparent pricing, no hidden fees | Every price shown is all-in per person: taxes and provider fees included, with a tap-to-expand breakdown. State once on the checkout review: "Reach adds no fee or markup." | Displayed total equals the sum of booking rows to the cent; test asserts no price renders without taxes/fees included |
| Price comparison | The three options show priced-per-person side by side with the same line items (travel, stay, activities) so they compare directly | Option cards share one line-item structure; missing line shows "not priced yet", never $0 |
| Unified itinerary | One timeline per trip: Reach bookings, redirect bookings marked "Booked it ✓", and bookings made elsewhere, in time order, each with its confirmation reference and a link out | A trip with one booking of each kind renders all three in order |
| Budget tracking | Trip screen shows spent and committed against the group budget, and each member's share, from booking and ledger rows | Numbers derived from rows; over-budget state has copy and a next step |
| Price alerts | Before approval, re-quote on open: tell the group when a price dropped as well as when it rose (rises already return 409). No "deal" language unless a provider supplied a real promotion | Price-drop notice appears in a test with a lowered fixture quote |

### On-the-go reliability

| Expectation | Task | Done when |
|---|---|---|
| Real-time alerts | Web push for the installed PWA: flight delay, gate change, cancellation from the existing `/live` data, plus "booking confirmed" and "price changed". Ask permission at first booking, not at sign-up | A simulated delay produces one push to each traveller on that flight, and none to others |
| Offline access | Service worker caches the active trip's itinerary, confirmation references, addresses and ticket links for reading offline. Show "Saved for offline · updated 2 h ago". No offline writes | With network off, the active trip's itinerary opens and shows its last-updated time |
| Navigation and transit | Each itinerary stop gets "Directions", a deep link that opens the phone's maps app with the address filled in (driving, walking or transit chosen there). No in-app turn-by-turn | Every stop with an address has a working link; stops without one show no button |

### Discovery and trust

| Expectation | Task | Done when |
|---|---|---|
| Local recommendations beyond tourist traps | Covered by Part A (popularity weight, exposure dampening, verified venues only) | Part A tripwire green |
| Authentic reviews | After each trip, one-tap rating per stop from the people who went. Show "4 of 5 Reach groups would go again" once a venue has at least 3 group ratings. Third-party ratings appear only where the provider's terms allow, labelled with source and date | No rating renders without a source and a count; nothing is shown below the minimum |

Never generate, paraphrase or invent a review, rating or quote. An absent rating is shown as absent.

### Practical extras

| Expectation | Task | Done when |
|---|---|---|
| Passes and tickets in one place | "Tickets" section on the trip: links and confirmation references for every booking, available offline. Reach stores references and links only | Section lists every confirmed booking's reference |
| Fast help when plans go wrong | The Help entry from Part B is reachable from every booking row and prefills the trip and booking reference | Tapping "Get help" on a booking opens the form with that reference attached |
| Language, currency, visa guidance | **Out of scope for the US launch.** Record as a follow-on for the Europe stage, alongside the existing Europe partner list | Listed in `STATUS.md` as deferred, not built |

Lines that do not move for any of the above: no stored passports, card numbers or third-party passwords; no scraping of review or booking sites; no custody changes.

---

## The push

Branch: `feat/destination-diversity`

Commit sequence (one per task, each with verify green):

1. `docs: destination diversity directive + STATUS ground truth`
2. `feat(select): deterministic destination selector with spread, popularity and exposure rules`
3. `feat(generate): choose destinations in code, model writes pitch only`
4. `feat(claims): evidence-backed claim guard and code-built "why this" line`
5. `feat(onboarding): crowd tolerance question`
6. `test(select): concentration tripwire and spread tests`
7. `feat(ux): help entry, who-sees-what page, Your Reach card, timing events`
8. Part C lands as separate PRs, one per group (pricing/itinerary/budget, alerts/offline/directions, ratings/tickets), so each can be reviewed and rolled back alone

PR title: **Choose destinations in code so different groups get different places**

PR body:

> **What changed**
> Destination choice moved out of the model. A scored selector picks up to three places from `destination_profiles` using what the group actually said, then the model writes the pitch for those fixed places.
>
> **Rules now enforced**
> - No two options in the same region or within 150 km
> - At most one headline destination per set
> - Popular and frequently-served places are down-weighted
> - Every option traces to a stated group preference, shown as a "Why this" line
> - "Less crowded", "eco-friendly" and similar appear only with stored evidence
> - Thin data gives fewer options, never invented ones
>
> **Tests**
> Build fails if the five most-served destinations exceed 40% of results across the fixture groups.
>
> **Owner steps before merge**
> 1. Run `sql/destination-diversity-2026-11-22.sql` in Supabase after checking names
> 2. Confirm popularity figures exist for the pilot cities; null is acceptable
> 3. Check the preview deployment with two different test groups
>
> **Not included**
> Account deletion, custody, Stripe changes.

## Kickoff prompt for Claude Code

> Read `REACH-DESTINATION-DIVERSITY-2026-11-22.md`. Do Task 0 and write findings to `STATUS.md` before changing any code. Correct every path, table and column name in the directive against the real repo and schema. Then work Part A in order on branch `feat/destination-diversity`, one commit per task with `npm run verify` green. Do not run migrations and do not push to `main`. Stop and report after Part A; wait for my go-ahead before Part B, and again before Part C.
