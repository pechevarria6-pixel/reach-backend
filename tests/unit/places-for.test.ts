// placesFor against a fake table: nearest first, nothing gone, nothing shut,
// and never a hotel for dinner.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placesFor, placeMenu, scenesFrom, acrossTheBorder } from '../../lib/discovery/real-places.ts';

const CENTRE = { lat: 35.7796, lng: -78.6382 };
// A mile north, near enough, at this latitude.
const north = (miles: number) => ({ lat: CENTRE.lat + miles / 69, lng: CENTRE.lng });

type Row = Record<string, any>;
let nextId = 1;
const venue = (name: string, miles: number, over: Row = {}): Row => ({
  id: `v${nextId++}`, name, kind: 'restaurant', interest: 'places to eat', website: `https://${nextId}.example`,
  city: 'Raleigh', street: null, osm_tags: null, opening_hours: null, gone_at: null, ...north(miles), ...over,
});

/** Split a PostgREST or() on the commas that are not inside parentheses. */
function terms(expr: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of expr) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function term(t: string): (r: Row) => boolean {
  let m = /^([\w>-]+)\.is\.null$/.exec(t);
  if (m) return r => r[m![1]] == null;
  m = /^(\w+)\.not\.in\.\((.*)\)$/.exec(t);
  if (m) { const vs = m[2].split(',').map(v => v.replace(/^"|"$/g, '')); return r => !vs.includes(r[m![1]]); }
  m = /^([\w]+)(?:->>(\w+))?\.ilike\.\*(.*)\*$/.exec(t);
  if (m) {
    const [, col, key, word] = m;
    return r => String(key ? (r[col] ?? {})[key] ?? '' : r[col] ?? '').toLowerCase().includes(word.toLowerCase());
  }
  throw new Error(`the fake does not understand ${t}`);
}

/** Just enough of supabase-js for placesFor: filters, limit, range, and nothing else. */
function fakeDb(venues: Row[], opts: { noGoneAt?: boolean; noOsmTags?: boolean } = {}) {
  const reads: Array<{ table: string; rows: number }> = [];
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let limit = Infinity, start = 0, end = Infinity;
    let error: { code: string; message: string } | null = null;
    const rows = table === 'discovery_venues' ? venues : [];
    const b: any = {
      select(cols: string) {
        if (opts.noGoneAt && /gone_at/.test(cols)) error = { code: '42703', message: 'column gone_at does not exist' };
        if (opts.noOsmTags && /osm_tags|opening_hours/.test(cols)) error = { code: '42703', message: 'column discovery_venues.osm_tags does not exist' };
        return b;
      },
      gte(c: string, v: number) { filters.push(r => Number(r[c]) >= v); return b; },
      lte(c: string, v: number) { filters.push(r => Number(r[c]) <= v); return b; },
      gt() { return b; },
      eq(c: string, v: unknown) { filters.push(r => r[c] === v); return b; },
      neq(c: string, v: unknown) { filters.push(r => r[c] !== v); return b; },
      in(c: string, vs: unknown[]) { filters.push(r => vs.includes(r[c])); return b; },
      is(c: string) {
        if (c === 'gone_at' && opts.noGoneAt) error = { code: '42703', message: 'column discovery_venues.gone_at does not exist' };
        filters.push(r => r[c] == null);
        return b;
      },
      or(expr: string) {
        if (opts.noOsmTags && /osm_tags/.test(expr)) error = { code: '42703', message: 'column discovery_venues.osm_tags does not exist' };
        const fs = terms(expr).map(term); filters.push(r => fs.some(f => f(r))); return b; },
      order() { return b; },
      limit(n: number) { limit = n; return b; },
      range(a: number, z: number) { start = a; end = z; return b; },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      insert() { return Promise.resolve({ data: null, error: null }); },
      update() { return b; },
      then(resolve: (v: unknown) => void) {
        if (error) return resolve({ data: null, error });
        // In table order, the way an unordered read comes back: nearest is
        // not something the database was ever asked for.
        const hits = rows.filter(r => filters.every(f => f(r))).slice(start, end + 1).slice(0, limit);
        if (table === 'discovery_venues') reads.push({ table, rows: hits.length });
        return resolve({ data: hits, error: null });
      },
    };
    return b;
  };
  return { db: { from } as any, reads };
}

