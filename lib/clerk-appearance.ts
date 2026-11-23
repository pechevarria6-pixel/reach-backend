// ─── Clerk widget theming ────────────────────────────────────────────────
// Sign-in and sign-up rendered Clerk's stock light-indigo widget on a cool
// #08080E page, while the app behind it is warm noir and gold. Signing in
// looked like a different product from the one you were signing in to.
//
// When the app gained a light theme — and made it the default — these two
// screens were left on the fixed dark palette, so everyone arriving at
// sign-up met a near-black page in front of a cream app. There is now one
// appearance per theme, and the page takes the theme-aware surround the
// layout already defines.
import type { Appearance } from '@clerk/types';
import { BRAND } from '@/lib/brand';
import { PALETTE } from './tokens.ts';

export const authShell: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  // dvh so mobile browser chrome doesn't cut the widget off.
  minHeight: '100dvh',
  // Set per theme in app/layout.tsx, before first paint.
  background: 'var(--shell-page)',
  padding: 20,
};

type AuthColours = {
  bg: string; s2: string; border: string;
  accent: string; accentDeep: string; accentText: string; onAccent: string;
  t1: string; t2: string;
  danger: string; success: string; warning: string;
  shadow: string;
};

// The same values the app uses for its light theme (PALETTE.light in
// components/reach-app.jsx): gold stays the button fill, and links use the
// deepened gold, because gold text on cream is 2.0:1.
const fromTheme = (t: 'light' | 'dark'): AuthColours => {
  const p = PALETTE[t];
  return {
    bg: p.bg, s2: p.s2, border: p.border,
    accent: p.accent, accentDeep: p.accentDeep, accentText: p.accentText, onAccent: p.onAccent,
    t1: p.t1, t2: p.t2,
    danger: p.red, success: p.green, warning: p.amber,
    shadow: p.authShadow,
  };
};
const LIGHT = fromTheme('light');
const DARK = fromTheme('dark');

const appearance = (c: AuthColours): Appearance => ({
  variables: {
    colorBackground: c.bg,
    colorPrimary: c.accent,
    // Clerk puts this on the gold button. White on gold is 2.2:1.
    colorTextOnPrimaryBackground: c.onAccent,
    colorText: c.t1,
    colorTextSecondary: c.t2,
    colorInputBackground: c.s2,
    colorInputText: c.t1,
    colorDanger: c.danger,
    colorSuccess: c.success,
    colorWarning: c.warning,
    borderRadius: '16px',
    fontFamily: 'var(--font-body)',
  },
  elements: {
    rootBox: { width: '100%', maxWidth: 400 },
    card: {
      background: c.bg,
      border: `1px solid ${c.border}`,
      boxShadow: c.shadow,
    },
    headerTitle: { fontFamily: 'var(--font-display)', fontWeight: 400 },
    formButtonPrimary: {
      background: `linear-gradient(135deg, ${c.accentDeep}, ${c.accent})`,
      color: c.onAccent,
      fontWeight: 600,
      textTransform: 'none',
      minHeight: 48,
    },
    socialButtonsBlockButton: {
      background: c.s2,
      border: `1px solid ${c.border}`,
      color: c.t1,
      minHeight: 48,
    },
    formFieldInput: { background: c.s2, border: `1px solid ${c.border}`, minHeight: 44 },
    footerActionLink: { color: c.accentText, display: 'inline-flex', alignItems: 'center', minHeight: 44 },
    formFieldInputShowPasswordButton: { minWidth: 44, minHeight: 44 },
    // Clerk's dev-instance badge is noise on a branded screen.
    logoBox: { display: 'none' },
  },
});

export const clerkAppearance = { light: appearance(LIGHT), dark: appearance(DARK) } as const;
