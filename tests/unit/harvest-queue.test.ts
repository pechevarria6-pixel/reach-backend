// Which venues the harvester reads tonight, once the weekly map load has
// added thousands it has never read.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueFilter, harvestQueue, readyToRead } from '../../lib/discovery/harvest-queue.ts';

const NOW = Date.parse('2026-09-24T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86400_000).toISOString();
const studio = (id: string, over: Partial<{ last_harvested_at: string | null; harvest_status: string | null; interest: string }> = {}) =>
  ({ id, interest: 'pottery & crafts', last_harvested_at: null, harvest_status: null, ...over });
const harvestable = (i: string) => i !== 'places to eat';

test('a night after the map load still re-reads the venues whose listings people can see', () => {
  const due = Array.from({ length: 30 }, (_, i) => studio(`due${i}`, { last_harvested_at: daysAgo(15), harvest_status: 'ok' }));
  const fresh = Array.from({ length: 60 }, (_, i) => studio(`new${i}`));
  const night = harvestQueue(due, fresh, 20, harvestable, NOW);
  assert.equal(night.length, 20);
  assert.equal(night.filter(v => v.id.startsWith('due')).length, 10, 'half the night is re-reads');
  assert.ok(night.slice(0, 10).every(v => v.id.startsWith('due')), 're-reads first, in case the run is cut short');
});

test('a share one side cannot use goes to the other', () => {
  const due = [studio('due0', { last_harvested_at: daysAgo(15), harvest_status: 'ok' })];
  const fresh = Array.from({ length: 60 }, (_, i) => studio(`new${i}`));
  assert.equal(harvestQueue(due, fresh, 20, harvestable, NOW).length, 20);
  const manyDue = Array.from({ length: 30 }, (_, i) => studio(`due${i}`, { last_harvested_at: daysAgo(15), harvest_status: 'ok' }));
  const night = harvestQueue(manyDue, [studio('new0')], 20, harvestable, NOW);
  assert.equal(night.length, 20);
  assert.equal(night.filter(v => v.id === 'new0').length, 1);
});

test('each venue keeps its own back-off, and a kind not worth reading is not read', () => {
  assert.equal(readyToRead(studio('a', { last_harvested_at: daysAgo(20), harvest_status: 'needs_render' }), harvestable, NOW), false);
  assert.equal(readyToRead(studio('b', { last_harvested_at: daysAgo(50), harvest_status: 'needs_render' }), harvestable, NOW), true);
  assert.equal(readyToRead(studio('c', { interest: 'places to eat' }), harvestable, NOW), false);
  const night = harvestQueue(
    [studio('wait', { last_harvested_at: daysAgo(20), harvest_status: 'blocked' })],
    [studio('menu', { interest: 'places to eat' }), studio('new')],
    20, harvestable, NOW,
  );
  assert.deepEqual(night.map(v => v.id), ['new']);
});

test('the re-read queue asks for venues past their own back-off, never a skipped one', () => {
  const f = dueFilter(NOW);
  // A site that blocked us is left ninety days, not a fortnight: without this
  // a window of month-old blocked sites, oldest first, read nothing all night.
  assert.ok(f.includes(`and(harvest_status.eq.blocked,last_harvested_at.lt.${daysAgo(90)})`), f);
  assert.ok(f.includes(`and(harvest_status.eq.ok,last_harvested_at.lt.${daysAgo(14)})`), f);
  // Unreachable waits a week in the back-off, but nothing is re-read inside a fortnight.
  assert.ok(f.includes(`and(harvest_status.eq.unreachable,last_harvested_at.lt.${daysAgo(14)})`), f);
  assert.ok(!/harvest_status\.eq\.skip/.test(f));
  assert.ok(/not\.in\.\([^)]*skip\)/.test(f), 'a status it does not know waits a fortnight; skip never comes back');
});
