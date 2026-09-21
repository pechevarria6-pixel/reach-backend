# QA LEDGER

Append-only. One entry per pass. Every bug found, every fix with its commit,
every blocker that belongs to the owner rather than to the code.

The rule this ledger exists to enforce: **evidence, not belief.** A pass is
not green because a build compiled. It is green because a screen was opened
and read.

---

## Pass 0 — hour-zero gates — 2026-09-21 12:0x UTC

Walked: deployment state, Stripe mode, e2e session. | Found: P0 0 / P1 1 / P2 0

**Deploy state — VERIFIED.** All six recent commits are `READY` on Vercel,
including `e80f2b7`. Checked against the deployments API from a signed-in
vercel.com origin rather than inferred from a chunk hash, because a
server-only change does not move the client chunk and the hash would have
said "not deployed" while being wrong.

Worth recording: earlier today two commits silently never deployed. The cause
was a `vercel.json` cron schedule of `0 */3 * * *`. **This account is on the
Hobby plan, which runs a cron once per day**, and a sub-daily schedule is not
a slower cron — it is a rejected deployment, with no failure shown in the
deployments list at all. Reverted in `0bbb497`; the deploy went through
immediately, which is what proved the cause.

**P1 — four cron entries on a plan that allows two.** `vercel.json` now
carries four. The deployment is accepted and `READY`, so this does not block
shipping, but Hobby's documented limit is two cron jobs and there is no
reason to believe all four fire. The venue sweep is the one that matters:
if it stops running, every destination silently stops gaining verified
venues, and the failure looks exactly like "this town has nothing in it".
→ OWNER: confirm in the Vercel dashboard which crons actually run, or move
to Pro. Logged, not worked around.

**Stripe mode — BLOCKED, payment lane OFF.** `GET /api/health/providers`
answers `{"error":"Not authorised"}` to a signed-in browser session: it
authenticates with `CRON_SECRET`, which this session does not hold and must
not be given. The hard rule says payment flows run **only if Stripe is
confirmed in test mode**. It cannot be confirmed here, and independent prior
knowledge says the account is in **live mode with an unverified account**, so
a real charge would be attempted and would fail.

Therefore: no payment, checkout, funding or refund flow will be exercised in
this run. Flow A9 and A10's paid branches are tested up to the payment sheet
and no further. This is the rule working, not a gap.
→ OWNER: to unblock, either confirm test mode yourself or expose provider
mode on an endpoint a signed-in owner can read.

**Account creation — constrained, and already solved properly.** This agent
cannot create accounts or type passwords into forms; that is a standing
safety rule and it is not negotiable for a UI sign-up. The durable fix the
directive itself recommends is already wired: `tests/auth.setup.ts` uses
`@clerk/testing` with a `clerk_test` account, which mints a session
programmatically — no password typed, no real account created. The
new-user path is therefore tested through the harness rather than by hand.

Suite: baseline running.

---

## Pass 1 — suite baseline + copy audit — 2026-09-21 12:2x UTC

Walked: full Playwright suite against production; every user-visible string
in `components/` and `app/`. | Found: **P0 1** / P1 1 / P2 0

**Suite baseline: 67/69 e2e, 475/475 unit.** Both e2e failures were the same
test on two viewports — *"No console errors on home page load"*. The suite
had been reporting it as console noise. It was not noise.

**P0 — the browser called the map directly, and it never worked.**

```
Access to fetch at 'https://nominatim.openstreetmap.org/reverse?...'
from origin 'https://www.alcanzar.io' has been blocked by CORS policy
```

Four client-side calls to Nominatim, all failing in production:

| call | what the user got |
|---|---|
| reverse lookup of device coordinates | city renders as **"Your location"** |
| home-city fallback | fails silently → **no location at all** |
| "where are you going" search | **returns nothing, every time** |
| Discover's place search | **returns nothing, every time** |

The comment beside the fallback warns about precisely this — *"what never
happens is a silent default — that is how a trip planned from Aberdeen came
back with things to do in San Francisco."* It was happening, and Flow B of
this directive names it as a thing to prove.

