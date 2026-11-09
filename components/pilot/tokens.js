// The app's colour tokens, as components/reach-app.jsx names them: every
// name is a CSS custom property set on <html> by the app shell, so these
// screens repaint with the theme exactly as the rest of the app does and
// never carry a hex value of their own. Kept to the names the pilot screens
// use; add one here only if reach-app.jsx's TOKENS already has it.
const NAMES = [
  "bg", "s1", "s2", "s3", "border", "borderLight",
  "accent", "accentDim", "accentBorder", "accentText", "onAccent",
  "t1", "t2", "t3", "red", "overlay", "focusRing",
];

export const C = Object.fromEntries(
  NAMES.map(t => [t, `var(--c-${t.replace(/[A-Z]/g, m => "-" + m.toLowerCase())})`]),
);

/** 44px is the smallest tap target any pilot screen offers (UX audit §1.9). */
export const TAP = 44;
