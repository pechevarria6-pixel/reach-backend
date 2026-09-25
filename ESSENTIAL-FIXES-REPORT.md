# Essential fixes: report (2026-09-24)

Spec: `REACH-ESSENTIAL-FIXES-2026-09-24.md`. Branch `fix/essential-2026-09-24`, worktree
`.claude/worktrees/essential`, cut from `main` at cfc8b9b, since rebased onto `main` at 803cc20. One commit per fix, each made with
`npm run verify && git commit`. Every new test and guard was planted back and seen to fail, then restored.
No SQL migrations. Nothing was written to the production database: the only live access was one
read-only trial run of `npm run coverage`.

## Fix 1: group plans no longer stall on one member (commit 1c2572a)

**What I found**
- There is a per-trip quiz for groups. The organiser answers `TripQuiz` when starting a group trip, and every
  member then answers the same questions on the `planPrefs` screen (`PlanPreferencesScreen`). Answers are stored in
  `plan_preferences` and read through `lib/group-answers.ts`. It asks: what the trip is about (goal blurb), dates,
  kind of trip, where to stay, pace, budget, and No Way José. The night-out version asks time, area, kind of night,
  food, energy and hard nos. The owner asked for this flow earlier today, so it stays. It is listed under Needs owner.
- The "Waiting on everyone's answers" gate has two halves.
  - Server: `app/api/trips/generate/route.ts`, where `optionsGate(planReadiness(...).members)` returns 409 for the options
    and for the days of each option, and `planReadiness().allReady` gates the days of a picked plan. The same
    `allReady` check gates voting in `app/api/plans/[planId]/vote/route.ts`.
  - Client: the `step==="wait"` block in `GroupTripScreen` (`components/reach-app.jsx`). Its button was
    "🔒 Find our trips", with the comment "No override".

**What changed**
- The organiser sees a **"Plan with who's answered"** button on the wait screen. It appears once at least one member
  besides the trip's creator has answered, or 48 hours after `plans.created_at`, whichever comes first. The timestamp is the
  existing column, so there is no new one.
- The override is enforced on the server. `withAnswered: true` from anyone but the organiser (`isOrganiser`) gets a
  **403**. If the organiser sends it too early, they get a 409. The rules live in `mayGoAhead` and `goAheadDecision` in
  `lib/group-answers.ts`.
- Going ahead is recorded as an `audit_logs` row (`planned_with_answered`, keyed on the plan). This uses a row, not
  schema. `planReadiness` reads the row back, so the ideas, the days of each idea, the vote and any later rebuild all
  agree the trip went ahead. Without this, the trip would have stalled again at the next gate. `announceIfEveryoneIn`
  also stops sending "Everyone's in, built from every one of your answers" after the fact.
- Party size is still counted from every member (`everyone.length`). Members who have not answered add no wishes:
  no taste columns, standing trip summary, budget bucket or travel profile. Their **dietary needs, hard nos and
  not-drinking stay in as constraints** (see Needs owner).
- The organiser's wait screen now reads **"3 of 4 have answered."** above the names. The members' copy is unchanged.

**Tests** (`tests/unit/go-ahead.test.ts`)
- The organiser can go ahead after 1 other answer.
- Answers from the organiser alone are not enough until 48 hours have passed.
- A non-organiser gets 403, even when the go-ahead would otherwise be allowed.
- The route checks before any model call and records the row.
- Party size comes from every member.
- Unanswered members add no preferences.
- `planReadiness` honours the go-ahead while `answered` stays strict.
- The wait screen offers the button only to the organiser.
- Five planted bugs, each caught.

## Fix 2: the quiz stays fast (commit 854ac97)

**What I found:** all six screens needed a Done tap. Screens 1, 3, 4 and 5 were `blend:true` pick-any screens with
Done, screen 2 has Done, and screen 6 has Done or "Nothing — I eat everything". The header already showed
"About a minute" and "N of 6", and `quiz_completed` already recorded `duration_ms`.

**What changed**
- Screens 1, 3, 4 and 5 advance on a single tap. Blending is still possible without slowing a single tap: holding an
  option (450 ms) starts a blend, each tap within **1.5 s** of the last adds to it or takes one away, and the screen
  moves on when the taps stop. Those screens have no Done button.
