// The map's own tag values never reach a card as raw lowercase data.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindWord, withKindWord } from '../../lib/discovery/kind-word.ts';

test('a map tag becomes the word a person would use', () => {
  assert.equal(kindWord('marketplace'), 'Market');
  assert.equal(kindWord('museum'), 'Museum');
  assert.equal(kindWord('arts_centre'), 'Arts centre');
  assert.equal(kindWord('arts centre'), 'Arts centre');
});

test('a kind nobody listed is still said, capitalised, never dropped', () => {
  assert.equal(kindWord('ice_rink'), 'Ice rink');
});

test('nothing held is nothing said', () => {
  assert.equal(kindWord(null), null);
  assert.equal(kindWord(''), null);
  assert.equal(kindWord('yes'), null);
});

test('the source line keeps everything but the spelling of its tag', () => {
  assert.equal(withKindWord('marketplace · 1201 Agricultural Street', 'marketplace'), 'Market · 1201 Agricultural Street');
  assert.equal(withKindWord('arts centre · Main St', 'arts_centre'), 'Arts centre · Main St');
  assert.equal(withKindWord('Fri, Nov 6 · Red Hat Amphitheater', null), 'Fri, Nov 6 · Red Hat Amphitheater');
});
