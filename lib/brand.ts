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
  /** Primary and muted text on dark surfaces. */
  t1: '#F5EDD8',
  t2: '#9A8A6A',
} as const;

/** Browser theme colour, matching the app surface rather than the surround. */
export const THEME_COLOR = BRAND.bg;

/** Inline button style for HTML emails, where classes are unreliable. */
export const emailButtonStyle =
  `background:${BRAND.accent};color:${BRAND.onAccent};padding:12px 24px;` +
  `border-radius:8px;text-decoration:none;display:inline-block;` +
  `margin:16px 0;font-weight:600;`;
