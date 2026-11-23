// ─── Design tokens: the one place a colour is written ───────────────────
// REACH-ACCESSIBILITY-PALETTE-2026-11-22, Task 2. Every colour in the app,
// the landing page, the sign-in screens and the emails comes from here; a raw
// colour anywhere else fails `npm run check:raw-colour`. Every text, label and
// control-edge pairing is held to its WCAG target by
// tests/unit/contrast-gate.test.ts, and adding a token without adding its
// pairs there fails that test.
//
// Values approved by the owner on 2026-11-22 (docs/a11y/PROPOSAL.md).
//   Dark — maroon and gold, sampled from REF6. The default.
//   Light — off-white and deep green, sampled from REF4.
//
// Two kinds of token:
//   · themed — one value per theme, served to the app as CSS variables
//     (--c-<name>) so the theme swaps without a re-render;
//   · fixed — the same in both themes: what sits on a photograph (always
//     dark under it), the third-party marks, and the identity colours.

/** Colours that change with the theme. */
const DARK = {
  page: '#1F080F',
  bg: '#2C0E18', s1: '#3A1520', s2: '#55202A', s3: '#622A35',
  // `border` is the edge of a control or a card and holds 3:1 against what it
  // sits on; `borderLight` is a divider inside a list and stays quiet.
  border: '#A36F7A', borderLight: '#6B2C39',

  // Gold is for actions: buttons, links, the logo. 7.3:1 on the page.
  accent: '#C3A342', accentDeep: '#A8892F', accentHover: '#D8BC63',
  accentDim: 'rgba(195,163,66,0.14)', accentBorder: 'rgba(195,163,66,0.32)',
  accentText: '#C3A342',
  // The one accent word in a heading (Home's greeting).
  accentWord: '#C3A342',
  onAccent: '#2A1D06', onGreen: '#0C2A17', onRed: '#2A1D06',

  green: '#86D6A6', greenDim: 'rgba(134,214,166,0.12)',
  amber: '#E8A33D', amberDim: 'rgba(232,163,61,0.12)',
  red: '#FF9A8F', redDim: 'rgba(255,154,143,0.12)',
  blue: '#8FB5E3', blueDim: 'rgba(143,181,227,0.12)',

  // Neutral, so gold reads as "tappable" and nothing else does.
  t1: '#FEF7D9', t2: '#E3D9CC', t3: '#C4B6A8', t4: '#C4B6A8',

  navBg: 'rgba(44,14,24,0.95)',
  overlay: 'rgba(20,5,10,0.78)',
  cardShadow: '0 2px 10px rgba(0,0,0,0.35)',
  cardShadowHover: '0 8px 30px rgba(0,0,0,0.45)',
  popShadow: '0 10px 28px rgba(0,0,0,0.22)',
  accentGlow: '0 4px 20px rgba(195,163,66,0.22)',
  accentGlowHover: '0 6px 24px rgba(195,163,66,0.32)',
  focusRing: 'rgba(236,96,50,0.35)',
  grain: "url('data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22140%22%20height=%22140%22%3E%3Cfilter%20id=%22n%22%3E%3CfeTurbulence%20type=%22fractalNoise%22%20baseFrequency=%22.85%22%20numOctaves=%222%22/%3E%3CfeColorMatrix%20type=%22saturate%22%20values=%220%22/%3E%3C/filter%3E%3Crect%20width=%22140%22%20height=%22140%22%20filter=%22url(%23n)%22%20opacity=%22.18%22/%3E%3C/svg%3E')",
  edgeHi: 'rgba(255,255,255,0.10)',
  frameShadow: '0 80px 200px rgba(0,0,0,.95)',
  frameGlow: 'rgba(195,163,66,0.10)',
  // The landing page's mark and the sign-in card's shadow.
  mark: '#C3A342',
  authShadow: '0 24px 80px rgba(0,0,0,.6)',
} as const;

const LIGHT: { [K in keyof typeof DARK]: string } = {
  page: '#DFE5E0',
  bg: '#EBEFEC', s1: '#F4F7F5', s2: '#FFFFFF', s3: '#DAE2DC',
  border: '#6F8279', borderLight: '#C3CCC5',

  // Orange stays the fill; as text on the pale page it is 2.88:1, so green
  // carries text and links, and the one accent word is rust.
  // accentDeep is the button gradient's foot: #D24E24 put the dark label at
  // 3.8:1 there, so it is the nearest orange that holds 4.5:1 (#E35A2D, 4.52).
  accent: '#EC6032', accentDeep: '#E35A2D', accentHover: '#F2764D',
  accentDim: 'rgba(236,96,50,0.12)', accentBorder: 'rgba(236,96,50,0.30)',
  accentText: '#2B583B',
  accentWord: '#A93C12',
  onAccent: '#2A1D06', onGreen: '#FFFFFF', onRed: '#FFFFFF',

  green: '#24693A', greenDim: 'rgba(36,105,58,0.12)',
  amber: '#6F4B00', amberDim: 'rgba(111,75,0,0.12)',
  red: '#B3261E', redDim: 'rgba(179,38,30,0.10)',
  blue: '#1A56AD', blueDim: 'rgba(26,86,173,0.10)',

  t1: '#142119', t2: '#4C6156', t3: '#4F655A', t4: '#4F655A',

  navBg: 'rgba(235,239,236,0.94)',
  overlay: 'rgba(20,33,25,0.45)',
  cardShadow: '0 2px 8px rgba(30,50,38,0.07)',
  cardShadowHover: '0 10px 28px rgba(30,50,38,0.14)',
  popShadow: '0 10px 28px rgba(30,50,38,0.18)',
  accentGlow: '0 4px 16px rgba(236,96,50,0.22)',
  accentGlowHover: '0 8px 24px rgba(236,96,50,0.30)',
  focusRing: 'rgba(236,96,50,0.28)',
  grain: "url('data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22140%22%20height=%22140%22%3E%3Cfilter%20id=%22n%22%3E%3CfeTurbulence%20type=%22fractalNoise%22%20baseFrequency=%22.85%22%20numOctaves=%222%22/%3E%3CfeColorMatrix%20type=%22saturate%22%20values=%220%22/%3E%3C/filter%3E%3Crect%20width=%22140%22%20height=%22140%22%20filter=%22url(%23n)%22%20opacity=%22.16%22/%3E%3C/svg%3E')",
  edgeHi: 'rgba(255,255,255,0.75)',
  frameShadow: '0 60px 140px rgba(30,50,38,0.24)',
  frameGlow: 'rgba(236,96,50,0.10)',
  mark: '#7A5C10',
  authShadow: '0 24px 80px rgba(30,50,38,.16)',
};