// Nominatim, placing Raleigh.
const geocoder = (async () => ({
  ok: true, status: 200,
  json: async () => [{ lat: String(CENTRE.lat), lon: String(CENTRE.lng), display_name: 'Raleigh, Wake County, North Carolina, United States', class: 'place', type: 'city', address: { country_code: 'us', 'ISO3166-2-lvl4': 'US-NC' } }],
})) as unknown as typeof fetch;

const WHERE = { city: 'Raleigh', country: 'US' };

test('the nearest places are on the menu even when the table holds hundreds further out', async () => {
  // Six hundred restaurants twenty miles off, stored first — which is what
  // an unordered, capped read of one wide box would have handed back.
  const far = Array.from({ length: 600 }, (_, i) => venue(`Far Diner ${i}`, 20));
  const near = [
    venue('Corner Bistro', 0.3),
    venue('City Museum', 1, { kind: 'museum', interest: 'museums & history' }),
    venue('Mid Gallery', 4, { kind: 'gallery', interest: 'art & galleries' }),
  ];
  const { db } = fakeDb([...far, ...near]);
  const places = await placesFor(db, WHERE, {}, geocoder);
  const names = places.map(p => p.name);
  assert.equal(names[0], 'Corner Bistro');
  assert.ok(names.includes('City Museum'));
  assert.ok(names.includes('Mid Gallery'));
  assert.ok(names.filter(n => n.startsWith('Far Diner')).length <= 7, 'the cap still holds for the far restaurants');
});

test('a place two weekly loads did not find is not on the menu', async () => {
  const { db } = fakeDb([venue('Open Tavern', 0.5), venue('Closed Down Cafe', 0.4, { gone_at: '2026-09-21T06:17:00Z' })]);
  const names = (await placesFor(db, WHERE, {}, geocoder)).map(p => p.name);
  assert.deepEqual(names, ['Open Tavern']);
});

test('before the migration has run, the menu still reads, hours and all', async () => {
  const { db } = fakeDb([venue('Open Tavern', 0.5, { opening_hours: 'Mo-Su 16:00-02:00' })], { noGoneAt: true });
  const places = await placesFor(db, WHERE, {}, geocoder);
  assert.deepEqual(places.map(p => p.name), ['Open Tavern']);
  assert.equal(places[0].hours, 'Mo-Su 16:00-02:00');
});

test('shut on the evening of the plan is dropped; open, unknown or undated is kept', async () => {
  const rows = [
    venue('Sunday Closed Grill', 0.2, { opening_hours: 'Mo-Sa 17:00-22:00; Su off', street: '1 Main St' }),
    venue('Always Open Diner', 0.3, { opening_hours: '24/7' }),
    venue('Nobody Mapped Hours', 0.4),
    venue('Garbled Hours Cafe', 0.5, { opening_hours: 'ask at the bar' }),
  ];
  const sunday = { from: '2026-09-27', to: '2026-09-27' };
  const onSunday = (await placesFor(fakeDb(rows).db, WHERE, { days: sunday }, geocoder)).map(p => p.name);
  assert.deepEqual(onSunday, ['Always Open Diner', 'Nobody Mapped Hours', 'Garbled Hours Cafe']);

  const monday = { from: '2026-09-28', to: '2026-09-28' };
  const onMonday = await placesFor(fakeDb(rows).db, WHERE, { days: monday }, geocoder);
  assert.equal(onMonday[0].name, 'Sunday Closed Grill');
  assert.equal(onMonday[0].street, '1 Main St');

  const undated = (await placesFor(fakeDb(rows).db, WHERE, {}, geocoder)).map(p => p.name);
  assert.equal(undated.length, 4);
});

test('the menu quotes the map\'s hours as the map\'s, and gives none it was not given', async () => {
  const rows = [venue('Sunday Closed Grill', 0.2, { opening_hours: 'Mo-Sa 17:00-22:00; Su off' }), venue('Nobody Mapped Hours', 0.4)];
  const menu = placeMenu(await placesFor(fakeDb(rows).db, WHERE, {}, geocoder));
  // The name's line now goes on to say what it is ("— restaurant · …"), so
  // the hours are looked for on the line after it, however long that is.
  assert.match(menu, /Sunday Closed Grill[^\n]*\n\s+hours per OpenStreetMap: Mo-Sa 17:00-22:00; Su off/);
  assert.doesNotMatch(menu, /Nobody Mapped Hours[^\n]*\n\s+hours/);
});

