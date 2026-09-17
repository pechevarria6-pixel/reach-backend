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
  page: '#1F080F',
  /** The app's own surface — the maroon sampled from REF6. */
  bg: '#2C0E18',
  /** The wordmark gold, sampled from REF6. */
  accent: '#C3A342',
  /** Gradient foot for raised buttons. */
  accentDeep: '#A8892F',
  /** Text on gold or orange. White on the orange is 3.34:1 and fails. */
  onAccent: '#2A1D06',
  /** Raised surfaces. */
  s1: '#36121B',
  s2: '#3F1619',
  border: '#5A2430',
  /** Primary and muted text on maroon. Both clear 4.5:1 on bg. */
  t1: '#FEF7D9',
  t2: '#CFC182',
  t3: '#B89A6A',
} as const;

/** The surround outside the app frame, one value per theme.
 *  The HTML shell paints this before React mounts, so it cannot reach the
 *  app's own CSS variables — these two have to live somewhere the server can
 *  read. Everything inside the frame themes itself from the token block in
 *  reach-app.jsx. */
export const SHELL = { light: '#DFE5E0', dark: '#1F080F' } as const;

/** The app surface behind the frame, per theme. Used for the browser chrome. */
export const SURFACE = { light: '#EBEFEC', dark: '#2C0E18' } as const;

/** The key the app stores the viewer's theme choice under. Shared so the
 *  no-flash script in the shell and the toggle in the app cannot drift. */
export const THEME_KEY = 'reach-theme';

/** Inline button style for HTML emails, where classes are unreliable. */
export const emailButtonStyle =
  `background:${BRAND.accent};color:${BRAND.onAccent};padding:12px 24px;` +
  `border-radius:8px;text-decoration:none;display:inline-block;` +
  `margin:16px 0;font-weight:600;`;
