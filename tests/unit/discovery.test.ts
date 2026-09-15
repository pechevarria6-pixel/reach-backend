// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rank } from '../../lib/discovery/rank.ts';
import { notRuledOut } from '../../lib/discovery/rules.ts';
import { searchTermFor } from '../../lib/discovery/yelp.ts';
import type { Finding } from '../../lib/discovery/types.ts';

const make = (over: Partial<Finding>): Finding => ({
  id: over.id ?? 'x', title: 'Thing', meta: '', emoji: '🎫', price: null,
  dist: null, category: 'Event', url: 'https://example.com', date: null,
  venue: null, source: 'ticketmaster', because: null, ...over,
});

test('what you are into outranks what happens to be nearby', () => {
  const found = [
    make({ id: 'stadium', title: 'Stadium Show', source: 'ticketmaster' }),
    make({ id: 'wheel', title: 'Evening Wheel Throwing', source: 'yelp-places', because: 'pottery' }),
  ];
  const [first] = rank(found, ['pottery']);
  assert.equal(first.id, 'wheel');
});

test('no one source can take the whole page', () => {
  const found = [
    ...['a', 'b', 'c', 'd'].map(id => make({ id, source: 'ticketmaster' })),
    make({ id: 'p1', source: 'yelp-places', because: 'cooking' }),
    make({ id: 'p2', source: 'yelp-places', because: 'cooking' }),
  ];
  const sources = rank(found, ['cooking']).slice(0, 4).map(f => f.source);
  // Interleaved, so the second card is never the same source as the first.
  assert.notEqual(sources[0], sources[1]);
  assert.equal(new Set(sources).size, 2);
});

test('ranking keeps everything it was given', () => {
  const found = ['a', 'b', 'c', 'd', 'e'].map(id => make({ id, source: id < 'c' ? 'yelp-events' : 'ticketmaster' }));
  const ranked = rank(found, []);
  assert.equal(ranked.length, 5);
  assert.deepEqual(new Set(ranked.map(f => f.id)), new Set(['a', 'b', 'c', 'd', 'e']));
});

test('nothing in, nothing out', () => {
  assert.deepEqual(rank([], ['pottery']), []);
  assert.deepEqual(rank([make({ id: 'a' })], []).map(f => f.id), ['a']);
});

test('a hard no is a hard no, however good it looks', () => {
  assert.equal(notRuledOut('Midnight Karaoke Bar', ['karaoke']), false);
  assert.equal(notRuledOut('Pottery Studio', ['karaoke']), true);
});

test('a hard no does not match on a fragment', () => {
  // "art" must not rule out a departure lounge or a cartwheel class.
  assert.equal(notRuledOut('Departures Bar', ['art']), true);
  assert.equal(notRuledOut('Anything', ['']), true);
  assert.equal(notRuledOut('Anything', ['  ']), true);
});

test('an interest becomes something worth searching for', () => {
  // Keyed on the words the quiz saves, not its option ids.
  assert.equal(searchTermFor('Pottery & crafts'), 'pottery class');
  assert.equal(searchTermFor('Cooking'), 'cooking class');
  assert.equal(searchTermFor('Comedy'), 'comedy club');
  assert.equal(searchTermFor('Live music'), 'live music venue');
});

test('what somebody typed is searched as they typed it', () => {
  // The point of a free text box is that the answer is not on our list.
  assert.equal(searchTermFor('letterpress workshop'), 'letterpress workshop');
  assert.equal(searchTermFor('sea swimming'), 'sea swimming class');
  assert.equal(searchTermFor('  Sourdough  '), 'sourdough class');
});

// ── OpenStreetMap ────────────────────────────────────────────────────────
import { tagsFor, boundingBox, overpassQuery } from '../../lib/discovery/osm.ts';

test('an interest becomes the tags mappers actually use', () => {
  const pottery = tagsFor('Pottery & crafts');
  assert.ok(pottery.includes('craft=pottery'));
  // The same thing is tagged differently by different mappers, and missing
  // half a city's studios is not an option.
  assert.ok(pottery.includes('shop=pottery'));
  assert.ok(pottery.length > 2);
});

test('something nobody anticipated is searched by name', () => {
  const typed = tagsFor('letterpress');
  assert.equal(typed.length, 1);
  assert.match(typed[0], /^name~"letterpress",i$/);
});

