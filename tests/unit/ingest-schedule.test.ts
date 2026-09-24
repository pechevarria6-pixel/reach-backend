// Which regions run when, how the matrix is cut, and that the workflow file
// is the shape the schedule assumes.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  dueRegions, planBatches, regionMinutes, BATCHES, BATCH_SIZE, OVERDUE_DAYS,
} from '../../lib/discovery/ingest-schedule.ts';
import { baseRegions, knownRegions, regionList } from '../../lib/discovery/regions.ts';

const NC = 'north-america/us/north-carolina';
const PR = 'north-america/us/puerto-rico';
const LYON = 'europe/france/rhone-alpes';
const TUESDAY = new Date('2026-09-29T04:43:00Z');

test('a daily run loads what has never loaded, what gained its first seed, and what is overdue — nothing else', () => {
  const due = dueRegions({
    regions: [NC, PR, LYON, 'north-america/us/utah', 'north-america/us/texas'],
    seedRegions: [NC, LYON, 'north-america/us/utah'],
    now: TUESDAY,
    runs: [
      // Loaded yesterday with its seeds: not due.
      { region: NC, status: 'ok', started_at: '2026-09-28T06:17:00Z', per_seed: { Raleigh: 812 } },
      // Loaded yesterday with no seeds, and has none: not due.
      { region: PR, status: 'ok', started_at: '2026-09-28T06:17:00Z', per_seed: {} },
      // Loaded with no seeds; somebody has since planned Moab.
      { region: 'north-america/us/utah', status: 'ok', started_at: '2026-09-28T06:17:00Z', per_seed: {} },
      // Monday's run failed; the last good one is the Monday before.
      { region: 'north-america/us/texas', status: 'failed', started_at: '2026-09-28T06:17:00Z' },
      { region: 'north-america/us/texas', status: 'ok', started_at: '2026-09-21T06:17:00Z', per_seed: {} },
      // A failed first run of Lyon is not a load.
      { region: LYON, status: 'failed', started_at: '2026-09-28T06:17:00Z' },
    ],
  });
  assert.deepEqual(due, [
    { region: LYON, why: 'never loaded' },
    { region: 'north-america/us/texas', why: 'overdue' },
    { region: 'north-america/us/utah', why: 'first seed' },
  ]);
});

test('a region that ran late on Monday is not overdue on Tuesday', () => {
  const due = dueRegions({
    regions: [NC], seedRegions: [NC], now: TUESDAY,
    runs: [{ region: NC, status: 'ok', started_at: '2026-09-28T12:40:00Z', per_seed: { Raleigh: 1 } }],
  });
  assert.deepEqual(due, []);
  assert.ok(OVERDUE_DAYS > 7 && OVERDUE_DAYS < 8);
});

test('the list builds itself: every state and territory, the UK, Mexico, the world list, and every seed', () => {
  const base = baseRegions();
  for (const r of ['north-america/us/alabama', 'north-america/us/wyoming', 'north-america/us/district-of-columbia',
    PR, 'north-america/us/us-virgin-islands', 'europe/united-kingdom/england', 'europe/united-kingdom/scotland',
    'europe/united-kingdom/wales', 'north-america/mexico', 'europe/france/ile-de-france', 'asia/jordan', 'south-america/peru']) {
    assert.ok(base.includes(r), r);
  }
  assert.equal(base.filter(r => r.startsWith('north-america/us/')).length, 53, '50 states, DC, Puerto Rico and the US Virgin Islands');
  const list = regionList([LYON, 'not/a-region']);
  assert.ok(list.includes(LYON), 'a plan to Lyon puts Rhône-Alpes on the list');
  assert.equal(list.includes('not/a-region'), false, 'a path nothing knows is never read');
  assert.equal(list.length, base.length + 1);
});

