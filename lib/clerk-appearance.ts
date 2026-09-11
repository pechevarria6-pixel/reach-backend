// ─── Clerk widget theming ────────────────────────────────────────────────
// Sign-in and sign-up rendered Clerk's stock light-indigo widget on a cool
// #08080E page, while the app behind it is warm noir and gold. Signing in
// looked like a different product from the one you were signing in to.
import type { Appearance } from '@clerk/types';
import { BRAND } from '@/lib/brand';

export const authShell: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  // dvh so mobile browser chrome doesn't cut the widget off.
  minHeight: '100dvh',
  background: BRAND.page,
  padding: 20,
};

export const clerkAppearance: Appearance = {
  variables: {
    colorBackground: BRAND.bg,
    colorPrimary: BRAND.accent,
    // Clerk puts this on the gold button. White on gold is 2.2:1.
    colorTextOnPrimaryBackground: BRAND.onAccent,
    colorText: BRAND.t1,
    colorTextSecondary: BRAND.t2,
    colorInputBackground: BRAND.s2,
    colorInputText: BRAND.t1,
    colorDanger: '#F87171',
    colorSuccess: '#52C97B',
    colorWarning: '#F59E0B',
    borderRadius: '16px',
    fontFamily: "'Space Grotesk', system-ui, sans-serif",
  },
  elements: {
    rootBox: { width: '100%', maxWidth: 400 },
    card: {
      background: BRAND.bg,
      border: `1px solid ${BRAND.border}`,
      boxShadow: '0 24px 80px rgba(0,0,0,.6)',
    },
    headerTitle: { fontFamily: "'Instrument Serif', serif", fontWeight: 400 },
    formButtonPrimary: {
      background: `linear-gradient(135deg, ${BRAND.accentDeep}, ${BRAND.accent})`,
      color: BRAND.onAccent,
      fontWeight: 600,
      textTransform: 'none',
      minHeight: 48,
    },
    socialButtonsBlockButton: {
      background: BRAND.s2,
      border: `1px solid ${BRAND.border}`,
      color: BRAND.t1,
      minHeight: 48,
    },
    formFieldInput: { background: BRAND.s2, border: `1px solid ${BRAND.border}` },
    footerActionLink: { color: BRAND.accent },
    // Clerk's dev-instance badge is noise on a branded screen.
    logoBox: { display: 'none' },
  },
};