test('a typed interest cannot break out of the query', () => {
  // Overpass takes a query language, so a quote or a newline in somebody's
  // own words must not become syntax.
  const nasty = tagsFor('pottery" ; out; //');
  assert.ok(!nasty[0].includes('\n'));
  assert.equal((nasty[0].match(/"/g) || []).length, 2);
});

test('a bounding box narrows with latitude', () => {
  // A degree of longitude at 56 north is about half its width at the equator.
  const width = (box: string) => {
    const [, w, , e] = box.split(',').map(Number);
    return e - w;
  };
  assert.ok(width(boundingBox(56, -3, 25)) > width(boundingBox(0, -3, 25)));
});

test('the box is centred on where you actually are', () => {
  const [s, w, n, e] = boundingBox(55.95, -3.19, 25).split(',').map(Number);
  assert.ok(s < 55.95 && n > 55.95);
  assert.ok(w < -3.19 && e > -3.19);
});

test('no interests means no query clauses', () => {
  assert.ok(!overpassQuery([], boundingBox(55.95, -3.19, 25)).includes('nwr'));
});

// ── Harvesting ───────────────────────────────────────────────────────────
import { disallowedPaths, classesLink, readableText, shorten } from '../../lib/discovery/harvest.ts';

test('robots.txt is read as what it says', () => {
  const denied = disallowedPaths('User-agent: *\nDisallow: /admin\nDisallow: /cart\n');
  assert.deepEqual(denied, ['/admin', '/cart']);
});

test('an empty Disallow permits everything, it does not forbid everything', () => {
  // "Disallow:" with nothing after it is the canonical way to say "go ahead".
  // Reading it as "/" would turn the most permissive robots.txt into a wall.
  assert.deepEqual(disallowedPaths('User-agent: *\nDisallow:\n'), []);
});

test('a rule aimed at us beats the catch-all', () => {
  const txt = 'User-agent: *\nDisallow: /\n\nUser-agent: reachdiscovery\nDisallow: /private\n';
  assert.deepEqual(disallowedPaths(txt), ['/private']);
});

test('the link most likely to list classes is the one picked', () => {
  const html = `
    <a href="/about">About</a>
    <a href="/book-a-table">Book</a>
    <a href="/pottery-classes">Classes</a>`;
  assert.match(classesLink(html, 'https://example.com') ?? '', /pottery-classes$/);
});

test('a harvester never wanders off the site', () => {
  // Following a link to a booking platform or a social page is how this ends
  // up reading somebody else's login screen.
  const html = '<a href="https://facebook.com/events/123">Events</a>';
  assert.equal(classesLink(html, 'https://example.com'), null);
});

test('assets are never mistaken for pages', () => {
  assert.equal(classesLink('<a href="/classes-hero.jpg">x</a>', 'https://example.com'), null);
});

test('scripts and styles are not words on a page', () => {
  const html = '<style>.a{color:red}</style><script>var classes=1</script><p>Wheel throwing, &pound;45</p>';
  const text = readableText(html);
  assert.ok(text.includes('Wheel throwing'));
  assert.ok(!text.includes('color:red'));
  assert.ok(!text.includes('var classes'));
});

test('a page that lists two dozen dates still fits on a card', () => {
  // Measured on a real studio: one taster session, twenty-four sittings.
  const many = Array.from({ length: 24 }, (_, i) => `Thurs ${i + 1} 3-5pm`).join(', ');
  const short = shorten(many);
  assert.ok(short.length <= 90);
  assert.match(short, /^Thurs 1 3-5pm/);
  assert.match(short, /\+\d+ more$/);
});

test('phrasing short enough to keep is kept exactly', () => {
  assert.equal(shorten('Wednesdays, 7-9pm'), 'Wednesdays, 7-9pm');
});

import { osmFindingId, osmRef } from '../../lib/discovery/osm.ts';

test('a venue keeps the map reference it was found under', () => {
  // The sweep once read these with a pattern no id matched, so every venue
  // in every city was stored as nothing. Built one way, read the other.
  for (const [type, id] of [['node', 123], ['way', 456], ['relation', 7]] as const) {
    assert.deepEqual(osmRef(osmFindingId(type, id)), { type, id });
  }
});

test('something that is not a map reference is not read as one', () => {
  assert.equal(osmRef('yelp_place_abc'), null);
  assert.equal(osmRef('osm_node_'), null);
  assert.equal(osmRef('osm_node_12x'), null);
});

test('the map server is given as long as we will wait', () => {
  // Fifteen seconds had a dense area refused with a 504 it would have
  // answered in fourteen.
  assert.match(overpassQuery(['cooking'], '1,2,3,4'), /\[timeout:25\]/);
  assert.match(overpassQuery(['cooking'], '1,2,3,4', 30, 8), /\[timeout:8\]/);
});

// ── Taste: every answer, and something for somebody with none ────────────
import { tasteFrom, kindFor } from '../../lib/discovery/taste.ts';
import { matchesSelector } from '../../lib/discovery/osm.ts';

test('somebody who skipped the quiz still gets a bit of everything', () => {
  const t = tasteFrom(null);
  assert.equal(t.interests.length, 0);
  assert.ok(t.browse.length >= 5);
  assert.equal(new Set(t.browse).size, t.browse.length);
});

test('every answer counts, not just the activities question', () => {
  const t = tasteFrom({
    cuisines: ['Japanese'], drink_style: 'Cocktails',
    nightlife_style: 'A proper pub', music_genres: ['Jazz & soul'],
  });
  for (const k of ['japanese restaurants', 'cocktail bars', 'pubs', 'live music', 'jazz']) {
    assert.ok(t.interests.includes(k), k);
  }
});

test('what they picked first stays first', () => {
  const t = tasteFrom({ favorite_activities: ['Pottery & crafts', 'Cooking'], cuisines: ['Thai'] });
  assert.deepEqual(t.interests.slice(0, 2), ['pottery & crafts', 'cooking']);
});

test('not drinking means no bars, breweries or wine, chosen or suggested', () => {
  const t = tasteFrom({
    drink_style: 'Not drinking', nightlife_style: 'A proper pub',
    favorite_activities: ['Breweries', 'Pottery & crafts'],
  });
  for (const k of [...t.interests, ...t.browse]) assert.ok(!kindFor(k).alcohol, k);
  assert.ok(t.interests.includes('pottery & crafts'));
});

test('a hard no on clubs rules out the nightclub, not the gig', () => {
  const t = tasteFrom({ nightlife_style: 'Dancing', music_genres: ['Rock & indie'], no_way_jose: ['Clubs'] });
  assert.ok(!t.interests.includes('nightclubs'));
  assert.ok(t.interests.includes('live music'));
});

test('plenty of answers still leaves room for something new', () => {
  const t = tasteFrom({
    favorite_activities: ['Cooking', 'Comedy', 'Sport', 'Wellness', 'Dancing', 'Photography', 'Outdoors'],
  });
  assert.ok(t.browse.length >= 2);
  assert.ok(t.browse.every(b => !t.interests.includes(b)));
});

test('every new chip is a kind the sources know, not a name search', () => {
  for (const chip of ['Markets & food halls', 'Museums & history', 'Wine tasting',
    'Breweries', 'Trivia & board games', 'Gardens & parks']) {
    assert.ok(!kindFor(chip).osm.some(s => s.startsWith('name~')), chip);
    assert.ok(!kindFor(chip).yelp.endsWith(' class'), chip);
  }
});

test('a cuisine is looked for as restaurants that serve it, however it is listed', () => {
  const [sel] = kindFor('Japanese restaurants').osm;
  // OSM keeps cuisines as lists.
  assert.ok(matchesSelector(sel, { amenity: 'restaurant', cuisine: 'sushi;japanese' }));
  assert.ok(!matchesSelector(sel, { amenity: 'restaurant', cuisine: 'italian' }));
  assert.ok(!matchesSelector(sel, { amenity: 'cafe', cuisine: 'japanese' }));
});

test('restaurants and bars are not read for classes; studios and typed interests are', () => {
  assert.equal(kindFor('pubs').harvest, false);
  assert.equal(kindFor('thai restaurants').harvest, false);
  assert.equal(kindFor('Pottery & crafts').harvest, true);
  assert.equal(kindFor('letterpress').harvest, true);
});

test('each kind of place gets its own cap, so restaurants cannot crowd out a studio', () => {
  const q = overpassQuery(['Pottery & crafts', 'Italian restaurants'], '1,2,3,4', 15);
  assert.equal((q.match(/out center 15;/g) || []).length, 2);
});

test('a typed cuisine cannot break out of the query either', () => {
  const [sel] = kindFor('korean"); out; restaurants').osm;
  assert.ok(!sel.includes('\n'));
  assert.equal((sel.match(/"/g) || []).length, 2);
});
