import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archetypeFor } from '../../lib/playbooks.ts';

test('an evening is a night out; a gig is a concert', () => {
  assert.equal(archetypeFor({ night: true, solo: false, goal: 'Night out with my buddy for his birthday' }), 'night_out');
  assert.equal(archetypeFor({ night: true, solo: false, planType: 'concert', goal: 'The Milk Carton Kids in DC' }), 'festival_concert');
});
test('what the trip is for decides the rest', () => {
  assert.equal(archetypeFor({ night: false, solo: false, goal: "Sarah's bachelorette in Nashville" }), 'bachelor_party');
  assert.equal(archetypeFor({ night: false, solo: false, tripTypes: 'beach' }), 'beach_weekend');
  assert.equal(archetypeFor({ night: false, solo: false, goal: 'hiking in Moab' }), 'outdoors_adventure');
  assert.equal(archetypeFor({ night: false, solo: true, goal: 'a few days to reset' }), 'solo_reset');
});
test('nothing said, no playbook', () => {
  assert.equal(archetypeFor({ night: false, solo: false, goal: 'Puerto Vallarta, Mexico' }), null);
});
