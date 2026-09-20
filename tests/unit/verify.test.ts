import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  terms, isSamePlace, factsFrom, paymentLine, checkAll, tally,
} from '../../lib/discovery/verify.ts';
import { fields, plain, listingsFrom, attributedNote } from '../../lib/discovery/wikivoyage.ts';

// ─── What counts as having found somewhere ──────────────────────────────

test('the town’s own name is never evidence of a venue in that town', () => {
  // This shipped wrong for one run and is the reason the ignore set exists.
  // "Cool off at the Moab Museum" matched a map feature named simply "Moab",
  // and the check reported REAL against a venue nothing had confirmed — a
  // false confirmation, which is worse than no check at all, because it is
  // Reach saying it looked.
  assert.equal(isSamePlace('Cool off at the Moab Museum', 'Moab'), true,
    'without the ignore set it matches — that is the bug being guarded');
  assert.equal(isSamePlace('Cool off at the Moab Museum', 'Moab', new Set(['moab'])), false);
});

test('one shared ordinary word is not a match', () => {
  assert.equal(isSamePlace('Smoothies at Peace Tree Juice Cafe', 'Peace Plaza Hotel'), false);
});

test('two distinctive words are', () => {
  assert.equal(isSamePlace('Dinner at the bar at Antica Forma for pizza', 'Antica Forma'), true);
});

test('the words an itinerary wraps a venue in are not part of its name', () => {
  // 'dinner' is the longest word in that sentence, and a map search for it
  // near Moab returns everywhere that serves any.
  assert.ok(!terms('Dinner at the bar at Antica Forma').includes('dinner'));
  assert.deepEqual(terms('Dinner at the bar at Antica Forma'), ['antica', 'forma']);
});

// ─── Payment, which is the claim that started all this ──────────────────

test('nothing recorded produces no payment line at all', () => {
  // Not "cards probably", not "check before you go". Nothing. An empty
  // payment is rendered as empty, and the traveller is told nothing rather
  // than told something we made up.
  const facts = factsFrom({ name: "Milt's Stop & Eat", amenity: 'fast_food' });
  assert.deepEqual(facts.payment, []);
  assert.equal(paymentLine(facts), null);
});

test('a recorded policy is stated, and only what is recorded', () => {
  assert.equal(paymentLine(factsFrom({ name: 'X', 'payment:cash': 'yes' })), 'Cash');
  assert.equal(paymentLine(factsFrom({ name: 'X', 'payment:cards': 'yes' })), 'Cards accepted');
  assert.equal(
    paymentLine(factsFrom({ name: 'X', 'payment:cash': 'yes', 'payment:visa': 'yes' })),
    'Cards and cash',
  );
});

test('payment:cards=no is not a record that cards are taken', () => {
  // Only `yes` counts. A tag saying cards are refused must not read through
  // as cards accepted, which is the wrong-way-round version of the failure.
  assert.equal(paymentLine(factsFrom({ name: 'X', 'payment:cards': 'no' })), null);
});

// ─── Reading what a traveller wrote ─────────────────────────────────────

test('a pipe inside a wiki link does not split the sentence', () => {
  const f = fields('name=X|content=Go to [[Arches National Park|the park]] first|phone=555');
  assert.equal(f.content, 'Go to the park first');
  assert.equal(f.phone, '555');
});

test('markup is reduced to the sentence underneath it', () => {
  assert.equal(plain("'''Great''' food and [http://x.com great] beer"), 'Great food and great beer');
});

test('a listing is read with its contact details and its opinion', () => {
  const [a] = listingsFrom(
    '{{eat | name=Pasta Jay\'s | url=http://pastajays.com/ | address=4 South Main St'
    + ' | phone=+1 435-259-2900 | content=Order the Tortellone Alfredo. }}',
    'Moab',
  );
  assert.equal(a.name, "Pasta Jay's");
  assert.equal(a.kind, 'restaurant');
  assert.equal(a.phone, '+1 435-259-2900');
  assert.equal(a.note, 'Order the Tortellone Alfredo.');
  assert.equal(a.credit.source, 'wikivoyage');
});

test('an opinion is always attributed to whoever holds it', () => {
  const [a] = listingsFrom('{{eat|name=X|content=Order the tortellone.}}', 'Moab');
  assert.match(attributedNote(a) as string, /— a traveller on Wikivoyage$/);
});

test('a listing with no name is not a listing', () => {
  assert.equal(listingsFrom('{{eat | address=4 South Main St }}', 'Moab').length, 0);
});

// ─── The whole pass, with no network ────────────────────────────────────

/** Both sources, answering exactly as the real ones did for Moab. */
function fakeFetch(osm: Record<string, string>[], wikitext = ''): typeof fetch {
  return (async (url: string) => {
    if (String(url).includes('wikivoyage')) {
      return { ok: true, json: async () => ({ parse: { title: 'Moab', wikitext } }) };
    }
    return { ok: true, json: async () => ({ elements: osm.map(tags => ({ tags })) }) };
  }) as unknown as typeof fetch;
}

const MOAB = { name: 'Moab', lat: 38.5733, lng: -109.5498 };

test('a venue on the map is confirmed, one that is not is not', async () => {
  const checked = await checkAll(
    ['Burgers at Milt’s', 'Tacos at El Charro Loco'],
    MOAB,
    fakeFetch([{ name: "Milt's Stop & Eat", amenity: 'fast_food', phone: '+1-435-259-7424' }]),
  );
  assert.equal(checked[0].verification.status, 'confirmed');
  assert.equal(checked[1].verification.status, 'not_found');
});

test('a map that does not answer leaves everything unchecked, never absent', async () => {
  // The distinction the whole design rests on. Overpass 504s under load, and
  // a silent source must never read as "this restaurant does not exist".
  const dead = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
  const [c] = await checkAll(['Burgers at Milt’s'], MOAB, dead);
  assert.equal(c.verification.status, 'unchecked');
  assert.notEqual(c.verification.status, 'not_found');
});

test('a confirmed venue with no payment data yields no payment claim', async () => {
  // Measured against the real sources: four of Moab's named venues confirmed,
  // and not one of them carries payment data anywhere we can read. So the
  // product may say the place is real and must stay silent on how it is paid.
  const [c] = await checkAll(
    ['Burgers at Milt’s'],
    MOAB,
    fakeFetch([{ name: "Milt's Stop & Eat", amenity: 'fast_food' }]),
  );
  assert.equal(c.verification.status, 'confirmed');
  assert.equal(c.payment, null);
});

test('a traveller’s note is carried through to the item it is about', async () => {
  const checked = await checkAll(
    ['Order in at Pasta Jay’s'],
    MOAB,
    fakeFetch(
      [{ name: "Pasta Jay's", amenity: 'restaurant' }],
      "{{eat|name=Pasta Jay's|content=Order the Tortellone Alfredo.}}",
    ),
  );
  assert.equal(checked[0].advice?.note, 'Order the Tortellone Alfredo.');
});

test('the tally counts what was actually established', async () => {
  const checked = await checkAll(
    ['Burgers at Milt’s', 'Tacos at El Charro Loco'],
    MOAB,
    fakeFetch([{ name: "Milt's Stop & Eat", amenity: 'fast_food' }]),
  );
  assert.deepEqual(tally(checked), {
    named: 2, confirmed: 1, notFound: 1, unchecked: 0, withPayment: 0, withAdvice: 0,
  });
});
