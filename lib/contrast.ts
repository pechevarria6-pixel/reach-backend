// ─── WCAG contrast ───────────────────────────────────────────────────────
// REACH-ACCESSIBILITY-PALETTE-2026-11-22, Task 2. The formula the contrast
// gate (tests/unit/contrast-gate.test.ts) and check:contrast both use.

/** Relative luminance of a #RRGGBB colour. */
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio between two #RRGGBB colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 2.1 AA: 4.5 for text, 3 for large text and for the edge of a control. */
export const TARGET = { text: 4.5, large: 3, edge: 3 } as const;
