// ─── Brand constants ─────────────────────────────────────────────────────
// Shared by everything that renders outside the main app component: the HTML
// shell, the loading state, the invite page and the email templates.
//
// These drifted badly. The shell painted a cool #050508 while the app inside
// was warm #0A0805, the loading spinner and every email button were still the
// indigo #6C63FF from a palette the app stopped using, and the theme colour
// was a third value again. One import now, so a change lands everywhere.

export const BRAND = {
  /** The surround outside the app frame. */
  page: '#050406',
  /** The app's own surface. */
  bg: '#0A0805',
  /** Warm gold. */
  accent: '#D4A843',
  /** Gradient foot for raised buttons. */
  accentDeep: '#C49A38',
  /** Text on gold. White on gold is 2.2:1 and fails; this is 9.0:1. */
  onAccent: '#1A1206',
  /** Raised surfaces. */
  s1: '#120F09',
  s2: '#1A1510',
  border: '#2E2618',
  /** Primary and muted text on dark surfaces. All clear 4.5:1 on bg. */
  t1: '#F5EDD8',
  t2: '#9A8A6A',
  t3: '#97845E',
} as const;

/** The surround outside the app frame, one value per theme.
 *  The HTML shell paints this before React mounts, so it cannot reach the
 *  app's own CSS variables — these two have to live somewhere the server can
 *  read. Everything inside the frame themes itself from the token block in
 *  reach-app.jsx. */
export const SHELL = { light: '#EDE6D8', dark: '#050406' } as const;

/** The app surface behind the frame, per theme. Used for the browser chrome. */
export const SURFACE = { light: '#FCFAF5', dark: '#0A0805' } as const;

/** The key the app stores the viewer's theme choice under. Shared so the
 *  no-flash script in the shell and the toggle in the app cannot drift. */
export const THEME_KEY = 'reach-theme';

/** Inline button style for HTML emails, where classes are unreliable. */
export const emailButtonStyle =
  `background:${BRAND.accent};color:${BRAND.onAccent};padding:12px 24px;` +
  `border-radius:8px;text-decoration:none;display:inline-block;` +
  `margin:16px 0;font-weight:600;`;
