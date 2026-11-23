// Run with: npm run test:unit
// REACH-ACCESSIBILITY-PALETTE-2026-11-22, Task 2: the contrast gate.
//
// Every text colour on every surface it can sit on, every label on its fill
// (both ends of a gradient), and every control edge on its surface, in both
// themes, against its WCAG target. The build fails when one drops below.
// A token that is in no pair and not in NOT_PAIRED fails too, so a new colour
// cannot arrive without saying what it is read against.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrast, TARGET } from '../../lib/contrast.ts';
import { PALETTE, FIXED, AVATAR_COLORS, PAPER, EMAIL } from '../../lib/tokens.ts';

type Theme = 'light' | 'dark';
interface Pair { theme: Theme; fg: string; bg: string; min: number; why: string }

const SURFACES = ['bg', 's1', 's2', 's3'] as const;
const TEXT = ['t1', 't2', 't3', 't4', 'accentText', 'green', 'amber', 'red', 'blue'] as const;

const PAIRS: Pair[] = [];
for (const theme of ['light', 'dark'] as Theme[]) {
  for (const fg of TEXT) for (const bg of SURFACES) PAIRS.push({ theme, fg, bg, min: TARGET.text, why: 'text on a surface' });
  for (const bg of SURFACES) PAIRS.push({ theme, fg: 'accentWord', bg, min: TARGET.large, why: 'the accent word in a display heading' });
  for (const fg of ['t1', 't2', 't3'] as const) PAIRS.push({ theme, fg, bg: 'page', min: TARGET.text, why: 'text on the page outside the frame (landing)' });
  for (const [fg, bg] of [['onAccent', 'accent'], ['onAccent', 'accentDeep'], ['onAccent', 'accentHover'], ['onGreen', 'green'], ['onRed', 'red']] as const) {
    PAIRS.push({ theme, fg, bg, min: TARGET.text, why: 'a label on its fill, each end of the gradient' });
  }
  // Controls and cards sit on the page, a sheet or a card; s3 is itself a
  // control's fill, so its edge is read against the card around it.
  for (const bg of ['bg', 's1', 's2'] as const) PAIRS.push({ theme, fg: 'border', bg, min: TARGET.edge, why: 'the edge of a control or card' });
  for (const bg of ['bg', 's1', 's2'] as const) PAIRS.push({ theme, fg: 'accentText', bg, min: TARGET.edge, why: 'the focus ring' });
  PAIRS.push({ theme, fg: 'mark', bg: 'page', min: TARGET.edge, why: 'the landing mark, a graphic' });
  // Fixed grounds: the same in both themes.
  for (const bg of ['heroDeep', 'heroEnd', 'celebrateDeep', 'celebrateEnd', 'goldDeep', 'goldMid', 'photoBlank'] as const) PAIRS.push({ theme, fg: 'onPhoto', bg, min: TARGET.text, why: 'white on a dark ground of its own' });
  PAIRS.push({ theme, fg: 'mapText', bg: 'mapBg', min: TARGET.text, why: 'the map\'s empty state' });
  PAIRS.push({ theme, fg: 'mapMuted', bg: 'mapBg', min: TARGET.text, why: 'the map\'s empty state' });
}

/**
 * Tokens read against no single colour, each with its reason. What sits on a
 * photograph or a gradient is outside a two-colour formula; Task 5 checks
 * those by eye on the rendered screens.
 */
