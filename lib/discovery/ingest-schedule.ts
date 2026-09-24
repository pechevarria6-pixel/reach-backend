// ─── Which regions run when, and how the matrix is cut ────────────────────
// .github/workflows/osm-ingest.yml runs every day. Mondays it refreshes every
// region; the other six days it loads only the regions that need it now:
//
//   - a region that has never had a good run — one a new plan put on the
//     list yesterday (a plan to Lyon adds Rhône-Alpes), or one whose first
//     run failed;
//   - a region that gained its first seed since its last good run, so the
//     town somebody has just planned is counted (per_seed) the next morning
//     rather than after Monday;
//   - a region whose last good run is more than OVERDUE_DAYS old, which is a
//     Monday refresh that failed: it is tried again every day until it
//     works, rather than waiting a week for somebody to press a button.
//
// GitHub runs at most 256 jobs from one matrix, so the list is cut into
// batches that run one after another, each at most two at a time
// (Geofabrik's request), and each region is given time by its size.
import { regionMb } from './regions.ts';

/** One job in the workflow's matrix. */
export interface MatrixEntry {
  region: string;
  /** timeout-minutes for this region's job. */
  minutes: number;
}

/** GitHub's own limit is 256 jobs per matrix; this leaves room. */
export const BATCH_SIZE = 200;

/** How many batch jobs the workflow file declares. */
export const BATCHES = 3;

/** For a region added by a seed, whose size nobody measured. */
const UNKNOWN_MINUTES = 150;

/**
 * Time for one region's job, by the size of its download. Measured on the
 * sample loads (docs/INGEST.md): the download, three osmium passes and the
 * writes together ran well under a minute per hundred megabytes, so thirty
 * minutes plus one per fifteen megabytes is several times what any region
 * needs — England, the largest at 1.7 GB, gets 143 — while a job that
 * hangs still ends the same day.
 */
export function regionMinutes(region: string): number {
  const mb = regionMb(region);
  if (mb == null) return UNKNOWN_MINUTES;
  return Math.min(180, Math.max(30, Math.round(30 + mb / 15)));
}

/**
 * The regions cut into the workflow's batches, alphabetically, so the
 * Actions page reads like the list. More than BATCH_SIZE × BATCHES regions
 * is an error, never a silent cut: the workflow fails the listing job and
 * says so, and the fix is another batch job in the workflow file.
 */
export function planBatches(regions: string[], size = BATCH_SIZE, batches = BATCHES): MatrixEntry[][] {
  const sorted = [...new Set(regions)].sort();
  if (sorted.length > size * batches) {
    throw new Error(`${sorted.length} regions is more than ${batches} batches of ${size} — add a batch job to .github/workflows/osm-ingest.yml and raise BATCHES`);
  }
  const out: MatrixEntry[][] = [];
  for (let i = 0; i < batches; i++) {
    out.push(sorted.slice(i * size, (i + 1) * size).map(region => ({ region, minutes: regionMinutes(region) })));
  }
  return out;
}

/**
 * A good run older than this is a weekly refresh that did not happen. Seven
 * and a half, so a region whose Monday run failed is retried on Tuesday
 * morning (last good run: the Monday before, 7 days 22 hours earlier) and a
 * region that ran late on Monday is not (16 hours).
 */
export const OVERDUE_DAYS = 7.5;

export type DueReason = 'never loaded' | 'first seed' | 'overdue';

export interface RunRecord {
  region: string;
  status: string;
  started_at: string;
  per_seed?: Record<string, number> | null;
}

/**
 * The regions a daily run should load, with the reason, from the list and
 * what ingest_runs says happened.
 *
 * "Gained its first seed" is read from the last good run's per_seed, which
 * names every seed the region had when it ran (0 included): an empty or
 * missing per_seed is a run that had none.
 */
export function dueRegions(input: {
  regions: string[];
  seedRegions: Iterable<string>;
  runs: RunRecord[];
  now?: Date;
}): Array<{ region: string; why: DueReason }> {
  const now = (input.now ?? new Date()).getTime();
  const seeded = new Set(input.seedRegions);
  const lastGood = new Map<string, RunRecord>();
  for (const r of input.runs) {
    if (r.status !== 'ok') continue;
    const had = lastGood.get(r.region);
    if (!had || Date.parse(r.started_at) > Date.parse(had.started_at)) lastGood.set(r.region, r);
  }
  const due: Array<{ region: string; why: DueReason }> = [];
  for (const region of [...new Set(input.regions)].sort()) {
    const last = lastGood.get(region);
    if (!last) { due.push({ region, why: 'never loaded' }); continue; }
    const hadSeeds = !!last.per_seed && Object.keys(last.per_seed).length > 0;
    if (seeded.has(region) && !hadSeeds) { due.push({ region, why: 'first seed' }); continue; }
    if (now - Date.parse(last.started_at) > OVERDUE_DAYS * 86400_000) due.push({ region, why: 'overdue' });
  }
  return due;
}