- The spec's other option, a "second tap within 1.5 s", would have delayed every single tap by 1.5 s, so blending
  starts with a hold instead.
- The scorer still accepts arrays, so blends that are already saved still score.
- `QUIZ_SCREENS` and the tap rules moved to `lib/quiz-screens.ts` so the flow can be tested without a browser.

**Tests** (`tests/unit/quiz-fast.test.ts`)
- A scripted run through all six screens takes exactly **8 taps**, and its scoring deep-equals the scalar fixtures.
- Only screens 2 and 6 need Done.
- Hold-then-tap blending works.
- The component renders Done only through `needsDone`, keeps "About a minute" and "N of 6", and sends
  `duration_ms`.
- Four planted bugs, each caught.

## Fix 3: stop promising what the data can't show (commit 4e9ff73)

**What I found:** nothing in discovery records when a place opened. Scout ranking only matches words like "new" in
titles (`CHASES.scout`), so Discover cannot surface recent openings. Food trucks can never appear, because the
name-and-website rule in `lib/discovery/ingest.ts` excludes them.

**What changed**
- Screen 4 options:
  - "Food truck someone mentioned once" is now **"The spot only locals know"**.
  - "Opened last month" is now **"Somewhere I've never heard of"**.
- The Scout's result: the headline line ("First to find it…") promised neither, but the reveal's novelty dial read
  "New openings". It now reads **"Off the beaten path"**.
- The stored values (`truck`, `new`) and their scores are unchanged.

**Tests**
- `check:vocabulary` now bans "food truck", "opened last month" and "new openings". Planted back, it fires on each.
  (I narrowed "new opening" to "new openings" because the first version matched `new OpeningHours(`.)
- `tests/unit/scout-copy.test.ts` pins the new labels, checks that scores are unchanged and that the guard holds the
  phrases.

## Fix 4: no input that goes nowhere (commit ed033f1)

**a) "Anything you're weirdly into?"**
- **Found:** that wording is not in the codebase. The question it describes is the `free_interests` drip, an id in
  `lib/drip.ts` and a contract field. It has no card in `DRIPS` and no screen offers it, so today it already renders
  nowhere.
- **Changed:** `MOMENTS_ENABLED = false` in `lib/drip.ts`. `dripAllowed` refuses `free_interests` while the flag is off,
  so nobody can wire it up by accident. The code, the contract field and any saved answers are kept.

**b) Cold-weather no-go**
- **Found:** it could be chosen in four places:
  - the trip quiz's No Way José
  - the taste quiz's No Way José (Profile)
  - onboarding screen 6 hard nos (`DISLIKES`)
  - the create-plan "Any dealbreakers?" list, under "Reach won't recommend anything that crosses these lines"
- It could also be ticked from a typed goal ("no cold", in `lib/goal.ts`).
- The prompt carried it as `NEVER INCLUDE: coldWeather`, and each group member's answer line read "will not: coldWeather".
- Separately, the dealbreakers list mapped **"Extreme heat" to coldWeather**, so someone avoiding heat was planned away from
  the cold.
- **Changed:** `CLIMATE_CHECKS_ENABLED = false` in `lib/weather-no-go.ts`. The name is chosen so that feat/climate
  (NASA POWER normals) can turn it on in the commit that makes the check real.
  - With the flag off, all four screens hide the option, and "Extreme heat" is hidden with it, since it is just as
    uncheckable.
  - A typed "no cold" no longer ticks a hidden box.
  - A no-go carried over from an earlier plan's dealbreakers is not pre-ticked.
  - "Extreme heat" no longer maps to coldWeather.
  - Saved answers are kept.
  - A plan that carries one shows the quiet line **"We can't check weather yet."** at the top of Overview. "Carries one"
    means the plan's `dealbreakers`, or the viewer's own per-trip answers read from `GET /api/plans/:id/preferences`.
  - In the prompt, weather no-gos come out of every "never include" and veto list. They become one line that calls the
    no-go a wish that cannot be checked and forbids any claim about weather. Group answer lines now say
    "would rather avoid, unchecked".

