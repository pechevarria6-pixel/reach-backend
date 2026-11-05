// Discover's two lists, read where they are drawn. Each test is a defect
// found by walking the screen on 2026-11-05 with real Raleigh data.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../components/reach-app.jsx', import.meta.url), 'utf8');

/** The source of a top-level function, up to the next one. */
function body(name: string): string {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is in reach-app.jsx`);
  const next = app.slice(start + 1).search(/\n(?:function |const [A-Z_]+=|\/\/ ───)/);
  return app.slice(start, next < 0 ? undefined : start + 1 + next);
}

test('a card says the listing\'s own when ("6-9 pm"), on dated and undated cards alike', () => {
  assert.match(body('expFromFinding'), /whenText:e\.whenText/);
  for (const card of ['DiscoverEventCard', 'DiscoverPlaceCard']) {
    const src = body(card);
    assert.match(src, /const when=exp\.whenText/, `${card} reads whenText`);
    assert.match(src, /const spoken=\[[^\]]*\bwhen\b/, `${card} says it to a screen reader too`);
    assert.match(src, /\{\(?when(?:\|\|visited\))?&&/, `${card} draws it`);
  }
});

test('the drip card is drawn once, outside the parts that remount on every pill tap', () => {
  const screen = body('DiscoverScreen');
  const ret = screen.slice(screen.lastIndexOf('\n  return('));
  assert.equal((screen.match(/\{dripCard\}/g) || []).length, 1, 'one place');
  assert.doesNotMatch(screen, /dripCard&&/, 'no second, conditional placement');
  // Every keyed fade wrapper, and what it holds, up to its closing tag.
  const keyed = [...ret.matchAll(/<div key=\{`\$\{segment\}\|\$\{activeFilter\}[^`]*`\} className="dsc-fade">([\s\S]*?)\n {10}<\/div>/g)];
  assert.ok(keyed.length >= 2, 'the list fades in two parts');
  for (const [, inner] of keyed) assert.doesNotMatch(inner, /dripCard|invite/);
  // And not inside what those parts are built from.
  for (const part of ['const daySection=', 'const listHead=', 'const listTail=']) {
    const at = screen.indexOf(part);
    assert.ok(at >= 0, part);
    const src = screen.slice(at, screen.indexOf('\n\n', at));
    assert.doesNotMatch(src, /dripCard/, part);
  }
});

test('the quiz invitation is not above the list, where it pushed the first card below the fold', () => {
  const screen = body('DiscoverScreen');
  const ret = screen.slice(screen.lastIndexOf('\n  return('));
  const head = ret.slice(0, ret.indexOf('role="tablist"'));
  assert.doesNotMatch(head, /push\("taste"\)|\{invite\}|Tell us what you're into/);
  assert.match(ret, /\{invite\}/, 'still offered, further down');
});

test('a photo credit\'s 44pt tap area is its own, never laid over the card above it', () => {
  const src = body('PhotoCredit');
  assert.doesNotMatch(src, /margin(?:Block|Top)?:\s*-|marginBlock:-/, 'no negative margin');
  assert.match(src, /minHeight:44/);
  assert.match(src, /marginTop:0/);
});

test('the pinned day header draws over every card\'s ⋯, open menus included', () => {
  const menu = Number(/const DISCOVER_MENU_Z=(\d+);/.exec(app)?.[1]);
  const day = Number(/const DISCOVER_DAY_Z=(\d+);/.exec(app)?.[1]);
  assert.ok(Number.isFinite(menu) && Number.isFinite(day));
  assert.ok(day > menu + 1, 'above the ⋯ and above an open menu');
  assert.match(body('DiscoverHide'), /zIndex:open\?DISCOVER_MENU_Z\+1:DISCOVER_MENU_Z/);
  assert.match(body('DiscoverScreen'), /position:"sticky",top:0,zIndex:DISCOVER_DAY_Z/);
});

// WCAG relative luminance of an sRGB channel value 0–1.
const lum = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

test('a place card\'s words on its photo are 4.5:1 over the palest pixel, from the first word down', () => {
  const top = Number(/const PLACE_SCRIM_TEXT_TOP=(\d+);/.exec(app)?.[1]);
  const scrim = /const PLACE_SCRIM="([^"]+)";/.exec(app)?.[1] ?? '';
  const stops = [...scrim.matchAll(/rgba\(0,0,0,([\d.]+)\)\s+([\d.]+)(px|%)/g)].map(m => ({ a: Number(m[1]), at: Number(m[2]), unit: m[3] }));
  assert.ok(top > 0 && stops.length >= 2, 'the scrim and where the words start are both named');
  // Every px stop at or after the first word, and every % stop (which lands
  // below it whatever the block's height), is at least the alpha it reaches
  // before the words start — and the gradient only darkens downwards.
  const before = stops.filter(s => s.unit === 'px' && s.at <= top);
  assert.ok(before.length > 0, 'it is dark before the first word');
  const atText = Math.max(...before.map(s => s.a));
  for (let i = 1; i < stops.length; i++) assert.ok(stops[i].a >= stops[i - 1].a, 'darkens downwards');
  // White and the soft .88 white over a pure white pixel shaded by atText.
  const shaded = lum(1 - atText);
  assert.ok(ratio(1, shaded) >= 4.5, `white ${ratio(1, shaded).toFixed(2)}:1`);
  const soft = lum(0.88 + 0.12 * (1 - atText));
  assert.ok(ratio(soft, shaded) >= 4.5, `soft white ${ratio(soft, shaded).toFixed(2)}:1`);
  const card = body('DiscoverPlaceCard');
  assert.match(card, /padding:`\$\{PLACE_SCRIM_TEXT_TOP\}px/);
  assert.match(card, /background:ok\?PLACE_SCRIM/);
});

test('the drip card on Discover speaks its options\' words, not their emoji\'s names', () => {
  for (const name of ['DripCard', 'UpgradeCard']) {
    const src = body(name);
    const shown = [...src.matchAll(/<span([^>]*)>\{o\.e\}<\/span>|\{o\.e\}/g)];
    assert.ok(shown.length > 0, name);
    for (const m of shown) assert.match(m[0], /aria-hidden="true"/, `${name}: ${m[0]}`);
  }
});
