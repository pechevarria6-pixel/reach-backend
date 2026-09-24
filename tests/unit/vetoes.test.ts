import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vetoBreach, withoutVetoed } from '../../lib/vetoes.ts';

test('the quiz vetoes that can be read from words are read', () => {
  assert.equal(vetoBreach('Sunrise hike up Delicate Arch', ['hiking']), 'hiking');
  assert.equal(vetoBreach('Night at the campground by the river', ['camping']), 'camping');
  assert.equal(vetoBreach('Dancing at a nightclub on Glenwood', ['clubs']), 'clubs');
  assert.equal(vetoBreach('Catch the sunrise at the pier', ['earlyMornings']), 'earlyMornings');
});

test('a jazz club or a comedy club is not a nightclub', () => {
  assert.equal(vetoBreach('Late set at the jazz club', ['clubs']), null);
  assert.equal(vetoBreach('Comedy club on Hargett Street', ['clubs']), null);
});

test('vetoes about the place, not the words, are not claimed', () => {
  assert.equal(vetoBreach('A long flight to Tokyo', ['longFlights']), null);
  assert.equal(vetoBreach('Busy market', ['big crowds']), null);
});

test('a typed veto matches whole words, and a sentence is left to the prompt', () => {
  assert.equal(vetoBreach('Karaoke at Ruby Deluxe', ['custom:karaoke']), 'karaoke');
  assert.equal(vetoBreach('Seafood platter at the harbour', ['seafood']), 'seafood');
  assert.equal(vetoBreach('Sea views from the deck', ['seafood']), null);
  assert.equal(vetoBreach('Anything at all with a crowd', ['nothing that feels like a tourist trap please']), null);
});

test('a vetoed line goes, the rest of the day stays', () => {
  const { day, dropped } = withoutVetoed({
    morning: { plan: 'Sunrise hike on the Fiery Furnace trail', venue: null },
    afternoon: { plan: 'Lunch at Moab Brewery', venue: 'Moab Brewery' },
    evening: 'Stargazing from the hotel',
    daytime: [{ plan: 'Trek to the arch', venue: null }, { plan: 'Museum of Moab', venue: 'Museum of Moab' }],
  }, ['hiking']);
  assert.equal((day.morning as { plan: string }).plan, '');
  assert.equal((day.afternoon as { plan: string }).plan, 'Lunch at Moab Brewery');
  assert.equal(day.evening, 'Stargazing from the hotel');
  assert.deepEqual(day.daytime?.map(s => (s as { plan: string }).plan), ['Museum of Moab']);
  assert.equal(dropped.length, 2);
});

test('a mention that says no keeps the veto rather than breaking it', () => {
  assert.equal(vetoBreach('Easy strolls, no hiking needed', ['hiking']), null);
  assert.equal(vetoBreach('Skip the clubs — a quiet wine bar instead', ['clubs']), null);
  assert.equal(vetoBreach('No hiking, but a sunrise hike is optional', ['hiking']), 'hiking');
});

test('a trip idea built on a vetoed thing is caught, one that avoids it is not', async () => {
  const { tripBreach } = await import('../../lib/vetoes.ts');
  const base = { tagline: 'Red rock and big skies', vibe: 'Slow mornings', why_this_group: '', food_scene: '', music_scene: '' };
  assert.equal(tripBreach({ ...base, costs: { accommodation: { example: 'Riverside campground in Moab' } } }, ['camping']), 'camping');
  assert.equal(tripBreach({ ...base, vibe: 'Scenic drives, no hiking required' }, ['hiking']), null);
  assert.equal(tripBreach({ ...base, vibe: 'Three days of hiking in the Arches' }, ['hiking']), 'hiking');
  assert.equal(tripBreach(base, []), null);
});