**Tests** (`tests/unit/no-input-nowhere.test.ts`)
- With the flags off, neither input renders or is offered: the drip, all four option lists and the goal parser.
- A saved cold no-go shows the line.
- The prompt's veto lists are the hard list only, and the weather line never says it is enforced.
- The group answers block does not carry it as "will not".
- `check:vocabulary` now bans "checked the weather", "weather checked", "avoids the cold" and similar phrases.
  Planted in the plan screen, it fires.
- Seven planted bugs, each caught.

## Fix 5: beta coverage report (commit 5b56295)

**What changed**
- `npm run coverage` runs `scripts/coverage.mjs`. It is read-only, uses `.env.local`, always exits 0, and is not part of
  verify. For each town in `scripts/beta-towns.txt` it:
  - places the town with the app's own geocoder
  - counts checked venues within 2, 5, 12 and 25 miles. These are the menu's own rings. "Checked" means a name and the
    venue's own website, not a place to stay, and not marked gone.
  - counts events dated in the next 14 days within 25 miles
  - prints **PASS** at 20 or more checked venues within 25 miles, otherwise **THIN**
- `scripts/beta-towns.txt` was created with a comment header and is empty for the owner to fill.
- Trial run, read only, with the towns removed afterwards:

  | Town | ≤2 mi | ≤5 mi | ≤12 mi | ≤25 mi | Events (14 days) | Result |
  |---|---|---|---|---|---|---|
  | Raleigh | 212 | 368 | 856 | 1472 | 46 | PASS |
  | Moab | 19 | 19 | 28 | 35 | 0 | PASS |

  A town the geocoder cannot find is listed as "could not place".

**Tests** (`tests/unit/coverage.test.ts`)
- Counting uses a small fixture and never touches the database. It covers ring boundaries, which rows count as checked,
  missing coordinates, the 14-day window, stale events, events placed by their venue's coordinates, and the
  PASS/THIN edge at 19 and 20.
- It also checks the towns file, the table, the exit code, that the script is read-only, and that it is not in verify.
- Four planted bugs, each caught.

## Review fixes

A review of the five fixes found six defects. Each is fixed in its own commit with a test that was planted back and
seen to fail, then restored.

- **R1: Skip during a blend skipped a screen or crashed the quiz (330ccf4).** Holding an option armed the 1.5 s blend
  timer; Skip moved on without cancelling it, and the timer then added one more step. From screen 5 that went to
  step 6, which does not exist, and the quiz crashed; from screens 1 and 3 a screen was jumped. Skip now cancels
  pending timers as Back does, and each timer carries the screen it was armed on (`stepAfter` in
  `lib/quiz-screens.ts`), so a stale one does nothing. Tests in `tests/unit/quiz-fast.test.ts`.
- **R2: the go-ahead was recorded before anything was built (3b101f9).** The `planned_with_answered` row was written
  before the rate limit and the model call, so a 429 or a failed generation still marked the trip as gone ahead, and
  "Everyone's in" was then never sent. The row is now written after the model has returned, just before the ideas
  are saved, and removed if somebody else's ideas landed first. The go-ahead now applies to the ideas only, never to a
  days request. Tests in `tests/unit/go-ahead.test.ts`.
- **R3: a go-ahead with nobody answered stalled every idea's days (fb6c245).** After 48 hours the button opened on
  age alone, so a trip whose organiser's own answers failed to save built ideas from no one's wishes. Then
  `planReadiness` only read the go-ahead row when its lenient `allReady` was false (with nobody asked it is true),
  and every idea's days got a 409. `mayGoAhead` now needs at least one answer, the wait screen imports that rule
  instead of keeping its own copy, and `planReadiness` reads the row unless everybody has actually answered.
- **R4: the organiser's wait contradicted its own button (dc5c769).** The organiser still read "Nothing gets picked on
  one person's say-so" above "Plan with who's answered". The organiser's heading is now the count ("3 of 4 have
  answered.", said once, no longer repeated in the list), and the body says what is true from where they stand
  (`organiserWaitCopy` in `lib/group-answers.ts`). Members' copy is unchanged.
- **R5: two screen-4 answers read the same, and the reveal was crossed (a170e2e).** "Locals' favorite" (novelty 50,
  no Scout points) sat next to "The spot only locals know" (novelty 95, the most Scout points). The reveal told the
  locals-know answer "Nobody's heard of it" and the never-heard-of answer "Off the beaten path". See Needs owner for
  the new wording. Stored values and scores are unchanged. Tests in `tests/unit/scout-copy.test.ts`.