It also should never have been a browser call: Nominatim's usage policy asks
for a User-Agent identifying the application, which a page cannot set, so all
four were anonymous traffic against donated hardware.

Fix: `67028f0` — new `app/api/geo/route.ts` (signed-in, identified, cached a
day, bounded), all four call sites repointed.

Regression guard: `scripts/check-client-fetch.mjs` — no file that runs in the
browser may name a third-party API host. **Proven to fire**: planted the old
call back, guard exited 1 and named the line; restored, guard passed.

**Copy audit — clean.** Built `scripts/check-spelling.mjs`: every JSX text
node, aria-label, placeholder and title checked word by word against the
system dictionary, with morphology for inflected forms and an allowlist for
what a 1934 dictionary lacks. **Zero misspellings.** Also checked and clear:
no unicode escape literals, no raw enums rendered, no `undefined`/`null`/
`NaN` in text, no unresolved `{placeholder}` braces.

Both guards are now in `npm run verify`. Spelling reports and never fails a
build — a dictionary that old does not get a veto over the product's voice.

**P1 carried from Pass 0**: four cron entries on a two-cron plan.

Suite after fix: 475/475 unit, build clean. e2e re-run pending deploy.

---

## Pass 1b — fix verified — 2026-09-21 12:3x UTC

`67028f0` deployed. Re-ran the failing test against production: **3 passed**
(setup + both viewports). Suite is now **69/69 e2e, 475/475 unit**, no flaky
reruns.

**Safety finding — the e2e suite signs in as the OWNER.** `auth.setup.ts`
logged `Signed in pechevarria6@gmail.com`, not the `test+clerk_test@...`
default: `TEST_EMAIL` in `.env.local` points at the real account.

This matters for the directive's data-hygiene rule. Every signed-in e2e test,
and anything I drive through that session, acts on **Peter's own groups and
plans** — not a sandbox. So for the rest of this run:

- nothing is deleted or cancelled through that session
- anything created is prefixed `QA-` and swept at the end
- destructive branches are walked up to the confirm step and no further

→ OWNER: worth pointing `TEST_EMAIL` at a dedicated `+qa` account so the
suite cannot touch real data. Logged, not changed — env is owner-only.

---

## Pass 2 — navigation: the 404 — 2026-09-21 13:0x UTC

Walked: unknown addresses, signed in and signed out. | Found: P0 0 / **P1 1** / P2 0

**P1 — a wrong address was a dead end.** No custom `not-found` page existed,
so every mistyped URL, stale bookmark and replaced invitation landed on
Next's built-in 404: black Helvetica on white, "This page could not be
found", and **no link anywhere on the page**. The navigation audit's one
unbendable rule is no dead ends; this was the largest one, and reachable
from outside by anybody holding an old link.

Fix: `785ad81` — `app/not-found.tsx` in the app's own tokens, light and dark,
explicit background (a page that inherits transparent flashes white in dark
mode), and a way back. It does not guess why somebody arrived: a wrong
address and an expired invitation are indistinguishable from there.

Two regression tests, **watched failing against production before the fix
shipped**, then passing after: 5/5.

**Corrected my own mistake.** The first version of the test asserted a 404
while signed out and got a 307. That is the app being right, not a bug: the
middleware redirects a signed-out visitor to sign-in with a `returnBackUrl`
so an anonymous caller cannot probe which addresses exist, and they reach
the 404 after signing in. Test rewritten to match the app; the app was not
changed to match the test.

Screen walked and read, not just asserted: renders correctly in dark mode.

Suite: 69/69 e2e (+2 new = 71), 475/475 unit.

---

## Pass 3 — Flow B: Discover & location — 2026-09-21 13:3x UTC

Walked: Discover with and without a saved place, geolocation behaviour,
the whole location precedence chain. | Found: **P0 1** / **P1 1** / P2 1

**Near-miss worth recording.** Discover read "Showing Pittsburgh · NEAR YOU
IN PITTSBURGH" for an owner in North Carolina — the exact symptom this
directive names in Flow B. It is **not a bug**: `reach_place_override` in
localStorage is set to Pittsburgh, precedence is override > GPS > home as
designed, and the screen says which it is using. I nearly filed a P0 on
correct behaviour. Checked before filing; the override is the owner's and
was restored afterwards.

