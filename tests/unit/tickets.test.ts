import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actFrom, ticketSources } from '../../lib/tickets.ts';

// The one event itinerary line in the table, verbatim.
const REAL = {
  title: 'See The Milk Carton Kids live at 9:30 Club',
  venueName: '9:30 CLUB',
  primaryUrl: 'https://www.ticketmaster.com/the-milk-carton-kids-washington',
};

test('the act comes out of the sentence the itinerary wrote around it', () => {
  // Searching a marketplace for the whole line finds nothing.
  assert.equal(actFrom(REAL.title, REAL.venueName), 'The Milk Carton Kids');
});

test('the venue is removed by name, so other "at"s survive', () => {
  assert.equal(
    actFrom('See Sleep Token at the O2 Arena', 'the O2 Arena'),
    'Sleep Token',
  );
  // "at" inside the act's own name is not a venue.
  assert.equal(actFrom('Catch Death at a Funeral at The Lemon Tree', 'The Lemon Tree'),
    'Death at a Funeral');
});

test('a line with nothing but a venue gives nothing to search for', () => {
  assert.equal(actFrom('at 9:30 CLUB', '9:30 CLUB'), null);
  assert.equal(actFrom('', '9:30 CLUB'), null);
  assert.equal(actFrom(null), null);
});

test('the exact seller comes first and is the only claim', () => {
  const s = ticketSources(REAL);
  assert.equal(s[0].kind, 'seller');
  assert.equal(s[0].exact, true);
  assert.equal(s[0].url, REAL.primaryUrl);
  // Everything after it is a search, and says so.
  for (const later of s.slice(1)) {
    if (later.kind === 'resale') assert.equal(later.exact, false);
  }
});

test('a search never claims a ticket is there', () => {
  const s = ticketSources(REAL);
  const resale = s.filter(r => r.kind === 'resale');
  assert.ok(resale.length >= 2, 'no fallback offered');
  for (const r of resale) {
    assert.match(r.label, /^Also try /);
    assert.equal(r.exact, false);
  }
});

test('the search URLs are the shapes that were actually checked', () => {
  // StubHub's /find/s/?q= answers 404. These two returned 200.
  const s = ticketSources(REAL);
  const urls = s.map(r => r.url);
  assert.ok(urls.some(u => u.startsWith('https://www.stubhub.com/search?q=')), 'stubhub shape changed');
  assert.ok(urls.some(u => u.startsWith('https://www.vividseats.com/search?searchTerm=')), 'vividseats shape changed');
  assert.ok(!urls.some(u => u.includes('stubhub.com/find/s/')), 'the 404 shape is back');
  // SeatGeek could not be verified — it answers 403 to anything but a
  // browser — so it is not offered.
  assert.ok(!urls.some(u => u.includes('seatgeek')), 'shipping a link nobody checked');
});

test('the box office is offered only when it is somewhere else', () => {
  // A harvested event's booking URL IS the venue's own page. Offering it
  // twice under two headings is the redundancy rule.
  const same = ticketSources({
    title: 'Quiz night at Red Bear', venueName: 'Red Bear',
    primaryUrl: 'https://www.redbear.beer/events', venueWebsite: 'https://www.redbear.beer/',
  });
  assert.equal(same.filter(r => r.kind === 'box_office').length, 0);

  const different = ticketSources({ ...REAL, venueWebsite: 'https://www.930.com/' });
  const box = different.find(r => r.kind === 'box_office');
  assert.ok(box, 'a real second source was dropped');
  assert.equal(box?.exact, true);
  assert.match(box?.label ?? '', /box office/i);
});

test('with no seller at all there is still somewhere to look', () => {
  const s = ticketSources({ title: 'See J. Cole live at Crown Coliseum', venueName: 'Crown Coliseum' });
  assert.equal(s.filter(r => r.kind === 'seller').length, 0);
  assert.ok(s.length >= 2);
  assert.ok(s.every(r => r.url.includes('J.%20Cole') || r.url.includes('J.+Cole') || r.url.includes('Crown')));
});
