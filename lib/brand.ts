// ─── Brand constants ─────────────────────────────────────────────────────
// Shared by everything that renders outside the main app component: the HTML
// shell, the loading state, the invite page and the email templates.
//
// These drifted badly. The shell painted a cool #050508 while the app inside
// was warm #0A0805, the loading spinner and every email button were still the
// indigo #6C63FF from a palette the app stopped using, and the theme colour
// was a third value again. One import now, so a change lands everywhere.
// The values themselves live in lib/tokens.ts.
import { PALETTE, SHELL, SURFACE } from './tokens.ts';

const D = PALETTE.dark;
export const BRAND = {
  /** The surround outside the app frame. */
  page: D.page,
  /** The app's own surface — the maroon sampled from REF6. */
  bg: D.bg,
  /** The wordmark gold, sampled from REF6. */
  accent: D.accent,
  /** Gradient foot for raised buttons. */
  accentDeep: D.accentDeep,
  /** Text on gold or orange. White on the orange is 3.34:1 and fails. */
  onAccent: D.onAccent,
  /** Raised surfaces. */
  s1: D.s1,
  s2: D.s2,
  border: D.border,
  /** Primary and muted text on maroon. */
  t1: D.t1,
  t2: D.t2,
  t3: D.t3,
} as const;

/** The surround outside the app frame, and the app surface behind it, per
 *  theme. The HTML shell paints these before React mounts, so it cannot reach
 *  the app's CSS variables; they come from lib/tokens.ts like everything else. */
export { SHELL, SURFACE };

/** The key the app stores the viewer's theme choice under. Shared so the
 *  no-flash script in the shell and the toggle in the app cannot drift. */
export const THEME_KEY = 'reach-theme';

/**
 * The theme with nothing stored. Maroon and gold is the brand (REF6); light
 * is the alternative. The app said so, but the shell around it stamped
 * nothing, so the front door, sign-up, onboarding and invites all fell back
 * to cream and a new account went cream, cream, maroon (2026-11-06). The
 * pre-paint script in app/layout.tsx stamps this, so every page agrees.
 */
export const DEFAULT_THEME: 'dark' | 'light' = 'dark';

/** Inline button style for HTML emails, where classes are unreliable. */
export const emailButtonStyle =
  `background:${BRAND.accent};color:${BRAND.onAccent};padding:12px 24px;` +
  `border-radius:8px;text-decoration:none;display:inline-block;` +
  `margin:16px 0;font-weight:600;`;