const NOT_PAIRED: Record<string, string> = {
  borderLight: 'a divider inside a list, not a control edge (owner-approved split)',
  accentDim: 'a tint behind text; the text is read against the surface under it',
  accentBorder: 'the edge of a tinted, non-interactive panel',
  greenDim: 'a tint', amberDim: 'a tint', redDim: 'a tint', blueDim: 'a tint',
  navBg: 'translucent; the nav reads as bg', overlay: 'a dimmer behind a sheet',
  cardShadow: 'a shadow', cardShadowHover: 'a shadow', popShadow: 'a shadow', authShadow: 'a shadow',
  accentGlow: 'a glow', accentGlowHover: 'a glow', frameShadow: 'a shadow', frameGlow: 'a glow',
  focusRing: 'a soft halo; the ring itself is accentText', grain: 'a texture', edgeHi: 'a highlight',
  page: 'a surface (paired as a background)',
  onPhotoSoft: 'text on a photograph, over a scrim: checked by eye (Task 5)',
  photoChip: 'a chip on a photograph', photoButton: 'a button on a photograph, white icon on a dark disc',
  shade0: 'a scrim stop', shade1: 'a scrim stop', shade2: 'a scrim stop', shade3: 'a scrim stop',
  sheen: 'a highlight on a button', confettiPink: 'a confetti piece, decorative',
  pillGood: 'a pill on a photograph: checked by eye (Task 5)', onPillGood: 'see pillGood',
  pillWarn: 'a pill on a photograph: checked by eye (Task 5)', onPillWarn: 'see pillWarn',
  mapShade: 'a dimmer over map tiles', ogGlow: 'the link-preview image\'s glow',
};

const value = (theme: Theme, name: string): string => {
  const v = (PALETTE[theme] as Record<string, string>)[name];
  assert.ok(typeof v === 'string', `${theme}.${name} is not a token`);
  return v;
};

test('every declared pair meets its target, in both themes', () => {
  const failing = PAIRS
    .map(p => ({ ...p, r: contrast(value(p.theme, p.fg), value(p.theme, p.bg)) }))
    .filter(p => p.r < p.min)
    .map(p => `${p.theme}: ${p.fg} ${value(p.theme, p.fg)} on ${p.bg} ${value(p.theme, p.bg)} = ${p.r.toFixed(2)}, needs ${p.min} (${p.why})`);
  assert.deepEqual(failing, []);
});

test('every token is in a pair or says why it is not', () => {
  const used = new Set(PAIRS.flatMap(p => [p.fg, p.bg]));
  const names = new Set([...Object.keys(PALETTE.dark), ...Object.keys(PALETTE.light), ...Object.keys(FIXED)]);
  const orphans = [...names].filter(n => !used.has(n) && !(n in NOT_PAIRED));
  assert.deepEqual(orphans, [], 'a token with no pair: add its pairs above, or a reason to NOT_PAIRED');
  const stale = Object.keys(NOT_PAIRED).filter(n => !names.has(n));
  assert.deepEqual(stale, [], 'NOT_PAIRED names a token that no longer exists');
});

test('both themes name the same tokens', () => {
  assert.deepEqual(Object.keys(PALETTE.light).sort(), Object.keys(PALETTE.dark).sort());
});

test('white initials are readable on every avatar colour', () => {
  for (const c of AVATAR_COLORS) assert.ok(contrast('#FFFFFF', c) >= TARGET.text, `${c}: ${contrast('#FFFFFF', c).toFixed(2)}`);
});

test('paper (legal, 404) and email text meet the text target', () => {
  for (const theme of ['light', 'dark'] as Theme[]) {
    for (const k of ['ink', 'muted', 'link'] as const) {
      const r = contrast(PAPER[theme][k], PALETTE[theme].bg);
      assert.ok(r >= TARGET.text, `paper ${theme} ${k}: ${r.toFixed(2)}`);
    }
  }
  for (const k of ['ink', 'muted', 'footer', 'link', 'cash'] as const) {
    const r = contrast(EMAIL[k], EMAIL.page);
    assert.ok(r >= TARGET.text, `email ${k}: ${r.toFixed(2)}`);
  }
  assert.ok(contrast(EMAIL.onButton, EMAIL.button) >= TARGET.text);
});

test('the formula agrees with WCAG\'s own reference points', () => {
  assert.equal(contrast('#000000', '#FFFFFF').toFixed(1), '21.0');
  assert.equal(contrast('#777777', '#FFFFFF').toFixed(2), '4.48');
  assert.equal(contrast('#ABCDEF', '#ABCDEF'), 1);
});
