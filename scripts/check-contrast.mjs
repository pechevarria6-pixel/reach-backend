// ─── check:contrast ───────────────────────────────────────────────────────
// Reads every place the app paints text on a background in the same inline
// style object, resolves both tokens in the light and dark palettes, and
// reports any pairing a person cannot comfortably read.
//
// This exists because five checkout buttons shipped painting their label with
// `C.page` on `C.accent` — cream on gold in light theme, a contrast ratio of
// about 1.6, effectively invisible. A palette audit had passed, because it
// checked the pairings somebody thought to list rather than the pairings the
// app actually uses.
import fs from 'node:fs';

const FILE = 'components/reach-app.jsx';
const src = fs.readFileSync(FILE, 'utf8');

// ── Pull the two palettes straight out of the file, so this can never drift
// from what ships.
function paletteAfter(label) {
  const at = src.indexOf(label);
  if (at < 0) throw new Error(`palette ${label} not found in ${FILE}`);
  const out = {};
  // Read forward to the closing brace of this palette block.
  const chunk = src.slice(at, src.indexOf('\n  }', at));
  for (const m of chunk.matchAll(/(\w+)\s*:\s*"(#[0-9A-Fa-f]{3,8})"/g)) out[m[1]] = m[2];
  return out;
}
const THEMES = { light: paletteAfter('light: {'), dark: paletteAfter('dark: {') };

const toRgb = (hex) => {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
};
const luminance = (hex) => {
  const [r, g, b] = toRgb(hex).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// ── Every `background:C.x` paired with a `color:C.y` in the same style object.
// Style objects are `{{ ... }}`; scan each one.
const pairs = [];
for (const m of src.matchAll(/style=\{\{([^}]*(?:\}[^}]*)??)\}\}/g)) {
  const body = m[1];
  const bg = body.match(/background(?:Color)?\s*:\s*C\.(\w+)/);
  const fg = body.match(/(?<!background)color\s*:\s*C\.(\w+)/);
  if (!bg || !fg) continue;
  const line = src.slice(0, m.index).split('\n').length;
  pairs.push({ line, bg: bg[1], fg: fg[1] });
}

// Below this a person is straining. WCAG AA for normal text is 4.5; buttons
// and labels in this app are large and semi-bold, so 3.0 is the floor and
// anything under it is a genuine failure rather than a preference.
const FLOOR = 3.0;
const bad = [];
for (const p of pairs) {
  for (const [theme, palette] of Object.entries(THEMES)) {
    const bg = palette[p.bg], fg = palette[p.fg];
    if (!bg || !fg) continue;              // gradients, rgba, tokens not in the palette
    const r = ratio(bg, fg);
    if (r < FLOOR) bad.push({ ...p, theme, r: r.toFixed(2), bgHex: bg, fgHex: fg });
  }
}

if (!bad.length) {
  console.log(`  ✓ all ${pairs.length} text-on-background pairings are readable in both themes`);
  process.exit(0);
}
console.log('  ✗ text nobody can read:');
for (const b of bad) {
  console.log(`    ${FILE}:${b.line}  ${b.theme}: C.${b.fg} ${b.fgHex} on C.${b.bg} ${b.bgHex} — ratio ${b.r}, needs ${FLOOR}`);
}
process.exit(1);
