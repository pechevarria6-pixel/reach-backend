import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimsIn, needsSource } from '../../lib/discovery/claims.ts';
import { tipFor } from '../../lib/discovery/verify.ts';

const MOAB = new Set(['moab']);

// Every string in this file is a real generated tip from the Moab itinerary.

test('a claim about what a business charges needs a source', () => {
  assert.ok(needsSource('Milt’s is cash-only and has no ATM inside — grab cash at the bank on Main.', MOAB));
  assert.ok(needsSource('Woody’s charges a cover only after 9pm on weekends.', MOAB));
});

test('a claim about when a business opens needs a source', () => {
  assert.ok(needsSource('Antica Forma’s bar seats fill fast after 6pm — go right at open (5pm).', MOAB));
});

test('a claim about what a business will do for you needs a source', () => {
  assert.ok(needsSource('MARC will fire and hold your glazed pottery — they’ll ship it for a small fee.', MOAB));
});

test('a claim about a business’s own rooms needs a source', () => {
  // Nobody at Reach has been inside Tamarisk. This one carries no money
  // words and no times at all, which is why the named-entity signal exists.
  assert.ok(needsSource('Tamarisk’s patio tables all face the river but the counter inside gets the same view.', MOAB));
});

test('advice about weather, terrain and crowds is not a claim on anybody', () => {
  // These stay. Being wrong about the heat costs an hour; being wrong about
  // Milt's costs the meal. Stripping these would make the product plainer
  // for no gain in honesty.
  assert.equal(needsSource('Corona Arch gets brutally hot by 11am in summer — start before 8am and bring more water.', MOAB), false);
  assert.equal(needsSource('Mesa Arch at sunrise means a crowd of photographers shoulder to shoulder — arrive 20 minutes before the posted sunrise time.', MOAB), false);
});

test('a bare clock time is not an opening time', () => {
  // `before \d+(am|pm)` matched "start before 8am" in the Corona Arch tip
  // and stripped advice about desert heat as though it were a business's
  // hours. The times that matter arrive attached to a policy.
  assert.deepEqual(claimsIn('start before 8am and bring more water than you think you need'), []);
});

test('the town’s own name, possessive and incidental, is not a business', () => {
  // "before you leave Moab's wifi range" is a sentence about cell signal in
  // the desert. Reading it as a claim about a business cost a useful tip.
  assert.equal(
    needsSource('Goblin Valley has almost no cell signal — screenshot your park map before you leave Moab’s wifi range.', MOAB),
    false,
  );
  assert.ok(
    needsSource('Goblin Valley has almost no cell signal — screenshot your park map before you leave Moab’s wifi range.'),
    'without the town in the ignore set it reads as named — that is what the set is for',
  );
});

test('the kinds are reported so the call can be reviewed', () => {
  const kinds = claimsIn('Woody’s charges a cover only after 9pm on weekends.', MOAB).map(c => c.kind);
  assert.ok(kinds.includes('money'));
  assert.ok(kinds.includes('named'));
});

// ─── What the item ends up showing ──────────────────────────────────────

const ADVICE = {
  name: "Pasta Jay's", kind: 'restaurant', address: null, phone: null, url: null,
  hours: null, price: null, lat: null, lng: null,
  note: 'Order the Tortellone Alfredo.',
  credit: { source: 'wikivoyage' as const, page: 'Moab', url: 'https://en.wikivoyage.org/wiki/Moab' },
};

test('advice is left exactly as written', () => {
  const tip = tipFor('Corona Arch gets brutally hot by 11am in summer.', null, MOAB);
  assert.equal(tip.subtitle, 'Corona Arch gets brutally hot by 11am in summer.');
  assert.equal(tip.unverified, null);
});

test('a claim is set aside and a traveller’s words take its place', () => {
  const tip = tipFor('Milt’s is cash-only and has no ATM inside.', ADVICE, MOAB);
  assert.match(tip.subtitle as string, /Pasta Jay.s: Order the Tortellone/);
  assert.equal(tip.unverified, 'Milt’s is cash-only and has no ATM inside.');
  assert.match(tip.claims as string, /money/);
});

test('a claim with nobody to replace it leaves the item saying nothing', () => {
  // The plainer screen, and the honest one.
  const tip = tipFor('Milt’s is cash-only and has no ATM inside.', null, MOAB);
  assert.equal(tip.subtitle, null);
  assert.equal(tip.unverified, 'Milt’s is cash-only and has no ATM inside.');
});

test('an item with no tip gains one when a traveller has written about it', () => {
  const tip = tipFor(null, ADVICE, MOAB);
  assert.match(tip.subtitle as string, /Tortellone/);
  assert.equal(tip.unverified, null);
});

test('hours stated with no clock time are still hours', () => {
  // Plan f979c880, Day 2 · Evening, over MXDC: nobody had checked.
  const line = 'Dinner at MXDC Cocina Mexicana, a table for one is easy here and the Saturday hours run late enough not to rush.';
  assert.deepEqual(claimsIn(line).map(c => c.kind), ['hours']);
  assert.ok(needsSource('The bar stays open late on Fridays.'));
  assert.ok(needsSource('It is open late, so there is no rush.'));
  // Advice about the day is still not a claim about a business.
  assert.ok(!needsSource('October evenings cool quickly once the sun drops.'));
});

test('setting a tip aside is never destroying it', () => {
  const original = 'Woody’s charges a cover only after 9pm on weekends.';
  const tip = tipFor(original, null, MOAB);
  assert.equal(tip.unverified, original);
});
