# UX Ledger — Wave 0 audit (2026-11-08)

Spec: `~/REACH-UX-AUDIT-2026-11-08.md`. Wave 0 is read-only: nothing in the product was
changed. Every screenshot is under `docs/ux-audit/` (PNG, phone viewport, downscaled to
1.5x density); file names are `F<flow>-<persona>-<step>.png`.

**How it was walked.** Production (`www.alcanzar.io`), Stripe confirmed **test** mode with a
signed-in `GET /api/health/modes` (`"stripe":"test"`), Playwright device emulation:

| Persona | Device | Theme | Account |
|---|---|---|---|
| Maya, 27, planner | iPhone 14 | dark | QA account A |
| Devon, 31, invited | iPhone 12 Mini | dark | QA account B, shown as a brand-new account by intercepting `/api/groups` and `/api/me` (F01–F04, F12, F17–F20); as account B elsewhere |
| Rosa, 58 | iPhone SE | light | QA account B |
| Sam, 24, low budget | Pixel 5 | dark | QA account B |

Every write a page tried was answered locally (nothing reached the server) except the one
test plan below. The owner's demo plan (`b21bae42…`, solo, A only) was opened **view-only**
for all four device/theme pairs using account A's session. Nobody tapped "Pay" or "Approve".

**Test data.** One plan, "QA UX audit (test) — Charleston long weekend, food and a…"
(`6d2b9152-9cd5-4306-bc7a-9fc4bd774e8c`), in the QA test group: Maya created it through the
UI, account B (as Sam) answered, Maya generated the three options, Maya and Sam voted, then
Maya called it off through the UI ("Call this one off" → "Call it off"). The API reads it back as
`cancelled` (`docs/ux-audit/F07-maya-9-call-off-confirm.png`, `F07-maya-10-called-off.png`).

**Severity.** S1 blocks completion or misstates money/state at a decision point · S2 confuses
or adds taps · S3 polish · S3 *idea* = a feature, logged not proposed.
**Principle** = §1 number. "R" = the repo's own rule in `CLAUDE.md` (Reach states only what it
has verified).

---

## Summary — the five changes that would most improve "beautiful, enticing, pain-free"

1. **Start a trip on one screen, answer it on one screen.** Today Maya goes through two
   stacked flows. "New plan" is 7 screens; "Plan it as a group trip" on screen 4 throws away
   the place and dates she typed and starts a *second* 7-step quiz. That is 23 taps and about
   10 screens before anyone is asked. Members then answer 6 screens of the same questions,
   and nothing tells them where the trip is going. Build one composer: blurb, optional place,
   dates and an exact budget, with sensible budget presets for the trip's length. Give
   members one screen ("I'm in, nothing to add" or a suggestion, with the place and dates on
   it). Maya goes from 23 taps to about 6, Devon from 10 to 2. (F05-01..05, F06-01..02)
