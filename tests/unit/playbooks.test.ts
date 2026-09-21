// Run with: npm run test:unit
//
// The rule these exist to hold: what the background job writes down about a
// kind of trip is craft, never facts, and it may not name anybody's
// business. What is stored is read into every trip of that kind, so an
// invented restaurant here is not one bad itinerary — it is six months of
// them, in Reach's own voice, for everybody.

// The daily spend cap counts what was done "today", and "today" is the
// person's own day rather than Greenwich's. Pinned here so the eight-in-the
// -evening case is a real one rather than whatever the machine running the
// tests happens to be set to.
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PlaybookSchema, PLAYBOOK_JSON_SCHEMA, researchPrompt, nameCorrection,
  namedThings, stringsIn, expiresAt, startOfLocalDay, positiveInt, saidAloud,
} from '../../lib/playbooks.ts';

// ─── The two schemas have to agree ──────────────────────────────────────
// One constrains what the model writes, the other validates what comes
// back. They are written by hand, so the real risk is that one gains a
// field and the other does not — every answer then fails validation and no
// row is ever filled in.

function jsonSchemaKeys(node: any): string[] {
  return Object.keys(node.properties ?? {}).sort();
}

test('the wire schema and the zod schema describe the same fields', () => {
  assert.deepEqual(
    jsonSchemaKeys(PLAYBOOK_JSON_SCHEMA),
    Object.keys((PlaybookSchema as any).shape).sort(),
  );
});

test('every field is required on the wire', () => {
  // zod treats all of them as required, so an optional field on the wire
  // would come back missing and fail validation.
  assert.deepEqual(
    [...(PLAYBOOK_JSON_SCHEMA as any).required].sort(),
    jsonSchemaKeys(PLAYBOOK_JSON_SCHEMA),
  );
});

test('no array asks for more than one item, which the API rejects outright', () => {
  // `minItems: 3` is not a thinner answer, it is a 400 on every single
  // call. Trip generation was down for exactly this.
  const found: number[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.minItems === 'number') found.push(node.minItems);
    for (const v of Object.values(node)) walk(v);
  };
  walk(PLAYBOOK_JSON_SCHEMA);
  assert.deepEqual(found.filter(n => n > 1), []);
});

// ─── The shape that gets stored ─────────────────────────────────────────

const GOOD = {
  archetype: 'ski_trip',
  what_success_feels_like: 'everyone gets the day they wanted and nobody is waiting on anybody',
  ideal_group_size: '4 to 8',
  ideal_length_days: { min: 3, max: 5 },
  rhythm: [
    { phase: 'arrival', guidance: 'keep the first night loose and close to where you sleep' },
    { phase: 'peak', guidance: 'the one big day goes in the middle, never on the last morning' },
  ],
  must_haves: ['one meal the whole group eats together', 'a slow morning somewhere in the middle'],
  common_mistakes: ['booking the hardest day first', 'splitting the group by ability without saying so'],
  budget_allocation_hint: { stay: 0.45, food: 0.2, activities: 0.25, transport: 0.1 },
  per_person_budget_bands_usd: { saver: 600, fair: 1100, stretch: 2000 },
  conflict_points: ['how early the first lift is', 'whether the last night is a big one'],
  great_examples: [{ outline: 'four nights, one travel day either end, one rest day in the middle' }],
};

test('a well-formed answer validates', () => {
  assert.equal(PlaybookSchema.safeParse(GOOD).success, true);
});

test('an answer with no pacing in it is not stored', () => {
  // The pacing and the mistakes are the two fields worth the call. An
  // answer without them validates as a shape and is worth nothing.
  const thin = { ...GOOD, rhythm: [] };
  assert.equal(PlaybookSchema.safeParse(thin).success, false);
});

test('a phase nobody planned for is refused', () => {
  const odd = { ...GOOD, rhythm: [{ phase: 'whenever', guidance: 'play it by ear' }] };
  assert.equal(PlaybookSchema.safeParse(odd).success, false);
});

// ─── Names, which is the whole point ────────────────────────────────────

test('an invented restaurant is caught', () => {
  // This class of bug shipped: a generated Moab day was built around "El
  // Charro Loco", which does not exist. Stored here it would be repeated to
  // every group taking that kind of trip.
  const named = namedThings({ ...GOOD, must_haves: ['book dinner at El Charro Loco on the first night'] });
  assert.ok(named.includes('El Charro Loco'), `expected the restaurant, got ${JSON.stringify(named)}`);
});