test('a hotel is never dinner, whatever interest it was filed under', async () => {
  const rows = [
    venue('Grand Hotel', 0.1, { kind: 'hotel', interest: 'places to stay' }),
    // Filed before lodging had an interest of its own.
    venue('Harbour Guest House', 0.15, { kind: 'guest house', interest: 'places to eat' }),
    venue('Corner Bistro', 0.3),
  ];
  const names = (await placesFor(fakeDb(rows).db, WHERE, {}, geocoder)).map(p => p.name);
  assert.deepEqual(names, ['Corner Bistro']);
});

test('the food somebody asked for is found across the whole radius and put first', async () => {
  const rows = [
    ...Array.from({ length: 12 }, (_, i) => venue(`Burger Bar ${i}`, 0.2 + i / 100)),
    venue('Lotus Kitchen', 18, { osm_tags: { cuisine: 'thai' } }),
  ];
  const places = await placesFor(fakeDb(rows).db, WHERE, { wantFood: ['thai'] }, geocoder);
  assert.equal(places[0].name, 'Lotus Kitchen');
  assert.equal(places[0].forFood, 'thai');
  assert.equal(places.filter(p => p.name.startsWith('Burger Bar')).length, 8, 'the per-kind cap is kept for the rest');
});

test('a count reads the whole radius, not a capped list', async () => {
  const rows = Array.from({ length: 1500 }, (_, i) => venue(`Place ${i}`, (i % 20) + 0.1));
  const { db } = fakeDb(rows);
  const places = await placesFor(db, WHERE, { perKind: Infinity, max: Infinity }, geocoder);
  assert.equal(places.length, 1500);
});

test('the food asked for is still found before the hours migration has run', async () => {
  // osm_tags missing: the cuisine clause named it and every retry failed, so
  // the Thai place fifteen miles out was never read.
  const near = Array.from({ length: 12 }, (_, i) => venue(`Ramen Bar ${i}`, 0.2 + i * 0.05));
  const thai = venue('Lemongrass Thai', 15);
  const { db } = fakeDb([...near, thai], { noGoneAt: true, noOsmTags: true });
  const names = (await placesFor(db, WHERE, { wantFood: ['thai'] }, geocoder)).map(p => p.name);
  assert.ok(names.includes('Lemongrass Thai'), names.join(', '));
});

test('an undated plan does not name a place the map says is shut for good', async () => {
  const rows = [
    venue('Shut Down Diner', 0.2, { opening_hours: 'off' }),
    venue('Closed Cafe', 0.3, { opening_hours: 'closed' }),
    venue('Wednesday Supper Club', 0.4, { opening_hours: 'We 19:00-22:00' }),
    venue('Nobody Mapped Hours', 0.5),
  ];
  const names = (await placesFor(fakeDb(rows).db, WHERE, { days: null }, geocoder)).map(p => p.name);
  assert.deepEqual(names, ['Wednesday Supper Club', 'Nobody Mapped Hours']);
});

test('a day trip on one date keeps the lunch place a night out drops', async () => {
  const rows = [venue('Lunch Counter', 0.2, { kind: 'cafe', opening_hours: 'Mo-Su 07:00-15:00' }), venue('Supper Room', 0.3)];
  const monday = { from: '2026-09-28', to: '2026-09-28' };
  const dayTrip = (await placesFor(fakeDb(rows).db, WHERE, { days: monday }, geocoder)).map(p => p.name);
  assert.deepEqual(dayTrip, ['Lunch Counter', 'Supper Room']);
  const nightOut = (await placesFor(fakeDb(rows).db, WHERE, { days: monday, eveningOut: true }, geocoder)).map(p => p.name);
  assert.deepEqual(nightOut, ['Supper Room']);
});

test('a count asks for no listings, and says when it stopped at the page limit', async () => {
  const rows = Array.from({ length: 1200 }, (_, i) => venue(`Spot ${i}`, (i % 20) + 0.1));
  const { db } = fakeDb(rows);
  const tables: string[] = [];
  const spy = { from: (t: string) => { tables.push(t); return db.from(t); } } as any;
  const counted = { floor: false };
  const places = await placesFor(spy, WHERE, { perKind: Infinity, max: Infinity, counted }, geocoder);
  assert.equal(places.length, 1200);
  assert.ok(!tables.includes('discovery_events'), 'thousands of ids in one URL is a request PostgREST refuses');
  assert.equal(counted.floor, false, 'under the page limit the count is exact');
});

