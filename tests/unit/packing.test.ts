import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packingList, packingLine } from '../../lib/packing.ts';

const items = (l: ReturnType<typeof packingList>) => l.map(i => i.item);

test('every item points at the line or the dates it came from', () => {
  const list = packingList({
    startDate: '2026-11-06', endDate: '2026-11-09',
    lines: [
      { id: 'a', type: 'flight', title: 'RDU → DEN', held: true },
      { id: 'b', type: 'hotel', title: 'The Crawford', held: true },
      { id: 'c', type: 'activity', title: 'Sunrise hike to Royal Arch', subtitle: 'Chautauqua trailhead' },
    ],
  });
  assert.deepEqual(items(list), ['Clothes for 3 nights', 'ID for the airport', "Your hotel's booking reference", 'Walking shoes']);
  assert.equal(list.find(i => i.item === 'Walking shoes')?.because, 'Sunrise hike to Royal Arch');
});

test('a bar with a hiking name does not ask anybody to bring boots, and a pool hall is not a pool', () => {
  const list = packingList({
    startDate: '2026-11-06', endDate: '2026-11-07',
    lines: [
      { id: 'a', type: 'activity', title: 'Trailhead Taproom', subtitle: 'Brewery' },
      { id: 'b', type: 'activity', title: 'Corner Pocket', subtitle: 'Billiards and pool hall' },
    ],
  });
  assert.deepEqual(list, []);
});

test('a trip whose lines give nothing up gets no list at all — the dates alone are not a list', () => {
  assert.deepEqual(packingList({ startDate: '2026-11-06', endDate: '2026-11-08', lines: [{ id: 'a', type: 'restaurant', title: "Vic's" }] }), []);
  assert.deepEqual(packingList({ startDate: '2026-11-06', endDate: '2026-11-08', lines: [] }), []);
});

test('one night is singular, and a list names nothing twice', () => {
  const list = packingList({
    startDate: '2026-11-06', endDate: '2026-11-07',
    lines: [
      { id: 'a', type: 'activity', title: 'Beach morning' },
      { id: 'b', type: 'activity', title: 'Hotel pool' },
    ],
  });
  assert.deepEqual(items(list), ['Clothes for 1 night', 'Swimwear']);
});

test('the phone line cites each reason and says how many more there are', () => {
  const line = packingLine([
    { item: 'Clothes for 2 nights', because: 'Your dates' },
    { item: 'Walking shoes', because: 'Sunrise hike' },
    { item: 'Swimwear', because: 'Beach morning' },
  ], 2);
  assert.equal(line, 'Clothes for 2 nights, Walking shoes (Sunrise hike), and 1 more');
});

test('a hotel nobody booked has no reference to bring, and a concert nobody bought has no tickets', () => {
  const lines = [
    { id: 'a', type: 'hotel', title: 'The Crawford' },
    { id: 'b', type: 'event', title: 'J. Cole concert' },
    { id: 'c', type: 'flight', title: 'RDU → DEN', held: false },
    { id: 'd', type: 'activity', title: 'Sunrise hike to Royal Arch' },
  ];
  const list = packingList({ startDate: '2026-11-06', endDate: '2026-11-09', lines });
  assert.deepEqual(items(list), ['Clothes for 3 nights', 'Walking shoes']);
  // Held, they are on the list, each citing its line.
  const held = packingList({ startDate: '2026-11-06', endDate: '2026-11-09', lines: lines.map(l => ({ ...l, held: true })) });
  assert.deepEqual(items(held), ['Clothes for 3 nights', "Your hotel's booking reference", 'ID for the airport', 'Walking shoes', 'Your tickets']);
  assert.equal(held.find(i => i.item === 'Your tickets')?.because, 'J. Cole concert');
});
