# REACH — Accessibility and Palette Pass (2026-11-22)

Command for Claude Code. Save in the repo root beside the other `REACH-*.md` files, then paste the kickoff prompt at the bottom. To run it as a slash command instead, also save a copy as `.claude/commands/reach-a11y.md` and type `/reach-a11y`.

**Read this first.** This was written from the public landing page and from palette values recorded in September, without access to the repo or the signed-in screens. Treat every hex under "Now" as unconfirmed. Task 0 establishes the real values and the real screens; where they differ from this document, the repo wins and you report the difference.

## Goal

The owner does not like how the app looks from an accessibility and interface point of view. Keep the maroon-and-gold identity. Fix surface separation, colour hierarchy, the light theme's failing colours, and the basic accessibility gaps. Show before-and-after screenshots for approval before anything merges.

## Rules for this work

- Branch `feat/a11y-palette`. Do not push to `main`; a push to `main` deploys to production. Open a PR.
- `npm run verify` green before every commit.
- Colour and font values live in the token file only. No raw hex in components after this pass.
- No copy changes beyond what a task names. Vocabulary guard still applies.
- No new runtime dependencies. A dev-only accessibility checker is allowed if the owner approves it in Task 0's report.
- Stop for owner approval after Task 1 and again after Task 5.

## Findings to confirm or correct

Measured with the WCAG contrast formula. Targets: 4.5:1 for normal text, 3:1 for large text and for the visible boundary of controls.

| # | Finding | Measured |
|---|---|---|
| F1 | Cards barely separate from the page | Dark card on background 1.13:1; light 1.05:1 |
| F2 | One hue does every job: cream headings, yellow-tan body text, gold links, gold buttons, gold logo | Links differ from body text mostly by weight |
| F3 | Orange accent fails as text or icon in the light theme | 2.88:1 on light background |
| F4 | White text on orange fails | 3.34:1; dark text on orange is 5.31:1 |
| F5 | Gold logo and gold text wash out in the light theme | 2.14:1 on light background |
| F6 | Light-theme secondary text has no margin | 4.75:1 on background, 4.52:1 on card |
| F7 | Landing-page chips ("A night out", "A weekend away", "A proper trip") look tappable but are plain text | No link or button role |
| F8 | Long body text is centred and tinted | Landing intro: four centred lines in the muted colour |
| F9 | Emoji used as interface icons | Render differently per device; screen readers read their names |
| F10 | Error and success colours unknown | A standard red on the maroon background is only about 4.5:1 |

## Task 0 — Ground truth (write to `STATUS.md`, change nothing)

1. Locate the token file(s). List every colour token with its real value for both themes, and every raw hex or rgb value found outside the token file, with file and line.
2. Recompute F1–F6 and F10 against the real values. Mark each finding confirmed, corrected or not applicable.
3. Capture a screenshot of every screen in the flow inventory, in both themes, at iPhone width, signed in with the QA account: landing, sign-in, onboarding quiz, Home, group, trip creation, trip input, options, voting, plan overview, itinerary, budget, checkout, Discover, profile, every empty state, every error state, offline. Save under `docs/a11y/before/`.
4. For each screen record: any text or control below target contrast; controls with a tap target under 44×44 px; elements that look tappable and are not, or the reverse; missing accessible names; heading order; whether a visible focus ring appears on keyboard focus.
5. Check: does layout survive the browser's text size at 200%? Do animations (confetti, transitions) respect `prefers-reduced-motion`? Is status ever shown by colour alone?
6. Report whether a dev-only automated checker (for example axe run through Playwright) is already present; if not, ask before adding one.

## Task 1 — Proposal for approval

Produce `docs/a11y/PROPOSAL.md` with the final token table (start from the one below, corrected by Task 0), and before-and-after screenshots of four screens: Home, options, checkout, and one light-theme screen. **Stop here for the owner's approval.**

Starting token proposal (ratios measured against the September values):

| Token | Now | Proposed | Result |
|---|---|---|---|
| Dark background | `#2C0E18` | unchanged | — |
| Dark card | `#3F1619` | `#55202A` | Lifts off the page; cream text on it 12.0:1 |
| Dark control border | faint | `#8A5560` | 3.0:1 on background |
| Dark primary text | `#FEF7D9` | unchanged | 16.5:1 |
| Dark secondary text | `#CFC182` | `#E3D9CC` | 12.7:1 on background, 9.3:1 on new card; neutral, so gold reads as "tappable" |
| Gold (actions) | `#C3A342` | unchanged | 7.3:1 on background, 5.3:1 on new card; button label stays dark |
| Orange accent | `#EC6032` | unchanged in dark theme, dark label only | 5.3:1 on background |
| Dark error / success | unknown | `#FF9A8F` / `#86D6A6` | 8.7:1 / 10.3:1 on background |
| Light background | `#EBEFEC` | unchanged | — |
| Light card | `#E4EAE6` | `#FFFFFF` with `#6F8279` border | Border 3.5:1 on background, 4.1:1 on white |
| Light primary text | `#142119` | unchanged | 14.3:1 |
| Light secondary text | `#576E61` | `#4C6156` | 5.7:1 on background, 6.7:1 on white |
| Light accent | `#EC6032` | `#A93C12` | 5.4:1 as text; white label on it 6.3:1 |
| Light gold (text, logo line) | `#CD9D2E` | `#7A5C10` | 5.4:1 on background |
| Light error | unknown | `#B3261E` | 5.6:1 on background |