test('the matrix is cut under GitHub\'s 256-job limit, and too many regions is an error, not a silent cut', () => {
  assert.ok(BATCH_SIZE <= 256);
  const all = knownRegions();
  assert.ok(all.length <= BATCH_SIZE * BATCHES, `${all.length} loadable files do not fit ${BATCHES} batches of ${BATCH_SIZE}`);
  const batches = planBatches(all);
  assert.equal(batches.length, BATCHES);
  assert.ok(batches.every(b => b.length <= BATCH_SIZE));
  assert.equal(batches.flat().length, all.length);
  assert.equal(new Set(batches.flat().map(e => e.region)).size, all.length, 'no region twice');
  assert.throws(() => planBatches(Array.from({ length: 7 }, (_, i) => `r${i}`), 3, 2), /more than 2 batches of 3/);
});

test('each region gets time by its size, and none more than the job can have', () => {
  assert.equal(regionMinutes('north-america/us/us-virgin-islands'), 30);
  assert.equal(regionMinutes('europe/united-kingdom/england'), 143);
  assert.ok(regionMinutes('europe/france/rhone-alpes') >= 120, 'a size nobody measured gets the long allowance');
  for (const r of knownRegions()) assert.ok(regionMinutes(r) >= 30 && regionMinutes(r) <= 180, r);
});

// ── The workflow file is what the schedule assumes ────────────────────

const workflow = readFileSync(new URL('../../.github/workflows/osm-ingest.yml', import.meta.url), 'utf8');
const regionJob = readFileSync(new URL('../../.github/workflows/osm-ingest-region.yml', import.meta.url), 'utf8');

test('the workflow runs daily and refreshes everything on Mondays, with no sub-daily cron', () => {
  const crons = [...workflow.matchAll(/cron: '([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(crons, ['17 6 * * 1', '43 4 * * 0,2-6']);
  assert.match(workflow, /if \[ "\$SCHEDULE" = "17 6 \* \* 1" \]; then mode=all; else mode=due; fi/);
});

test('one batch job per batch, each two at a time, each running whatever the batch before did', () => {
  const jobs = [...workflow.matchAll(/^ {2}batch-(\d+):$/gm)].map(m => Number(m[1]));
  assert.deepEqual(jobs, Array.from({ length: BATCHES }, (_, i) => i + 1));
  for (let i = 1; i <= BATCHES; i++) assert.match(workflow, new RegExp(`batch${i}: \\$\\{\\{ steps\\.list\\.outputs\\.batch${i} \\}\\}`));
  assert.equal((workflow.match(/max-parallel: 2/g) ?? []).length, BATCHES);
  assert.equal((workflow.match(/fail-fast: false/g) ?? []).length, BATCHES);
  assert.equal((workflow.match(/if: \$\{\{ !cancelled\(\) && needs\.plan\.result == 'success'/g) ?? []).length, BATCHES,
    'a red region in one batch never stops the next');
  assert.doesNotMatch(workflow, /max-parallel: [3-9]/);
  // The guard that stops accept_drop switching the half-of-last-time check
  // off for every region at once.
  assert.match(workflow, /if \[ "\$ACCEPT_DROP" = "true" \] && \[ -z "\$\{ONLY_REGION\/\/ \/\}" \]; then\s+echo "::error::accept_drop needs a region/);
});

test('the one-region job is timed by the plan, and keeps a download only for the re-run of a failure', () => {
  assert.match(regionJob, /timeout-minutes: \$\{\{ inputs\.minutes \}\}/);
  assert.match(regionJob, /if: failure\(\) && steps\.pbf\.outputs\.cache-hit != 'true'/);
  assert.doesNotMatch(regionJob, /uses: actions\/cache@/, 'never the save-on-success cache');
  // Secrets reach a step only through env, never interpolated into run.
  for (const file of [workflow, regionJob]) {
    for (const m of file.matchAll(/run: \|?([\s\S]*?)(?=\n {6}- |\n {2}\S|$)/g)) {
      assert.doesNotMatch(m[1], /secrets\./, 'a secret inside a run: block');
    }
  }
});