- **R6: a restored draft kept a hidden weather no-go (e299d7e).** A create-plan draft saved before the chips were
  hidden restored "Cold weather". The person could not see it or take it off, and it was posted to
  `/api/recommendations`, whose trip and weekend briefs wrote "Avoid: Cold weather" as a rule. The draft now restores
  only no-gos the screen offers, and the briefs split vetoes as the trip generator does (`avoidLine` in
  `lib/recommendation-schema.ts`). Tests in `tests/unit/no-input-nowhere.test.ts`.

## Needs owner

- **Per-trip quiz for groups exists** (TripQuiz, `planPrefs`, `plan_preferences`). This contradicts the 18 Sep "no quiz at trip
  creation" architecture, but you asked for it today. It asks: goal, dates, trip type, stay, pace, budget and hard nos,
  or for a night out: time, area, kind, food, energy and hard nos. Recommendation: keep it, since the go-ahead now
  stops it stalling, but cut it to goal, dates and hard nos, with everything else taken from the onboarding profile.
- **Members' wait copy was left unchanged, as the spec asked, and it is now not strictly true.** It says "we wait until everyone has answered.
  Nothing gets picked on one person's say-so". The step-0 panel, the finish note and the answer email all say trips
  are only found once everyone has answered. After 48 hours the organiser can go ahead on their own answers. This
  needs new wording. (The organiser's own screen no longer says it: see review fix R4.)
- **Screen 4 wording (review fix R5).** To keep your two wordings ("The spot only locals know", "Somewhere I've never
  heard of") and still have four answers a person can tell apart, "Locals' favorite" became "The neighborhood
  favorite", and the Finds dial stops became Neighborhood favorites / Somewhere new to you / Local secrets. The
  truck's 🚚 became 🤫. These are my words, not yours: replace them if you prefer others. The new test only requires
  that no two answers share their distinguishing word and that each reveal stop matches its answer.
- Someone who answers after the organiser went ahead does not shape the ideas already built, and the answer screen does not
  tell them. Decide what they should see.
- When the organiser goes ahead, members who have not answered keep their **dietary needs, hard nos and not-drinking** as constraints, but their
  budget bucket and tastes are dropped. I kept those constraints so that nobody's allergy is planned around. Confirm,
  or say whether the spec meant to drop these too.
- Scout: whether to allow website-less OSM venues for Scouts, labelled "Not verified — check before you go". Not
  implemented.
- The Scout ranking still boosts titles containing "new" or "opening" (`CHASES.scout` in `lib/traveler-profile.ts`).
  This is ranking, not copy, and was left alone.
- `CLIMATE_CHECKS_ENABLED` (`lib/weather-no-go.ts`) is for feat/climate to turn on when a cold no-go becomes checkable.
  Turning it on brings the options back under "We will never suggest these", so it has to land together with
  enforcement.
- "Extreme heat" is hidden together with cold weather, since it is just as uncheckable, and no longer maps to coldWeather.
  Confirm.
- The "We can't check weather yet." line appears for the plan's dealbreakers and the viewer's own per-trip answers. It
  does not appear for other members' private answers, because showing it would reveal what someone said, or for
  standing profile nos, which reach the prompt only as the wish line.
- The spec's wording "Anything you're weirdly into?" is not in the code. I gated `free_interests`, which is the
  matching drip. Confirm that is the question you meant.
- **Not pushed.** The spec says to push to main if verify is green. The orchestrator said not to push or merge because it merges after
  review. The branch is rebased onto current `main` (803cc20).
- From the spec, already known:
  - Add "Custody model pending legal review; Stripe stays in test mode until resolved." to the brief.
  - Fill `scripts/beta-towns.txt` with each tester's home city, then run `npm run coverage`.
  - Fix the local Duffel key (401) before checking off the Seven Wonders airports item.
  - Get Vercel Pro before any real payment. It is not needed for the test-mode beta.

## Final verify

`npm run verify` on `fix/essential-2026-09-24` (rebased onto main 803cc20, all six review fixes in): PASS, exit 0, all checks green, 1311 of 1311 unit tests pass.