If a proposed value clashes with the brand on screen, choose the nearest value that still meets the target and note it.

## Task 2 — Tokens and a contrast gate

1. Apply the approved table in the token file. Replace every raw colour found in Task 0 with a token.
2. Add `lib/contrast.ts` and a unit test that fails the build if any declared text/background pair drops below target:

```ts
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
```

The test iterates a table of `{ theme, foreground token, background token, minimum }` covering every text-on-surface pair, every button label on its fill, and every control border on its surface (minimum 3). Adding a token without adding its pairs fails the test.
3. Add a check to `npm run verify` that fails on a raw hex or rgb colour outside the token file.

## Task 3 — Colour rules in components

- Gold is for actions only: buttons, links, the logo. Remove it from body text.
- Orange is reserved for one meaning (urgency or a deadline) and always carries a dark label in the dark theme.
- Links inside a sentence are underlined.
- Status is never colour alone: pair each status chip, error and success with an icon or a word.
- Cards use the card token plus the border token; no surface relies on a shadow alone to separate.

## Task 4 — Structure and interaction

- Landing chips: make them real links into sign-up with the trip type preselected, or restyle them as plain text. Owner's default: make them links.
- Body text longer than two lines is left-aligned and uses the secondary text token at body size, not smaller.
- Replace emoji used as interface icons with one icon set already in the repo; if none exists, keep the emoji, mark them decorative (`aria-hidden`) and report. Emoji inside user content stay.
- Every interactive element: accessible name, minimum 44×44 px target, visible focus ring using the gold token at 3:1 against its surface.
- Headings descend in order on every screen; section labels such as "How it works" are headings.
- Form fields have visible labels, not placeholder-only labels; errors are announced and tied to their field.

## Task 5 — Motion, text size, light theme

- All animation honours `prefers-reduced-motion`: confetti and transitions become a static state.
- Every screen works at 200% text size without clipped or overlapping text.
- Walk the full flow inventory in the light theme and fix anything Task 2's gate cannot see (images, gradients, the logo on light surfaces).
- Capture `docs/a11y/after/` screenshots matching Task 0's set. **Stop for the owner's approval.**

## Task 6 — Tests

- Contrast gate (Task 2) in the unit suite.
- Rendered tests: landing chips are links; a status chip exposes text, not only colour; focus is visible on the primary button of Home and checkout.
- With reduced motion set, the booking celebration renders without animation.
- If the automated checker was approved: run it across the flow inventory in both themes and fail on serious or critical findings.

## The push

Branch: `feat/a11y-palette`

Commits, each with verify green:

1. `docs: a11y and palette command, STATUS ground truth, before screenshots`
2. `docs: palette proposal with before/after`
3. `feat(tokens): approved palette, contrast gate, raw-colour check`
4. `fix(a11y): colour roles, underlined links, status with text`
5. `fix(a11y): landing chips, alignment, icons, targets, focus, headings, labels`
6. `fix(a11y): reduced motion, 200% text, light-theme walk, after screenshots`
7. `test(a11y): rendered checks and automated sweep`

PR title: **Accessibility and palette pass: clearer surfaces, readable light theme, colour with a job**

PR body:

> **What changed**
> Cards now separate from the page, secondary text is neutral so gold means "tappable", and the light theme's orange and gold meet contrast targets. Status no longer relies on colour alone. Focus rings, tap targets, headings, reduced motion and large text are fixed across the flow inventory.
>
> **Guardrails added**
> - Build fails if any text, label or control-border pair drops below its contrast target
> - Build fails on a raw colour outside the token file
>
> **For review**
> Before and after screenshots of every screen, both themes: `docs/a11y/before/` and `docs/a11y/after/`.
>
> **Owner steps before merge**
> 1. Approve `docs/a11y/PROPOSAL.md`
> 2. Review the after screenshots on a phone, in both themes
>
> **Not included**
> Layout redesign, new screens, copy rewrites.

## Kickoff prompt

> Read `REACH-ACCESSIBILITY-PALETTE-2026-11-22.md`. Do Task 0 and write the findings to `STATUS.md` without changing any code; correct every value and finding in the document against the real repo and screens. Then do Task 1 and stop for my approval of `docs/a11y/PROPOSAL.md`. After I approve, work Tasks 2–6 in order on branch `feat/a11y-palette`, one commit per task with `npm run verify` green, stopping again after Task 5. Do not push to `main`.