/**
 * Colours that do not change with the theme. Text on a photograph sits on a
 * dark scrim in both themes, so it is white in both; the celebration and the
 * plan's hero are their own dark grounds.
 */
export const FIXED = {
  onPhoto: '#FFFFFF',
  onPhotoSoft: 'rgba(255,255,255,0.88)',
  photoChip: 'rgba(255,255,255,0.16)',
  photoButton: 'rgba(0,0,0,0.5)',
  photoBlank: '#1A1A1A',
  shade0: 'rgba(0,0,0,0)',
  shade1: 'rgba(0,0,0,0.28)',
  shade2: 'rgba(0,0,0,0.6)',
  shade3: 'rgba(0,0,0,0.85)',
  sheen: 'rgba(255,255,255,0.32)',
  // The plan's hero runs from this to the accent.
  heroDeep: '#1A1060',
  // The booking celebration and the "all paid" card.
  celebrateDeep: '#064E3B',
  goldDeep: '#3B2F0B', goldMid: '#7C5A12',
  confettiPink: '#F472B6',
  // Status pills on a photograph.
  pillGood: 'rgba(16,185,129,0.30)', onPillGood: '#ECFDF5',
  pillWarn: 'rgba(245,158,11,0.32)', onPillWarn: '#FFFBEB',
  // The map of places you've been: its own dark ground in both themes.
  mapBg: '#0E1116', mapShade: 'rgba(14,17,22,0.45)', mapText: '#F2F2F2', mapMuted: '#B8C0C8',
  // The link-preview image's glow.
  ogGlow: '#4A1B20',
} as const;

export type TokenName = keyof typeof DARK | keyof typeof FIXED;

/** Both themes, each with the fixed tokens in it, as the app reads them. */
export const PALETTE = {
  light: { ...LIGHT, ...FIXED },
  dark: { ...DARK, ...FIXED },
} as const;

/** Identity colours for people without a photo. White initials sit on them. */
export const AVATAR_COLORS = ['#8C6D1F', '#9E4B57', '#3F7D63', '#8A5A2B', '#3D6389', '#6B4A80', '#A0563C', '#4A7A52'] as const;

/** Pins on the map of places (Leaflet draws them, so they are values, not variables). */
export const MAP_PIN = {
  upcoming: '#E2C35E', past: '#8E99A4',
  upcomingRing: '#FFF3C4', pastRing: '#C9D1D9',
} as const;

/** Google's mark on "Continue with Google": the brand's own colours, never ours. */
export const GOOGLE_MARK = { blue: '#4285F4', green: '#34A853', yellow: '#FBBC05', red: '#EA4335' } as const;

/** The surround outside the app frame, per theme (the HTML shell paints it before React). */
export const SHELL = { light: LIGHT.page, dark: DARK.page } as const;
/** The app surface behind the frame, per theme. Used for the browser chrome. */
export const SURFACE = { light: LIGHT.bg, dark: DARK.bg } as const;

/**
 * Paper: the warm palette of the legal pages, the 404 page and the shell
 * before the app paints. Its own look, measured by the same gate.
 */
export const PAPER = {
  light: { ink: '#241C10', muted: '#63553A', line: '#E5DCCA', link: '#8A6512' },
  dark: { ink: '#F3EBD9', muted: '#AC9C7E', line: '#332B1B', link: '#DDB259' },
} as const;

/**
 * Email. Mail clients cannot read CSS variables, so emails take these values
 * directly, on paper's light ground (most mail apps show a white page).
 */
export const EMAIL = {
  page: '#FFFFFF',
  ink: PAPER.light.ink, muted: '#635539', footer: '#7E6F52', line: PAPER.light.line, rowLine: '#EFE8DA',
  link: PAPER.light.link, cash: '#8A5A0B',
  button: DARK.accent, onButton: DARK.onAccent,
} as const;

/**
 * A page's own short variable names, written from the tokens for both themes:
 * scopedVars('.ob', { bg: 'bg', ac: 'accent' }) →
 *   .ob{--bg:#EBEFEC;--ac:#EC6032}:root[data-theme="dark"] .ob{--bg:#2C0E18;--ac:#C3A342}
 * so no page keeps a hand-copied palette that drifts.
 */
export function scopedVars(selector: string, names: Record<string, TokenName>): string {
  const block = (theme: 'light' | 'dark') =>
    Object.entries(names).map(([k, t]) => `--${k}:${(PALETTE[theme] as Record<string, string>)[t]}`).join(';');
  return `${selector}{${block('light')}}\n:root[data-theme="dark"] ${selector}{${block('dark')}}`;
}
