import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillerClaim, isFiller } from '../../lib/filler.ts';

// Both verbatim from the itinerary_items table, both in the "main event"
// slot of a night out, where the gig should be.
const REAL = [
  'This is the slot for the thing Peter already has in mind for the evening',
  'Leave this window open — this is the slot for the thing you already know you want to do',
];

test('the two lines that shipped are caught', () => {
  for (const line of REAL) assert.ok(isFiller(line), `not caught: ${line}`);
});

test('the classics are still caught', () => {
  for (const line of ['TBD', 'placeholder', 'N/A', 'Activity', 'To be confirmed']) {
    assert.ok(isFiller(line), `not caught: ${line}`);
  }
});

test('a real evening is left completely alone', () => {
  for (const line of [
    'See The Milk Carton Kids live at 9:30 Club',
    'Start with an early dinner at Oyamel before heading to the show',
    'Wind down with a beer at Red Bear Brewing after the set',
    'Birthday dinner for Peter at Vic\'s Italian Restaurant',
    // "open" and "window" in ordinary use are not the form talking.
    'Grab a window seat at Kokoro and watch the street',
    'The kitchen is open late, so there is no rush',
  ]) {
    assert.equal(isFiller(line), false, `false positive: ${line}`);
  }
});

test('the phrase is reported, so a log says what was wrong', () => {
  assert.match(fillerClaim(REAL[0]) ?? '', /this is the slot for/i);
});

test('nothing in, nothing claimed', () => {
  assert.equal(fillerClaim(''), null);
  assert.equal(fillerClaim(null), null);
  assert.equal(isFiller(undefined), false);
});

import { corruptionAt, beforeCorruption } from '../../lib/filler.ts';
// Verbatim from itinerary_items subtitles.
test('the two broken subtitles in the table are caught', () => {
  assert.ok(corruptionAt("Park by the river before dinner.a the CCAroundRaleigh at your own pace.\n p22") >= 0);
  assert.ok(corruptionAt("Easier once you've parked near the pub.morplinsert1") >= 0);
});
test('ordinary text is not', () => {
  for (const ok of [
    'Book ahead at trophybrewing.com, e.g. for Friday nights.',
    'Doors at 7 p.m. — the show starts at 8pm sharp.',
    'Grab a table at St. Roch Fine Oysters before the gig.',
    "Dinner at Vic's Italian, then dessert on the walk back.",
  ]) assert.equal(corruptionAt(ok), -1, ok);
});
test('a line is cut back to its last whole sentence, or dropped', () => {
  assert.equal(beforeCorruption('Walk the greenway at sunset. The light is best then. Park near the pub.morplinsert1'),
    'Walk the greenway at sunset. The light is best then.');
  assert.equal(beforeCorruption('near the pub.morplinsert1'), null);
});
