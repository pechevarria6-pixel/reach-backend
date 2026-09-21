# NAV-GRAPH

Every screen, every way in, every way out. Built by walking them, not by
reading the router — a route that exists and a screen somebody can reach are
different claims.

Verified 2026-09-21 against production.

---

## Routes

Reach is one app shell plus a few standalone pages. Almost everything a
member does happens inside `/home`, which is why the tab bar rather than the
URL is the real navigation.

| route | public? | signed out | signed in |
|---|---|---|---|
| `/` | yes | 307 → sign-in → 200 | → `/home` |
| `/home` | no | 307 → sign-in, returns here after | the app shell |
| `/onboarding` | no | 307 → sign-in | quiz, then `/home` |
| `/invite/[token]` | **yes** | the invite screen | the invite screen |
| `/privacy` | yes | 200 | 200 |
| `/terms` | yes | 200 | 200 |
| `/sign-in`, `/sign-up` | yes | Clerk | → `/home` |
| anything else | no | 307 → sign-in, returns here | **404 screen** |

A signed-out visitor asking for an unknown address is redirected to sign-in
with a `returnBackUrl` rather than 404'd — deliberately, so an anonymous
caller cannot probe which addresses exist. They reach the 404 after signing
in. This is the app being right; a test asserting a signed-out 404 is wrong.

## Inside the shell

`/home` holds four tabs. Every one is reachable in one tap from any other,
so nothing is more than one tap from anywhere.

```
          ┌──────── tab bar, always present ────────┐
          │                                          │
       Home ──── Discover ──── Groups ──── Profile
          │           │            │          │
          │           │            │          └─ documents, loyalty,
          │           │            │             home city, deletion
          │           │            └─ group → members, invites
          │           └─ place picker ("change") → any city
          │              card → detail → book / dismiss
          │
          ├─ trip card → plan
          │               ├─ Overview → booking list
          │               ├─ Itinerary → days, slots
          │               └─ Budget → per-person split
          └─ "Waiting on you" → the thing that needs them
```

## What was checked

- **No dead ends.** Every screen walked has a way back: the tab bar inside
  the shell, an explicit link on every standalone page. The one dead end
  found in this run — the default 404 — is fixed (`785ad81`).
- **Back never traps.** The `/sign-up/sign-up` address the middleware
  comments warn about redirects rather than rendering nothing.
- **Deep links land.** All ten routes above were requested directly and
  every one resolved to a real screen.
- **Failure screens are screens.** A bad invite token renders a designed
  state with a way out, not a crash and not a blank page.

## Known gaps

- **The new-user path is covered by the harness, not by hand.** Creating an
  account and typing a password are outside what this agent may do, so
  sign-up → onboarding → first group is exercised through `@clerk/testing`
  rather than walked. The screens after it are walked.
- **Checkout past the payment sheet is unwalked** and will stay that way
  until Stripe's mode can be confirmed. Everything up to the sheet renders;
  nothing beyond it has been proven by anyone in this run.
- **Groups and Profile tabs** are reachable and render; their sub-screens
  have not each been walked one by one.