test('a count that reached the page limit is worded as a floor', () => {
  const places = Array.from({ length: 20000 }, (_, i) => ({ ref: `p${i}`, name: `R${i}`, kind: 'restaurant', interest: 'places to eat', url: null, city: null, source: 'osm' }));
  assert.match(scenesFrom(places, { floor: true })!.food, /^20,000\+ places to eat verified here/);
  assert.match(scenesFrom(places)!.food, /^20,000 places to eat verified here/);
});

// ── Whole regions: the border, and the wonders ────────────────────────

test('a place across the border is not "nearby", however close', async () => {
  // Mexico is read whole now, so Juárez's restaurants sit a mile from
  // downtown El Paso in the table. Raleigh stands in for the border town.
  const rows = [
    venue('Across The Line Cantina', 0.2, { region: 'north-america/mexico' }),
    venue('Home Side Diner', 0.4, { region: 'north-america/us/north-carolina' }),
    venue('Swept Cafe', 0.5, { region: null }),
  ];
  const names = (await placesFor(fakeDb(rows).db, WHERE, {}, geocoder)).map(p => p.name);
  assert.deepEqual(names, ['Home Side Diner', 'Swept Cafe'], 'the sweep\'s rows, which carry no region, are kept');
});

test('the border check never drops a place it cannot be sure of', () => {
  assert.equal(acrossTheBorder('north-america/mexico', 'US'), true);
  assert.equal(acrossTheBorder('north-america/mexico', 'mx'), false);
  assert.equal(acrossTheBorder('north-america/mexico', null), false, 'no trip country, no guess');
  assert.equal(acrossTheBorder(null, 'US'), false);
  assert.equal(acrossTheBorder('not/a-region', 'US'), false);
  // Nominatim calls Hong Kong "cn" and San Juan "us": neither is foreign to itself.
  assert.equal(acrossTheBorder('asia/china/hong-kong', 'CN'), false);
  assert.equal(acrossTheBorder('asia/china/hong-kong', 'HK'), false);
  assert.equal(acrossTheBorder('north-america/us/puerto-rico', 'US'), false);
  // The Ireland file holds Northern Ireland: Belfast is GB.
  assert.equal(acrossTheBorder('europe/ireland-and-northern-ireland', 'GB'), false);
});

test('a French or American territory keeps its own venues: Papeete, Cayenne, Guam', () => {
  // The codes Nominatim gives each town, checked on 2026-09-24.
  assert.equal(acrossTheBorder('australia-oceania/polynesie-francaise', 'fr'), false, 'Papeete');
  assert.equal(acrossTheBorder('australia-oceania/polynesie-francaise', 'PF'), false);
  assert.equal(acrossTheBorder('europe/france/guyane', 'fr'), false, 'Cayenne');
  assert.equal(acrossTheBorder('australia-oceania/american-oceania', 'us'), false, 'Hagåtña, Guam');
  assert.equal(acrossTheBorder('australia-oceania/american-oceania', 'GU'), false);
  assert.equal(acrossTheBorder('australia-oceania/american-oceania', 'AS'), false, 'Pago Pago');
  assert.equal(acrossTheBorder('australia-oceania/wallis-et-futuna', 'fr'), false, 'Mata-Utu');
  assert.equal(acrossTheBorder('australia-oceania/tokelau', 'tk'), false, 'Fakaofo');
  assert.equal(acrossTheBorder('australia-oceania/pitcairn-islands', 'pn'), false, 'Adamstown');
  // And none of them is Vanuatu any more.
  assert.equal(acrossTheBorder('australia-oceania/polynesie-francaise', 'VU'), true);
  assert.equal(acrossTheBorder('australia-oceania/american-oceania', 'VU'), true);
});

test('a plan to Machu Picchu is read around Aguas Calientes, without asking the geocoder', async () => {
  const AGUAS = { lat: -13.1547, lng: -72.5254 };
  const rows = [
    { ...venue('Tree House Restaurant', 0), lat: AGUAS.lat + 0.002, lng: AGUAS.lng, region: 'south-america/peru', city: 'Aguas Calientes' },
    // A Raleigh row, where a geocoder that guessed wrong would have looked.
    venue('Somewhere Else Grill', 0.1),
  ];
  const refuses = (async () => { throw new Error('the geocoder was asked about a wonder'); }) as unknown as typeof fetch;
  const names = (await placesFor(fakeDb(rows).db, { city: 'Machu Picchu', country: 'PE' }, {}, refuses)).map(p => p.name);
  assert.deepEqual(names, ['Tree House Restaurant']);
});