**Measured, and already handled:** `getCurrentPosition` with permission
**granted** returns neither callback — not success, not error — past its own
`timeout` option. Confirmed live at 20s+. The code already carries a 9s
deadline of its own for exactly this, with a comment saying it was measured
at "forty-five seconds and counting". Nothing to fix.

**P0 — `/api/geo` sent every search to Null Island.** The route I added in
Pass 1 read coordinates with `Number(searchParams.get('lat'))`. `Number(null)`
is 0, `Number.isFinite(0)` is true, so a request carrying only `q` was read
as a point at 0,0 and took the reverse branch. **Every search returned zero
hits, always** — while reverse lookups worked perfectly, which is what made
it look like a parsing fault rather than a routing one.

`lib/discovery/where.ts` opens with a comment describing this exact failure
in `/api/nearby`, and exports `whereFrom()` to prevent it. I read that file
this morning and wrote the bug back into a new route beside it. Now it uses
the helper. Fix: `cc80b10`, 4 regression tests on the routing decision, with
the old reading run against them (`q=Raleigh` → `{lat:0,lng:0}`).

Also added: an empty result is now logged. A 200 carrying nothing looked
exactly like "no such place" and said nothing anywhere — that silence is how
this hid behind a green deploy and a passing suite.

**P1 — the home-city fallback could never fire on a fresh load.** Root cause
of Discover telling somebody to "allow location in your browser" when they
already have. `getLocation()` runs from a `useEffect` with empty deps, so it
captures `useHomeCity` at mount, while `syncUser()` is still in flight and
`user` is null. The 9s deadline fires and calls that captured function, which
reads no home city and returns silently.

So the deadline worked and what it handed over to had nothing to work with.
The chain — where you are, then where you live, then ask — stopped dead at
step two, every time, for everyone.

Fix: `2f04715`, a ref holding the freshest user, read at call time. The
airport beside it had the same staleness.

**P2 — the empty state says the wrong thing.** "Allow location in your
browser to see what's on near you" is shown when permission is *granted* and
the device simply never answered. Denied and never-answered are different
states and only one of them is the user's to fix. Not yet fixed; logged.

Suite: 479/479 unit, 71/71 e2e.

---

## Pass 3b — fixes verified in production — 2026-09-21 14:0x UTC

Cleared the saved place, reloaded, waited out the 9s deadline, opened
Discover. Before the fixes it read *"Allow location in your browser"*. After:

> Discover
> **Based on your home city, Raleigh, North Carolina** · change
> 📍 NEAR YOU IN RALEIGH, NORTH CAROLINA
> Pullen Arts Center · Centro · The Blind Barb…

Real Raleigh venues, and the screen says where the location came from rather
than implying GPS — "near you" and "near where you live" are different
claims. The owner's Pittsburgh override was restored afterwards, verified.

**P2 fixed** (`94cf368`): the empty state now asks the browser whether
permission was refused or simply never answered, and says the true one.
Where the device has gone quiet it points at what does work — pick a place —
instead of at a permission already granted. Where the permissions API is
missing the state stays unknown and the copy is unchanged; a guess about
whether somebody granted a permission is not worth making.

Suite: 479/479 unit, build clean.

---

## Pass 4 — Flow A8: the bookings bridge, and double-submit everywhere — 2026-09-21 14:4x UTC

Walked: every booking row in production, the booking route, the funding
route, the legacy payment route. | Found: **P0 2** / P1 0 / P2 0

Read the data first rather than trusting the screen. Booking names and
flight prices are real — no "restaurant × 3 at $0" (restaurants sit at $0
because Reach charges nothing for a reservation, which is honest). What the
rows did show was worse.

**P0 — booking the same thing twice.** `POST /api/bookings` ends in a plain
insert with no idempotency key and no check for what is already there. Every
call creates a row. In production now:

```
4×  flight · RDU → PVR · 2026-11-02   awaiting_approval, pending, pending, confirmed
3×  flight · RDU → PVR · 2026-11-02   cancelled, pending, confirmed
```

For a table that is a duplicated reservation. For a flight it is a second
order with a real fare on it. Could not be reproduced by exercising it —
Duffel orders are off-limits by rule — so it was found by reading the rows
and then the route.

Fix `7d4d260`, in two halves because one cannot be done in the application:
the route now reads what the plan holds and returns a live booking for the
same thing instead of making another (identity = the flight/room/table/
ticket, not the whole payload, since two presses can carry different
travellers). A failed or cancelled booking is deliberately **not** a
duplicate — it is why somebody is pressing again.

That covers a retry. It cannot cover two requests in the same instant, which
is what a fast double-tap sends. → `sql/booking-idempotency-2026-09-21.sql`
adds a unique index over live statuses. **BLOCKED-ON-OWNER.** It deletes
nothing and will refuse to build while the duplicates above are still live;
the query to find them is in the file. A booking is somebody's money and a
migration should not pick which one survives. Until it runs, the insert
degrades cleanly.

**P0 — a double-tap could charge somebody twice.** Same read-then-write
shape in `/api/plans/[planId]/funding`, and this one is money. The in-flight
guard is good — it asks Stripe what became of any existing intent — but two
concurrent requests both pass it and both create an intent.

Stripe has idempotency keys and we were not using them anywhere in the
codebase. Fix `2d43257`: the intent now carries one, keyed on plan + person
+ amount so a retry returns the first intent while a genuinely changed share
is new. The legacy `/api/payments` got the same treatment — unused, but
reachable, and it can charge someone.

New guard `check:idempotency`, in `verify`: anything creating a charge,
intent, refund, transfer or checkout session must send a key or state on the
spot why not. **Proven to fire** — run against the tree before the fix it
named `app/api/payments/route.ts:74`.

**Nothing was exercised.** Stripe's mode still cannot be confirmed from this
session and independent evidence says live, so the payment lane stays
untested by rule. Both fixes are read-and-reason, not charges anybody made.

Suite: 486/486 unit (+7), build clean.

---

## Pass 5 — double-submit sweep, copy audit, suite reliability — 2026-09-21 15:1x UTC

Walked: every POST route that inserts; every user-facing error string.
| Found: **P0 1** / P1 1 / P2 5

**Swept the rest for the double-submit shape found in Pass 4.** Votes are
protected by a pre-check *and* a DB unique constraint. Availability inserts
the new ranges then deletes the old ones, so a resubmit nets out correctly.
No other POST route inserts unguarded. The pattern was contained to bookings
and payments — both now fixed.

**P0 — the suite reported "1 failed, 72 did not run".** Clerk's sign-in hung;
the fallback to the saved cookie jar ran and printed its line, and Playwright
killed the test on its 60s timeout anyway. So `setup` failed and every test
behind it was **skipped rather than run against the jar that had just been
put in place**.

This is the worst kind of failure in a QA run: "72 did not run" reads very
easily as "72 fine", and the whole directive rests on the suite meaning
something. Fix `1767ec6` — the sign-in races a 30s deadline of its own, well
inside the test timeout, so the fallback has time to matter. Same lesson as
the geolocation deadline: when a thing can hang, whatever waits on it needs
its own clock.

**P2 ×5 — error messages that stopped at what went wrong.** The directive's
bar is human words *plus a next step*, and the app already sets it: "That
payment didn't go through. Nothing was taken — you can try again." Six fell
short and now do not:

| before | after |
|---|---|
| Couldn't save that | — try again in a moment |
| Couldn't undo that | — it should still be where you left it |
| Couldn't withdraw that invite | — try again, it is still active |
| Couldn't build the day-by-day plan | — try again, or add days yourself |
| Couldn't search for that just now | — try again in a moment |

A person reading "Couldn't undo that" does not know whether their thing is
gone.

Suite: **73/73 e2e, 486/486 unit, zero flaky reruns** — the first fully
green full-suite run of this session.

---