2. **Make the three options feel like magic, not a spreadsheet.** The vote screen is about
   1,330 words. Each card runs about two phone screens and carries three actions, and when
   the place is fixed all three show the same photo under "Where should we go?". Use three
   compact cards: photo, the per-person price as the hero number, three differences, and
   one "Vote" with the details folded away. Write a headline that fits the case ("Three ways
   to do Charleston"). The organiser's "Pick" stays closed until the vote has run. (F07-02..05)
3. **One set of numbers, everywhere.** On the same plan, Budget says "About $783 under the
   $900 you set", while Checkout says "$69.24 over". The Book tab lists the flight and hotel
   twice, once as "$54.86 quoted" and once as "Not estimated yet". All four screens should
   read one total from the booking rows. Show each booking once. After payment, open an
   itinerary view with the days first, not "To book 0 of 3". (F08-02, F11-01..02)
4. **Tell the truth about state, including when things break.** When the server fails, Groups
   says "Nothing planned yet". A cold offline open is a blank white page. Called-off plans
   stay on the calendar, stay in the bell as "waiting on you", and open from old links as a
   live vote. A missing plan says "It may still be saving". Fix these: errors with a retry,
   an offline shell that opens the itinerary, cancelled plans gone everywhere, and missing
   plans named for what they are. (F19-02..05, F18-01, F20-01, F07-10)
5. **A phone-first polish pass.** White text on the orange accent fails AA. Sticky footers
   cover the date inputs and the "one trip at a time" notice on smaller phones. Many tap
   targets are under 44 px. ISO dates and E.164 phone numbers show as-is. NASA attribution
   paragraphs sit on decision screens. Several screens have two Back controls. Discover's
   "Tonight" leads with gigs 54 miles away. All of it is small, all of it shows on every
   screen, and together it is the difference between "works" and "beautiful".
   (F04-07, F05-05, F05-14, F10-03, F12-02, and the S3 rows)

---

## Severity counts

| | S1 | S2 | S3 | Total |
|---|---|---|---|---|
| All flows | 3 | 39 | 55 | 97 |

| Flow | S1 | S2 | S3 | Flow | S1 | S2 | S3 |
|---|---|---|---|---|---|---|---|
| F01 Landing | 0 | 1 | 3 | F11 Itinerary | 0 | 3 | 3 |
| F02 Invite → join | 0 | 1 | 1 | F12 Discover | 0 | 1 | 3 |
| F03 Quiz | 0 | 1 | 5 | F13 Restaurant | 0 | 0 | 4 |
| F04 Home | 0 | 5 | 2 | F14 Live trip | 0 | 2 | 0 |
| F05 Create a trip | 0 | 8 | 7 | F15 Settle-up | 0 | 0 | 2 |
| F06 Member input | 0 | 3 | 3 | F16 Post-trip | 0 | 2 | 1 |
| F07 Options + vote | 0 | 5 | 4 | F17 Profile | 0 | 0 | 4 |
| F08 Plan detail | 1 | 0 | 3 | F18 Groups | 0 | 1 | 2 |
| F09 Funding | 0 | 1 | 1 | F19 Errors/offline | 2 | 2 | 0 |
| F10 Checkout | 0 | 0 | 5 | F20 Notifications | 0 | 3 | 2 |

Pass notes (things that already meet the directive) are kept in each flow's section. They are
not counted.

---

## Known defects — confirmed or closed

| Defect | Status | Evidence |
|---|---|---|
| "See my itinerary" not navigating | **Closed in code, not live-verified.** All three buttons call `replace("planDetail",{initialTab:"itinerary"})`, `replace` is in the common props (`components/reach-app.jsx` ~17397), and `"itinerary"` maps to the Book tab, where the days now live (~11782). Live check needs a paid trip, and Pay is off-limits. Still open as a *naming* fault: the button says "itinerary" but lands on "To book 0 of 3 done" (F11-01). | code; `F11-maya-tab-book-1.png` |
| Tab labelled "undefined" in Discover | **Closed.** Tabs read "Upcoming · 33" and "Places · 18" for all four personas. | `F12-maya-1-discover.png`, `F12-rosa-1-discover.png` |
| Recommendations for the wrong city | **Not reproduced.** The location chip reads "Near you in Southern Pines" for all four. A related fault remains open: "Tonight" leads with gigs 54–55 mi away (F12-02). | `F12-maya-1-discover.png` |
| Checkout showing three "restaurant" items at $0 | **Closed on the demo plan.** Checkout shows one "thing you book yourself" (Shokudô, "About $48 a person · estimate"), outside the total. | `F10-maya-1-top.png` |
| Two "Book everything" CTAs with mismatched totals | **Closed as stated.** There is one "Book everything · $969 →" on the Book tab and one "Pay $969.24 →" on the Overview, and the totals agree. A **different total mismatch is open and S1**: the Budget tab says "$783 under" (F08-02). Two verbs for one action remain (F08-04). | `F08-maya-1-top.png`, `F11-maya-tab-book-3.png`, `F09-maya-tab-budget-1.png` |
| Header showing a literal "←" | **Closed.** No `←` in JSX text (grep: 0). Checkout's header renders the glyph "← Your trip". Still inconsistent with the "‹ Back" header on every other screen (F10-04). | `F10-maya-1-top.png` |
| Quiz tiles too big for a phone | **Partly closed.** The 15 tiles fit an iPhone 14 with Done visible. On iPhone SE, screen 1's fifth option and Done fall below the fold, and screen 2 scrolls (F03-02). | `F03-maya-2-quiz.png`, `F03-rosa-1-quiz.png`, `F03-rosa-2-quiz.png` |
| Museums re-suggested after being visited | **Confirmed, by design.** `lib/recommendation-memory.ts` keeps "done" places on Discover with a "✓ You've been" badge; only "Not for me" hides one. Not re-tested live, because marking a place writes. Logged as S3 (F12-04): sort visited places last or fold them into a "Been there" row. | code |

---

## F01 Landing / first open

| Measure | Maya | Devon | Rosa | Sam |
|---|---|---|---|---|
| Time to first meaningful screen | 1.0 s | 0.7 s | 0.5 s | 0.8 s |
| Taps to completion (landing → signed up → onboarding done) | ~11 | ~11 | ~11 | ~11 |
| Screens | 2 + 4 onboarding | same | same | same |
| Dead ends | 0 | 0 | 0 | 0 |
| Words on landing | 169 | 169 | 169 | 169 |
| New user knows what's next? | Yes, the CTA is above the fold on all four, SE included | Yes | Yes | Yes |

| ID | Flow / step | Persona | Observation | Sev | P | Fix | Taps before → after |
|---|---|---|---|---|---|---|---|
| F01-01 | Sign-up → onboarding | all | Sign-up asks for first and last name, then onboarding asks for the name again (`F01-maya-3-signup.png`, `F02-devon-3-onboarding-step1.png`). | S2 | 1, 2 | Ask for the name once. Drop it from the Clerk form, or prefill onboarding and skip that step. | 3 → 0 |
| F01-02 | Landing header, sign-up form | all | The "Sign in" header link and the Clerk inputs (~40 px) are under 44 px (`F01-rosa-1-landing.png`). | S3 | 9 | Make header links and inputs at least 44 px tall. Pass `appearance` to Clerk. | — |
| F01-03 | Sign-up | all | Clerk's generic "Welcome! Please fill in the details to get started." (`F01-sam-3-signup.png`). | S3 | 7 | Replace it with a Reach line in the brand serif, e.g. "Let's get your people together." | — |
| F01-04 | First open | all | No add-to-home-screen hint on iOS, though `manifest.json` is present. | S3 idea | 9 | After first sign-in on iOS Safari, a dismissible one-line "Add Reach to your Home Screen" sheet. | — |

## F02 Invite link → join

| Measure | Devon (new) | Maya / Rosa / Sam (members) |
|---|---|---|
| Time to invite page | 2.5 s | — |
| Taps from link to "in the group" | ~8 + sign-up fields | 0 (already members) |
| Screens | link → sign-up → 4 onboarding → invite → group | group |
| Dead ends | Group screen after join: "Nothing on right now" when no trip is open | 0 |
| Words | invite 34, group 148 | 148 |
| Knows what's next? | Only if a trip is open. Otherwise no. | Yes |

| ID | Flow / step | Persona | Observation | Sev | P | Fix | Taps before → after |
|---|---|---|---|---|---|---|---|
| F02-01 | After join | Devon | It takes ~8 taps (plus sign-up fields) before Devon answers anything. Joining lands on the group screen, not the open trip's question or the quiz. With no trip open, it reads "Nothing on right now" (`F02-devon-6-group-after-join.png`). | S2 | 1, 6 | After join, go straight to the open trip's one-screen input (F06). With no trip open, go to the 6-screen quiz with "Skip for now" visible. | 8 → 3 |
| F02-02 | Group header | all | "2 people · $0 wallet" is jargon to a new member, and $0 reads like a debt (`F02-sam-1-joined-group.png`). | S3 | 5, 7 | Hide the wallet until there is money in it. Then say "$X put in so far". | — |
| pass | Invite page | Devon | Clear, one CTA, sign-in alternative (`F02-devon-1-invite-link.png`). | — | — | — | — |

## F03 Onboarding quiz

| Measure | Maya | Devon | Rosa | Sam |
|---|---|---|---|---|
| Screens / taps (2 picks + Done) | 6 / ~18 (6 minimum via Skip) | same | same | same |
| Words per screen (median / max) | 43 / 54 | 43 / 59 | 43 / 54 | 43 / 54 |
| Dead ends | 0 | 0 | 0 | 0 |
| Knows what's next? | At the result, no: the primary button is "Invite your crew" | same | same | same |

| ID | Flow / step | Persona | Observation | Sev | P | Fix | Taps before → after |
|---|---|---|---|---|---|---|---|
| F03-01 | Result screen | all | The gold primary is "Invite your crew to find out theirs". "Done" is secondary, so the next step is not the obvious action (`F03-maya-8-result-scroll.png`). | S2 | 1, 6 | Make "Done" (or "Plan something with them") the primary and turn the invite into a quiet text link. | 1 → 1 (clarity) |
| F03-02 | Screen 1 and 2 | Rosa (SE) | Screen 1's fifth option and Done sit below the fold. Screen 2's 15-tile grid scrolls (`F03-rosa-1-quiz.png`, `F03-rosa-2-quiz.png`). | S3 | 9 | Sticky Done bar at the bottom. On small phones use 3-column tiles with smaller emoji. | +1 scroll → 0 |
| F03-03 | Food screen | all | "Nothing — I eat everything" is styled as a filled primary and reads as already selected. | S3 | 1, 10 | Style it as an ordinary option tile. Selected state = gold outline + check. | — |
| F03-04 | Result | all | "Here's what that means near you — Looking near you…" never resolved in the walk (writes were blocked; recheck live). | S3 | 8 | Skeleton rows with words, and a 2 s fallback line. | — |
| F03-05 | Result vs Profile | Maya | The quiz names the result "You're a bit of everything". Profile names the same answers "The Scout — with a side of Storyteller" (`F17-maya-1-profile.png`). | S3 | 7 | One name for a result, used in both places. | — |
| F03-06 | Every screen | all | "Skip" is under 44 px. | S3 | 9 | 44 px hit area. | — |
| pass | Whole quiz | all | Multi-select, Skip on each screen, "About a minute", progress dots, no ✕ on a required first run (P2). | — | — | — | — |

## F04 Home

| Measure | Maya | Devon (new) | Rosa | Sam |
|---|---|---|---|---|
| Time to first meaningful screen | 1.9 s | 2.0 s | 2.1 s | 2.0 s |
| Taps to the one action | 1 (Pay →) | — | 1 (Answer →, while a trip awaited input) | 1 |
| Words (whole scroll) | 368 | 352 | 314 | 309 |
| Dead ends | 0 | 0 | 0 | 0 |
| Knows what's next? | Yes ("Waiting on you · Pay") | No: the hero is a question with no input | Yes | Yes |

| ID | Flow / step | Persona | Observation | Sev | P | Fix | Taps before → after |
|---|---|---|---|---|---|---|---|
| F04-01 | Upcoming trips | Maya | "Upcoming trips" shows only "＋ New plan", though the live DEMO plan sits in "Waiting on you" just above (`F04-maya-1-home.png`). | S2 | 4, 8 | Upcoming lists every live plan (it is in `nexts`). Show "＋ New plan" as a trailing tile. | — |
| F04-02 | Ideas carousel | all | Each idea card is ~60 words (held counts, "you said", weather, NASA credit, estimate) and reads like a feed (`F04-sam-2-home-scroll.png`). | S2 | 1, 3, 7 | Card = photo, title, one line of why, price range. Weather and source sit behind the card. | — |
| F04-03 | Hero, no active trip | Devon | The hero "Who's on your mind today?" is a question with no box to answer in. "Three ways to start" sits below the carousel, off the first screen (`F04-devon-1-home.png`). | S2 | 1 | Per the Home spec: the blurb box as hero ("A weekend with…" input + Go). Ideas go below. | 3 → 1 |
| F04-04 | Header | all | The sign-out icon is one tap from every screen, with no confirm. Sign-out is also in Profile (`F04-maya-1-home.png`). | S2 | 1, 10 | Remove sign-out from the header and keep it in Profile, with a confirm. | — |
| F04-05 | Waiting-on-you card | Rosa, Sam (light) | "Answer →" is white text on the orange accent (#EC6032), about 3.3:1, below AA (`F06-rosa-m03.png`). | S2 | 10 | Dark ink (#142119) on the orange, as in the Pay buttons. | — |
| F04-06 | Carousel CTAs | all | "Plan the weekend →", "Plan the night →" and the × dismiss are under 44 px. | S3 | 9 | 44 px hit areas. × as a 44 px corner target. | — |
| F04-07 | Load | all | `/api/nearby` 3.0–4.2 s, `/api/profile` 4.1 s and `/api/me/trips-map` 3.8 s, with no skeleton for the ideas (from `notes.jsonl`). | S3 | 8 | Skeleton cards with words, and cache nearby for the session. | — |

## F05 Create a trip

| Measure | Maya (group path) | Maya (direct path) | Rosa (group path) | Sam / Devon (solo) |
|---|---|---|---|---|
| Taps to "asked the group" / "created" | 23 | 14 (stopped before "Create trip 🎉") | blocked at step 6 by one-trip rule | not completable in the walk: "Just me" writes a solo group on tap (S3 F05-13) |
| Screens | ~10 (3 + 7) | 7 | 6 | 1 shown |
| Scripted time | 50 s | — | — | — |
| Words per screen (median / max) | 117 / 151 | — | — | — |
| Dead ends | 0 | 0 | 0 visible (the reason sits under the footer on SE) | — |
| Knows what's next? | Mostly. Two primaries on screen 4. | Yes | No: Continue is disabled with no visible reason | — |

| ID | Flow / step | Persona | Observation | Sev | P | Fix | Taps before → after |
|---|---|---|---|---|---|---|---|
| F05-01 | Whole flow | all | 7 screens: Type → Where → When → Style → Stay → Rules → Budget. The directive asks for blurb + optional place + dates + exact budget on one screen (`F05-maya-0a-newplan.png` … `F05-maya-0i-step7.png`). | S2 | 1, 2 | One composer screen: blurb, place (optional, "Surprise us" default), date range, budget per person. Style, stay and rules become optional chips under "Anything else?". | 14 → 5 |
| F05-02 | Screen 4 → "Plan it as a group trip" | Maya, Rosa | The button discards the place (Charleston) and dates (Mar 12–14) already entered and starts a second "Step 1 of 7" quiz with empty date fields (`F05-maya-0f-step4.png`, `F05-maya-1-start.png`, `F05-maya-q2.png`). | S2 | 2, 6 + R | Carry everything already said into the group path, or merge the two flows (F05-01). Never ask twice. | 23 → 6 |
| F05-03 | Screen 4 | Maya, Rosa | Two gold primaries: "Plan it as a group trip →" and "Continue →". The group was already chosen on screen 1 (`F05-maya-0f-step4.png`). | S2 | 1 | One primary. Choosing a group on screen 1 *is* choosing the group path. | — |
| F05-04 | Screen 4, screen 7 | all | "Destination style: City / Beach / Mountains / Nature" is asked after a destination was named, and "Enable destination voting" sits on the budget screen after the place was set (`F05-maya-0i-step7.png`). | S2 | 2 | Show style only when no place is given. Show destination voting only when the place is open. | 2 → 0 |
| F05-05 | Group path, dates | Maya (iPhone 14), Rosa (SE) | The date inputs sit under the sticky Back/Continue footer: labels are cut and inputs hidden until you scroll (`F05-maya-q2.png`, `F05-rosa-q2.png`). | S2 | 9 | Footer becomes part of the scroll flow, or content gets bottom padding equal to the footer height. | +1 scroll → 0 |
| F05-06 | Group path, screen 2 | Rosa (SE) | The group already has a trip in planning. The "one at a time" notice ("Open it" / "Plan a night out instead") and the type tiles are entirely under the footer, so Rosa sees only a disabled Continue (`F05-rosa-q2.png`). The notice also arrives only on screen 6 of the combined flow, after type, place, dates, style and blurb. | S2 | 6, 9 | Say it on screen 1, the moment the group is picked: "QA test group is already planning a trip. Open it, or plan a night out". Keep it above the fold. | 6 wasted → 0 |
| F05-07 | Group path, screen 2 | Maya | "From what you said: a trip · beach & sun. We won't ask again." is followed by the night-out/trip question anyway (`F05-maya-q2.png`). | S2 | 2 | When the blurb settles it, show the read-back with a "change" link instead of the question. | 1 → 0 |
| F05-08 | Budget | Sam, all | The budget tiles start at $1,000 and run to $15,000 per person for a 2-night drive. The direct path pre-fills $800 with $1,000–$5,000 chips (`F05-maya-g04.png`, `F05-maya-0i-step7.png`). For Sam, this anchors high and reads as "not for you". | S2 | 5 | Presets scaled to nights and distance (e.g. $250 / $500 / $800 for a weekend drive), with the exact input first. | — |
| F05-09 | "What's this trip about?" | Maya (iPhone 14), Rosa (SE) | ~150 words in two boxes before the textarea, which sits below the fold (`F05-maya-1-start.png`, `F05-maya-1b-grouptrip-scroll.png`). | S3 | 1, 2 | One line of help under the input ("This becomes the trip's name everyone sees"). Put the input first. | +1 scroll → 0 |
| F05-10 | Every create screen | all | Two Back controls: header "‹ Back" and footer "← Back" (`F05-maya-0c-after-type.png`). | S3 | 1 | Keep the header Back. The footer has only the primary. | — |
| F05-11 | Dates | all | A 35-word NASA attribution paragraph dominates the dates screen (`F05-maya-0e-step3.png`). | S3 | 1, 7 | One line: "Usually best: Mar–May, Nov · ⓘ". Attribution sits behind ⓘ. | — |
| F05-12 | Stay | all | No "No preference". Continue stays disabled until a stay type is picked (`F05-maya-0g-step5.png`). | S3 | 2 | Add "Whatever's best" as the default. | 1 → 0 |
| F05-13 | Type screen | Sam, Devon | Tapping "Just me" writes a solo group immediately (`POST /api/groups` on the tap), before any plan exists. Cancelling leaves an empty group behind. | S3 | 10 | Create the solo group when the plan is created, not when a radio is tapped. | — |
| F05-14 | Inputs | all | Destination, exact budget and "anything else" inputs have no label or `aria-label`. | S3 | 10 | Visible or aria labels on every input. | — |
| F05-15 | Plan title | all | The trip's name is the blurb truncated with "…" ("QA UX audit (test) — Charleston long weekend, food and a…") on the hero, notifications and checkout (`F07-maya-v4-after-vote-top.png`). | S3 | 7 | Suggest a short title from the blurb ("Charleston long weekend") and let the planner edit it. | — |

## F06 Member trip input

| Measure | Maya (organiser) | Devon | Rosa | Sam |
|---|---|---|---|---|
| Time to first meaningful screen (answer link) | — | 3.6 s | 3.6 s | 3.6 s |
| Taps to "That's me in" | (part of F05) | 9 | 9 | 10 |
| Screens | — | 6 | 6 | 6 |
| Words per screen (median / max) | 75 | 85 / 89 | 85 / 89 | 74 / 89 |
| Dead ends | 0 | 0 | 0 | 0 |
| Knows what's next? | Mixed: two rules on one screen (F06-04) | Yes | Yes | After "That's me in": "Waiting on everyone's answers" though everyone was in (F06-05) |

| ID | Flow / step | Persona | Observation | Sev | P | Fix | Taps before → after |
|---|---|---|---|---|---|---|---|
| F06-01 | Whole flow | Devon, Rosa, Sam | A member answers 6 screens (about, sort of trip, stay, budget, pace, hard nos). The spec asks for one screen: a suggestion, or "I'm in — nothing to add" (`F06-rosa-m01.png` … `F06-rosa-m06.png`). | S2 | 1, 2 | One screen. Trip name, place and dates at the top. "I'm in" primary. An optional "Anything you'd add?" field and a budget nudge ("Comfortable at $X?") below. Taste comes from the profile quiz, which they already took. | 9 → 2 |
| F06-02 | Screen 1–2 | all members | The member is asked "What's this trip about?" and "What sort of trip are we doing? Beach / City…", but the screen never says the trip is Charleston (dates only) (`F06-rosa-m01.png`, `F06-rosa-m02.png`). | S2 | 2, 3 | Show what the organiser set (place, dates, budget) and ask only what is still open. | 2 → 0 |
| F06-03 | Organiser wait screen | Maya | Two rules contradict each other on one screen: "You can plan with who's answered once somebody besides you has answered" and "Find our trips — Unlocks when everyone's in" (`F06-maya-1-after-save.png`). | S2 | 4, 6 | One rule, one sentence (the business model says: everyone). | — |
| F06-04 | Organiser wait screen | Maya | Three equal buttons (Remind everyone, Pass on the link, locked Find our trips) plus a red Call off. "Remind everyone" sits right under "Nudged NEW — by email". | S3 | 1 | One primary ("Share the link"). Reminders are automatic, so say "We'll remind NEW tomorrow". | — |
| F06-05 | After the last answer | Sam | "Thanks — that's you in". The screen then says "Waiting on everyone's answers… Checking who has answered…" with Find our trips locked, though Sam's was the last answer. The toast also covers the Back row (`F06-sam-done.png`). | S3 | 4, 8 | Optimistically show "That's everyone. Test can find your trips now". Put the toast below the header. | — |
| F06-06 | Screen 1 | Rosa (SE) | The textarea is below the fold under a 40-word intro. | S3 | 9 | See F06-01. | — |
| pass | Privacy | all | "The group sees who has answered, never what anybody said", with avatars ✓ for who has answered (P4, P5). | — | — | — | — |

## F07 Three options, vote and veto

| Measure | Maya | Devon | Rosa | Sam |
|---|---|---|---|---|
| Generation time | 35 s (skeleton + words) | — | — | — |
| Time to vote screen | — | 3.6 s | 3.6 s | 3.6 s |
| Taps to vote | 1 | 1 | 1 | 1 |
| Words on vote screen | 1,336 | 1,327 | 1,305 | 1,333 |
| Dead ends | 0 | 0 | 0 | 0 |
| Knows what's next? | Yes, though "Pick" competes with Vote | Yes | Yes | Yes: "Waiting for Test to pick" |

| ID | Flow / step | Persona | Observation | Sev | P | Fix | Taps before → after |
|---|---|---|---|---|---|---|---|
| F07-01 | Options | all | All three options are "Charleston, South Carolina" (saver / on budget / stretch) with the same photo and tagline, under "Where should we go?" (`F07-maya-1-options.png`, `F07-maya-4-options-scroll.png`). It reads like a bug. | S2 | 3 | When the place is fixed, the headline becomes "Three ways to do Charleston", and each card leads with what differs (stay, area, price). | — |
| F07-02 | Option cards | all | Each card is about two phone screens: full cost breakdown, weather, "because you said", food and music counts. The vote screen is ~1,330 words (`F07-maya-2-options-scroll.png`, `F07-maya-3-options-scroll.png`). | S2 | 1, 3 | Compact cards: photo, per-person price as the hero, 3 differences, Vote. "See what's in it" opens the breakdown. | 6 scrolls → 1 |
| F07-03 | Card actions | Maya | Three actions per card (Veto, Vote for this, gold "Pick …"), × 3 cards, and the gold Pick outranks Vote (`F07-maya-3-options-scroll.png`). | S2 | 1 | Card: one Vote button, with Veto as a quiet "Not this one". The organiser's Pick lives once at the top, after the vote. | — |
| F07-04 | Vote | Maya | The organiser can pick at 1 of 2 votes: "Pick Charleston · saver to go with the vote, or any of them — it's your call" (`F07-maya-v4-after-vote-top.png`). The dated vote is the commitment device (business model §1). | S2 | 4 | Pick unlocks when everyone has voted, or at the vote's deadline. Until then: "Waiting on 1 vote". | — |
| F07-05 | Called-off plan, old vote link | Maya, account B | A called-off plan opens as a live vote, with no "called off" state. Tallies differ by viewer and by load: Maya sees "1 vote · 1 vote · The group picked Downtown Charleston — 1 of 2", account B sees "0 of 2 voted … ✓ Your vote" (`F19-maya-6-old-vote-link.png`, `F19-rosa-6-old-vote-link.png`, `F19-devon-6-old-vote-link.png`). | S2 | 4 | Cancelled plans open on a "Called off by Test on <date>" card with "Start another". A 1–1 tie never reads as "picked". | — |
| F07-06 | Generation | Maya | 35 s with one static sentence; no visible step (`F07-maya-gen-020s.png`). | S3 | 8 | Stepped progress: "Reading 2 answers ✓ · Pricing the drive ✓ · Finding stays…". | — |
| F07-07 | Hero chip | all | "$1000/person" without a thousands separator. Elsewhere it is "$1,000". | S3 | 7 | `toLocaleString`. | — |
| F07-08 | Cost breakdown | all | "Insurance & misc — Activities, parking, tips, incidentals" repeats the Activities line (`F07-maya-5-options-scroll.png`). | S3 | 5 | "Parking, tips, incidentals". | — |
| F07-09 | Tabs during the vote | all | Vote / Overview / Budget / Book are all shown while voting, and Book has nothing to book yet. | S3 | 1 | Only Vote and Overview while voting. | — |
| pass | Per-person cost first | all | "$650 per person, est. · 2 nights" heads each card, estimates are labelled, and votes are shown as counts only (P3, P5). | — | — | — | — |

## F08 Plan detail / overview (demo plan, view-only)

| Measure | Maya | Devon | Rosa | Sam |
|---|---|---|---|---|
| Time to first meaningful screen | 3.0 s | ~3 s | ~3 s | ~3 s |
| Taps to the one action | 1 (Pay →) | 1 | 1 | 1 |
| Words (Overview) | 161 | 161 | 161 | 161 |
| Dead ends | 0 | 0 | 0 | 0 |
| Knows what's next? | Yes | Yes | Yes | Yes |

| ID | Flow / step | Persona | Observation | Sev | P | Fix | Taps before → after |
|---|---|---|---|---|---|---|---|
| F08-01 | Budget tab vs everything else | all | The Budget tab says "Per person, priced so far $117 · About $783 under the $900 you set", and that flights and stay are "Not in the totals below … not an honest one to show until Reach has asked". The Book tab and Checkout show them quoted ($54.86 + $914.38), and Checkout says "That's $69.24 over the $900-a-head budget" (`F09-maya-tab-budget-1.png`, `F09-maya-tab-budget-3.png`, `F10-maya-2-scroll.png`). The real position is $969 + ~$117 on the day, about $186 over. Money is misstated at the moment of decision. | **S1** | 5, 8 + R | One totals function from the booking rows, read by Overview, Budget, Book and Checkout. Budget shows "Booked through Reach $969.24 · On the day ~$117 · $186 over your $900". | — |
| F08-02 | Overview | all | "Edit plan" (header) and "Edit plan details" (bottom) go to the same place (`F08-maya-1-top.png`). The header one is under 44 px. | S3 | 1, 9 | Keep the header ✎ at 44 px and drop the bottom link (CLAUDE.md lists this pair as a judgement call). | — |
| F08-03 | Overview | all | The 35-word NASA attribution paragraph repeats under the weather line, and a 40-word re-pricing paragraph sits under "Bring someone along" on a solo trip. | S3 | 1, 7 | Attribution behind ⓘ. The re-pricing note only appears when someone is actually added. | — |
| F08-04 | Overview vs Book tab | all | The same action has two names: "Pay →" on Overview, "Book everything · $969 →" on Book. | S3 | 1 | One verb (the Checkout spec says "Looks good" → payment sheet). | — |
| pass | Progress rail | all | Plan · Lock in · Pay · Booked dots with "Pay $969.24" as the single primary, and dark ink on orange in light theme (`F08-rosa-1-top.png`) (P1, P4). | — | — | — | — |

## F09 Funding

| Measure | All personas |
|---|---|
| Payment sheet | **Not walked live.** It opens only after "Pay", which is off-limits on the demo plan, and the test plan never reached funding. |
| "Still clearing" vs "not yet paid", 402/409 copy, remind friends | Not reachable: needs a group plan in funding with a processing bank payment. |

| ID | Flow / step | Persona | Observation | Sev | P | Fix | Taps before → after |
|---|---|---|---|---|---|---|---|
| F09-01 | Payment sheet (code) | all | Bank-first is in code: the intent asks for `payment_method_types: [us_bank_account, card]` (`lib/contribution-method.ts`) and the Element orders `["us_bank_account","card"]` (`components/reach-app.jsx` ~14264). The P1 commit (32f22f7) read back exactly those two types on test mode, so **no Klarna tile in bank-first mode**. Risk: if Stripe refuses the bank method (not enabled on the *live* account), the route falls back to `automatic_payment_methods`, and Klarna / Affirm / Cash App Pay (which the code says are on in Stripe) would appear. Checkout still carries Klarna/Affirm return handling (~14188). | S2 | 5 | Owner: enable `us_bank_account` on live before launch. On fallback, pass `payment_method_types:[card]` rather than automatic, so BNPL never appears unannounced. | — |
| F09-02 | Profile → Payment | all | "Payment — No card saved yet" reads as card-only now that the bank is the default. | S3 | 5 | "No bank or card saved yet". | — |
| pass | Share before the vote | all | Each option shows "$650 per person, est." before voting (§4F). | — | — | — | — |

## F10 Checkout (demo plan, view-only; nobody tapped Pay)

| Measure | Maya | Devon | Rosa | Sam |
|---|---|---|---|---|
| Time to first meaningful screen | 3.0 s | ~3 s | ~3 s | ~3 s |
| Taps to pay (to the sheet) | 1 | 1 | 1 | 1 |
| Words | 227 | 227 | 227 | 227 |
| Dead ends | 0 | 0 | 0 | 0 |
| Knows what's next? | Yes ("Pay $969.24 · Pay when you're ready and we'll book it") | Yes | Yes | Yes |

| ID | Flow / step | Persona | Observation | Sev | P | Fix | Taps before → after |
|---|---|---|---|---|---|---|---|
| F10-01 | Over budget | all | "Swap the hotel or flight on the plan, or go ahead if that's fine" has no link. The only way out is the ← arrow (`F10-maya-2-scroll.png`). | S3 | 6 | Inline "Swap the hotel →" opening the Change sheet. | 3 → 1 |
| F10-02 | Line items | all | ISO dates and times ("2026-12-04 → 2026-12-06", "from 2026-11-30 14:59"). The flight shows no times, and "Duffel Airways" is said twice (`F10-maya-1-top.png`). | S3 | 2, 7 | "Fri 4 Dec → Sun 6 Dec". Flight "RDU 7:05 am → CHS 8:10 am". One carrier name. | — |
| F10-03 | Header | all | "← Your trip" as a text header, unlike the "‹ Back" header on every other screen. | S3 | 1 | Use the shared `ScreenHeader`. | — |
| F10-04 | Book-yourself row | all | The phone number reads "+18437894299" on the button and "(843) 789-4299" on the Book tab. | S3 | 7 | National format everywhere. | — |
| F10-05 | Line items | Rosa (SE) | Item text squeezes into a narrow column beside the "Ready to book" chip, and the hotel title wraps to 5 lines (`F10-rosa-1-top.png`). | S3 | 9 | Chip under the title on narrow screens. | — |
| pass | Over-budget copy | all | "That's $69.24 over the $900-a-head budget … or go ahead if that's fine": human words with a next step (P5). The cancellation terms are plain (P5). | — | — | — | — |
| not reachable | Payment sheet → confetti | all | Needs a payment. Code: `useCelebration` fires only when all is booked; "See my itinerary" follows (see known defects). | — | — | — | — |

## F11 Itinerary (the days on the Book tab)

| Measure | Maya | Devon | Rosa | Sam |
|---|---|---|---|---|
| Taps from Overview to the days | 1 tab + ~2 screens of scroll | same | same, ~3 screens | same |
| Words (Book tab) | 470 | 470 | 470 | 470 |
| Dead ends | 0 | 0 | 0 | 0 |
| Knows what's next? | Yes (one "Book everything") | Yes | Yes | Yes |

| ID | Flow / step | Persona | Observation | Sev | P | Fix | Taps before → after |
|---|---|---|---|---|---|---|---|
| F11-01 | Where the itinerary lives | all | There is no Itinerary tab. "See my itinerary" (after payment) and the days both land on "Book", which leads with "To book 0 of 3 done", while the days sit ~2 screens down (`F11-maya-tab-book-1.png`, `F11-maya-tab-book-3.png`). | S2 | 1, 6 | After booking, the tab becomes "Itinerary" with Day 1 at the top. The booking list folds to a status chip ("Booked ✓ 2 · Yours to book 1"). | 2 scrolls → 0 |
| F11-02 | Book tab | all | Flights and stay appear twice: in "To book" ("$54.86 quoted") and again in "Before you go" ("Not estimated yet — priced live at Lock it in"). The two contradict each other on one screen (`F11-maya-tab-book-1.png`, `F11-maya-tab-book-3.png`). | S2 | 1, 4 + R | Each booking once. The day list references it ("Flight — booked above ↑") without repeating a different price state. | — |
| F11-03 | Insider tips | all | Tips state venue facts with no source: "The market only runs Saturday mornings" (Charleston Farmers Market, in December), "Friday and Saturday hours run a bit later here" (Stella's) (`F11-maya-tab-book-4.png`). One tip does cite its source ("They take reservations per OpenStreetMap"). | S2 | R | Tips may state hours or days only from the venue's own data, with the source named. Otherwise keep to weather and pace, which are sourced. | — |
| F11-04 | Rows | all | "Check in 2026-12-04, check out 2026-12-06" in ISO. | S3 | 7 | Human dates. | — |
| F11-05 | Redirect rows | all | One action, three labels: "I've got it" (Book), "I've reserved a table" (Budget, Checkout). The directive says "Booked it ✓". | S3 | 1 | One label everywhere ("Booked it ✓"). | — |
| F11-06 | Day rows | Rosa (SE) | Each day row is ~1.5 screens on SE because the tip paragraphs are long. | S3 | 9 | Tip collapsed to one line with "more". | — |
| pass | Redirect items | all | "Reach can't book Shokudô itself yet. Try their own site, or ring them" with "Their website →" and "📞 Call" (P6, C4). | — | — | — | — |
| not walked | Offline read | all | See F19-02. | — | — | — | — |

## F12 Discover / Moments

| Measure | Maya | Devon | Rosa | Sam |
|---|---|---|---|---|
| Tab → first cards | 2.4 s | 1.9 s | 1.9 s | 1.8 s |
| Words | 239 | 243 | 243 | 243 |
| Dead ends | 0 | 0 | 0 | 0 |
| Knows what's next? | Yes | Yes | Yes | Yes |

| ID | Flow / step | Persona | Observation | Sev | P | Fix | Taps before → after |
|---|---|---|---|---|---|---|---|
| F12-01 | Tonight | all | "Tonight" leads with Cat's Cradle at 54 mi and Raleigh Improv at 55 mi. The list is time-ordered; the directive asks for distance-first with daily variation (`F12-maya-1-discover.png`). | S2 | 3, 9 | Sort within a day by distance, rotating among equals by date seed. Beyond ~25 mi, group under "Worth the drive". | — |
| F12-02 | Cards | all | An event without a photo shows a bare 📍 tile. | S3 | 7 | Venue photo, category illustration, or a typographic card. | — |
| F12-03 | List | all | A drip card ("What's in your glass?") sits mid-list between days. | S3 | 1 | One drip card, at the end of the list or on Home only. | — |
| F12-04 | Visited places | all | By design, places marked done stay on the list with "✓ You've been" (`lib/recommendation-memory.ts`). The known defect is that people read this as being re-suggested. | S3 | 3 | Sort visited last, or fold them into a "Been there" row. | — |
| pass | Detail | all | One primary "See their page", quiet secondary, honest note. The location chip is correct (`F12-maya-4-detail.png`). | — | — | — | — |
| not walked | Moment hooks, dismiss-X | all | Dismiss writes, so it was not tapped. The × appears on the cards. | — | — | — | — |

## F13 Restaurant reservation

| Measure | All personas (demo plan, Shokudô, Stella's) |
|---|---|
| Taps | 1 ("Their website →") + 1 ("I've got it") |
| Dead ends | 0 |
| Knows what's next? | Yes |

| ID | Flow / step | Persona | Observation | Sev | P | Fix | Taps before → after |
|---|---|---|---|---|---|---|---|
| F13-01 | Labels | all | The same "I booked it" action is "I've got it" on Book and "I've reserved a table" on Budget and Checkout (`F09-maya-tab-budget-1.png`, `F11-maya-tab-book-2.png`). | S3 | 1 | See F11-05. | — |
| F13-02 | Time | all | "Fri, Dec 4 (evening) — no time set yet", with no way to choose a time there (`F10-maya-1-top.png`). | S3 | 6 | Show a "Pick a time" chip row (7:00 / 7:30 / 8:00) before "Their website →". | — |
| F13-03 | Second dinner | all | Stella's (Saturday dinner) is "Just turn up", with nothing showing that this comes from the venue's data. A Saturday dinner for a group is the classic place this goes wrong. | S3 | R | Show the source ("Walk-in only, per their site"), or "We don't know if they take bookings: call (843) …". | — |
| F13-04 | "We'll call them for you" | all | Not shown. The reservation agent is design-only (`f4617be`), and not offering it is correct today. | S3 idea | 6 | Show it when the agent is approved, with the result copy from REACH-RESERVATION-AGENT. | — |
| pass | Redirect first | all | "Reach can't book Shokudô itself yet. Try their own site, or ring them", with Website + Call + mark-done. Checkout explains "a table goes on your own card so your card's dining benefits still count" (§4F, P5). | — | — | — | — |

## F14 Live trip mode — **not reachable**

Needs a booked trip whose dates include today. None of the QA plans is in that state.

What the code shows (`components/reach-app.jsx` ~13144, `lib/pings.ts` ~447–700, `public/sw.js`):
there is **no live-trip screen**. While `tripTiming` is `on_now`, the plan overview adds "This
trip is happening now, so there is nothing left to book ahead…" and the booking button becomes
"Open the booking list →". On-trip pings: "A week until <trip>" (packing), "Your flight is
tomorrow", "Tonight: <venue>", and a flight-day note from FlightAware AeroAPI (status, terminal,
gate, "now 7:40 PM (was 7:05 PM)", cancelled), which is skipped entirely when no AeroAPI key is
set. The service worker caches only the trip wallet (`/api/plans/<id>/wallet`).

| ID | Flow / step | Persona | Observation | Sev | P | Fix | Taps before → after |
|---|---|---|---|---|---|---|---|
| F14-01 | Today's plan | all | No "today at a glance". During the trip, the plan still opens on Overview, and the days are on the Book tab under the booking list (F11-01). | S2 | 4, 6 | While `on_now`: open on Today (current and next item, confirmation number, map link, weather). | 3 → 0 |
| F14-02 | Gate and delay pushes | all | The flight-day pings depend on an AeroAPI key. Without one they are silently skipped (`aeroLookup` returns null), and nothing in the UI says delays are not being watched. | S2 | 6 + R | Owner: confirm `AEROAPI_KEY` on Vercel. Without it, say "We're not watching this flight's status. Check the airline app" on flight day. | — |

## F15 Settle-up

| Measure | Maya (solo demo) | Rosa / Sam (group test plan) | Devon |
|---|---|---|---|
| Time to screen | ~3 s | ~3 s | — (account B as Rosa/Sam) |
| Words | 26 | 26 | — |
| Dead ends | yes (Back only) | yes (Back only) | — |
| Knows what's next? | Yes, nothing to do | Yes, "You're all square" | — |

The owing state is **not reachable**: it needs a group trip with recorded shares. The code
(`SettleUpScreen` ~11493) shows "what you owe <name>", "Mark as paid", "Mark received", Venmo
handle capture ("Add your Venmo so friends can pay you back") and undo. Its copy is in plain words.

| ID | Flow / step | Persona | Observation | Sev | P | Fix | Taps before → after |
|---|---|---|---|---|---|---|---|
| F15-01 | All square | Rosa, Sam | "You're all square — Payments happen in your own app." Back is the only control (`F15-rosa-settle-group-1.png`). | S3 | 6 | Add "Back to the trip" and, once the trip is over, "Plan the next one →". | — |
| F15-02 | Copy | all | "Payments happen in your own app" doesn't say which app. | S3 | 7 | "You pay each other in Venmo, Cash App or Zelle. Reach just keeps the tally." | — |
| pass | Solo | Maya | "A trip for one has nobody to settle up with." Honest (`F15-maya-settle-solo-1.png`). | — | — | — | — |

## F16 Post-trip — **not reachable**

Needs an approved trip whose end date has passed. None exists in the QA groups.

What the code shows (`CloseCard` ~11361; `useCelebration` ~9472; `TripMap` ~15610): once
`tripTiming` is `over`, Overview shows "How was it?" with a one-tap emoji scale, a settle line
("Settle up →") when anything is owed, and a "plan the next one" nudge that seeds a new plan in
the same group. The celebration fires when everything is booked, not when the trip ends. The
map is in Profile ("Your map").

| ID | Flow / step | Persona | Observation | Sev | P | Fix | Taps before → after |
|---|---|---|---|---|---|---|---|
| F16-01 | Reaching the close card | all | It appears only on the finished plan's Overview, so the person has to open an old trip to see it. Nothing on Home or in pings (other than settle-up) was found that invites them there. | S2 | 6 | On the day after the trip ends, a Home card and a push: "How was Charleston?" (one tap), then the next-trip nudge. | 3 → 1 |
| F16-02 | Debrief | Maya | The pilot debrief (hours, messages, NPS 0–10, "would you run the next one?", "what almost made you quit?") does not exist yet (A7). The emoji scale is not NPS. | S2 | 6 | Owned by Verify (A7). The UX ask: three taps, one question per screen, after "How was it?". | — |
| F16-03 | Map pin | all | "Your map" is a black box saying "Loading your map…" for ~4 s (`F17-maya-1-profile.png`). The directive wants the destination pinned at the celebration. | S3 | 7, 8 | Map skeleton. Show the new pin at the post-trip moment. | — |

## F17 Profile and preferences

| ID | Flow / step | Persona | Observation | Sev | P | Fix | Taps before → after |
|---|---|---|---|---|---|---|---|
| F17-01 | Map | all | "Loading your map…" black box for ~4 s (`/api/me/trips-map` 3.8 s) (`F17-maya-1-profile.png`). | S3 | 8 | See F16-03. | — |
| F17-02 | Sign out | all | Sign out appears twice (header and Profile). | S3 | 1 | See F04-04. | — |
| F17-03 | Name row | Maya | "Name and home airport …": an ellipsis stands in for the value while it loads. | S3 | 8 | Skeleton line. | — |
| F17-04 | Quiz label | Maya | See F03-05 (one result, two names). | S3 | 7 | — | — |
| pass | Delete / export | all | "Privacy and your data" is present, and the quiz is editable from Profile (`F17-maya-3-profile-scroll.png`). | — | — | — | — |

Measures: words 103–137, no dead ends. Traveler essentials are not asked here (directive: at
first flight booking), which is correct.

## F18 Groups

| ID | Flow / step | Persona | Observation | Sev | P | Fix | Taps before → after |
|---|---|---|---|---|---|---|---|
| F18-01 | Coming-up calendar | Maya, Rosa, Sam | Called-off plans show as upcoming: Nov 20 has three "Din…" and Dec 4 a "Long weeken…", all cancelled QA plans (`F18-maya-1-groups.png`). | S2 | 4 | Filter with `isLive` (as Home already does). | — |
| F18-02 | Tab title | all | The nav tab says "Groups" and the screen says "Your trips — Solo and together". | S3 | 7 | Name the tab and the screen the same. | — |
| F18-03 | Calendar chips | all | The chips ("Din…") and the month arrows ‹ › are under 44 px and truncated. | S3 | 9 | Dots on the grid, and a list of the selected day below. | — |
| pass | Empty state | Devon | One action, "Start planning" (`F18-devon-1-groups.png`). | — | — | — | — |
| pass | One active trip per group | Rosa | Said kindly ("Open it" / "Plan a night out instead"), but too late and hidden on SE. See F05-06. | — | — | — | — |
| not walked | Create group, invite, remove member | all | These write. The invite page itself was reviewed in F02. | — | — | — | — |

## F19 Errors, empty states, offline

| ID | Flow / step | Persona | Observation | Sev | P | Fix | Taps before → after |
|---|---|---|---|---|---|---|---|
| pass | 404 | all | "That page isn't here … Your trips are all still where you left them. Take me back". Human, with a next step (`F19-maya-1-not-found.png`). | pass | — | — | — |
| F19-02 | Offline, cold open | all | Reloading `/home` with no network gives a blank white page (`F19-sam-2-offline-reload.png`). `public/sw.js` caches only `/api/plans/<id>/wallet`, never the app shell, so the wallet it keeps for "a desk in an airport with no Wi-Fi" cannot be reached on a cold start. The directive says offline should read the itinerary. | **S1** | 6, 9 | Precache the app shell, and cache each upcoming trip's itinerary and wallet (network-first, marked "as of <time>"). Offline Home: "You're offline. Here's what you have saved" with the trips listed. | ∞ → 1 |
| F19-03 | Server error shown as empty | all | With `/api/groups` failing (500), Groups says "👋 Nothing planned yet — Start planning", and Home shows ideas with no error (`F19-maya-5-groups-500-tab.png`, `F19-rosa-4-groups-500-home.png`). A server failure reads as "you have no trips" and invites a duplicate group. | **S1** | 6 + R | Distinguish failed from empty: "We couldn't load your trips. Try again" with a retry button. Never render the empty state on an error. | — |
| F19-04 | Link to a plan that is gone | all | "This plan isn't loaded yet — It may still be saving. Go back and open it again", for a plan that does not exist. That is a retry loop with the wrong cause. There are also two Back controls (`F19-maya-3-missing-plan.png`). | S2 | 6 | "This plan isn't available. It may have been called off." Then "See your trips". Keep the "still saving" wording only for temp ids. | — |
| F19-05 | Old vote link on a called-off plan | all | Opens as a live vote. See F07-05 (`F19-maya-6-old-vote-link.png`). | S2 | 4 | See F07-05. | — |

Measures: 404 at 34 words, one action. Offline: a dead end.

## F20 Notifications (bell, push, email)

| ID | Flow / step | Persona | Observation | Sev | P | Fix | Taps before → after |
|---|---|---|---|---|---|---|---|
| F20-01 | Bell | Sam (account B) | Actionable items stay for called-off plans: "Test is waiting on you — Say what you want from Charleston long weekend" sits beside "Test called off Charleston long weekend" (`F20-sam-1-notifications.png`). | S2 | 4 | When a plan is cancelled, resolve its open asks. Keep only the "called off" line. | — |
| F20-02 | Bell | Rosa, Sam, Devon | ~850 words in one sheet, ungrouped. The "Notifications are blocked" banner leads. | S2 | 1 | Group by trip. Show unread first. The blocked banner becomes one line at the bottom. | — |
| F20-03 | Email opt-out | all | The emails (`lib/email.ts` shell) carry no unsubscribe or "email settings" link and no `List-Unsubscribe` header. The only control is the in-app "Mute reminders for this trip". | S2 | 6 | Footer links "Mute this trip · Email settings", plus a `List-Unsubscribe` header for reminder emails. | — |
| F20-04 | Receipt email | all | "Your payment is held on Reach's Stripe account and is spent only on booking this trip" (`lib/email.ts` `sendPaymentReceipt`). The business model says no custody of member funds (fintech counsel open). This copy states custody. | S3 | 5 | Coordinator / Rail to confirm the wording with counsel, e.g. "Your payment goes to booking this trip; anything not spent is refunded the way you paid." | — |
| F20-05 | Email look | all | System font, a lowercase "reach" wordmark, brown/gold that is not the brand tokens. | S3 | 7 | Wave 2 tokens in the email shell (Fraunces heading, maroon/gold or the light green). | — |
| pass | Funding email | all | "Your share is ready to pay — Nothing is booked until everyone has paid", with one button (P5, P6). | — | — | — | — |

Frequency: reminders run from the daily cron (`app/api/cron/pings`), and "Mute reminders for
this trip" exists on Overview. There is no global frequency setting (S3 idea, inside F20-03).

---

## Per-flow measures, at a glance

| Flow | Taps to completion (best persona) | First meaningful screen | Screens | Dead ends | Words / screen | New user knows what's next? |
|---|---|---|---|---|---|---|
| F01 | ~11 | 0.5–1.0 s | 6 | 0 | 169 | Yes |
| F02 | ~8 + sign-up | 2.5 s | 7 | 1 (no open trip) | 34–148 | Partly |
| F03 | 6–18 | — | 6 + result | 0 | 43 | No, at the result |
| F04 | 1 | 1.9–2.1 s | 1 | 0 | 309–368 | Yes, except a new account |
| F05 | 14 (direct) / 23 (group) | — | 7 / ~10 | 0 | 117 median | Partly |
| F06 | 9–10 | 3.6 s | 6 | 0 | 74–89 | Yes |
| F07 | 1 (+35 s generation) | 3.6 s | 1 | 0 | ~1,330 | Yes |
| F08 | 1 | 3.0 s | 1 | 0 | 161 | Yes |
| F09 | not walked | — | — | — | — | — |
| F10 | 1 to the sheet | 3.0 s | 1 | 0 | 227 | Yes |
| F11 | 1 tab + 2 scrolls | 3.0 s | 1 | 0 | 470 | Yes |
| F12 | 1 | 1.8–2.4 s | 2 | 0 | 240 | Yes |
| F13 | 2 | — | 0 (inline) | 0 | — | Yes |
| F14 | not reachable | — | — | — | — | — |
| F15 | 1 | ~3 s | 1 | 1 | 26 | Yes |
| F16 | not reachable | — | — | — | — | — |
| F17 | — | ~4 s (map) | 1 | 0 | 103–137 | Yes |
| F18 | 1 | — | 1 | 0 | 49–62 | Yes |
| F19 | — | — | — | offline: blank | 34 | No, offline and on errors |
| F20 | 1 | — | 1 sheet | 0 | 490–890 | Partly |

Times are from a desktop connection with phone emulation (`timing.js`). Words are the whole
scrollable screen, from `innerText`. Taps are scripted, so they are the minimum: a person
reading will scroll more.