test('a one-word brand is caught too', () => {
  // properNames finds runs of two or more capitalised words, so a one-word
  // brand is a run of one and goes straight through it. Mid-sentence
  // capitals in prose that was told to stay lower case are names.
  const named = namedThings({ ...GOOD, common_mistakes: ['splitting the cost of an Airbnb unevenly'] });
  assert.ok(named.includes('Airbnb'), `expected the brand, got ${JSON.stringify(named)}`);
});

test('a name buried deep in the answer is still found', () => {
  // The check walks the whole object. A name in the third field of the
  // second element of an array is exactly where one would hide.
  const named = namedThings({
    ...GOOD,
    rhythm: [
      { phase: 'arrival', guidance: 'keep it loose' },
      { phase: 'peak', guidance: 'the big night belongs at the Hotel Metropole' },
    ],
  });
  assert.ok(named.includes('Hotel Metropole'), `expected the hotel, got ${JSON.stringify(named)}`);
});

test('craft written as asked names nothing', () => {
  // A checker that fires on good answers gets turned off, and then nothing
  // is checked at all. Every one of these is the kind of sentence the
  // prompt is asking for, including the day of the week a rhythm needs.
  const named = namedThings(GOOD);
  assert.deepEqual(named, []);
});

test('a day of the week is not a business', () => {
  const named = namedThings({ ...GOOD, must_haves: ['land on Friday and leave Sunday after lunch'] });
  assert.deepEqual(named, []);
});

test('a sentence may start with a capital letter', () => {
  // The first version of the venue checker rejected every plan ever written
  // because prose starts sentences with capitals.
  const named = namedThings({ ...GOOD, conflict_points: ['Money. Somebody always wants the bigger room.'] });
  assert.deepEqual(named, []);
});

test('the check reads every string in the answer', () => {
  assert.deepEqual(
    stringsIn({ a: 'one', b: ['two', { c: 'three' }], d: 4, e: null }).sort(),
    ['one', 'three', 'two'],
  );
});

// ─── What is asked for ──────────────────────────────────────────────────

test('the prompt forbids naming anything, in words', () => {
  // The check above is the enforcement; this is the request. Both, because
  // an answer that never names anything costs nothing to store and one that
  // does costs a whole row and another call.
  const prompt = researchPrompt('bachelor_party');
  assert.match(prompt, /Name no business, restaurant, bar, club, hotel/);
  assert.match(prompt, /plain lower case/i);
  // And it has to say which kind of trip it is about, the way somebody
  // would say it rather than the way the column spells it.
  assert.ok(prompt.includes('bachelor party'), 'the prompt must name the kind of trip');
  assert.ok(!prompt.includes('bachelor_party today'), 'nothing reads the column name aloud');
});

test('the prompt asks for JSON with nothing around it', () => {
  assert.match(researchPrompt('reunion'), /JSON only/);
});

test('the correction quotes back what was wrong', () => {
  const note = nameCorrection(['El Charro Loco', 'Airbnb']);
  assert.match(note, /El Charro Loco/);
  assert.match(note, /Airbnb/);
});

test('a kind of trip is said the way a person says it', () => {
  assert.equal(saidAloud('outdoors_adventure'), 'outdoors adventure');
});

// ─── Time and money ─────────────────────────────────────────────────────

test('today begins at local midnight, not at Greenwich midnight', () => {
  // Eight in the evening in New York is already tomorrow in Greenwich. A cap
  // counted against the UTC day hands back a fresh allowance in the middle
  // of the evening and then refuses the first run of the morning.
  const evening = new Date(2026, 8, 21, 20, 30);        // 21 September, 8:30pm, local
  assert.equal(startOfLocalDay(evening), '2026-09-21T04:00:00.000Z');
  // Which is emphatically not the day Greenwich thinks it is by then.
  assert.equal(evening.toISOString().slice(0, 10), '2026-09-22');
});

test('what is stored is trusted for 180 days', () => {
  const now = new Date('2026-09-21T12:00:00.000Z');
  assert.equal(expiresAt(now), '2027-03-20T12:00:00.000Z');
});

test('a batch size that is not a number falls back to the default', () => {
  // An empty environment variable reads as '', and Number('') is 0 — a
  // batch of zero is a cron that runs forever and does nothing.
  assert.equal(positiveInt(undefined, 3), 3);
  assert.equal(positiveInt('', 3), 3);
  assert.equal(positiveInt('0', 3), 3);
  assert.equal(positiveInt('-2', 3), 3);
  assert.equal(positiveInt('5', 3), 5);
});
