// ─── Which trips this phone keeps for when there is no signal (UX F19-02) ──
// public/sw.js keeps the last copy of each trip wallet it sees
// (GET /api/plans/<id>/wallet), and public/offline.html lists them on a cold
// start with no network. Until 2026-11-08 nothing ever asked for a wallet, so
// the copy kept "for a desk in an airport with no Wi-Fi" was never made, and
// the app opened offline to a blank page.
//
// The app now asks, quietly, for the trips somebody is about to be on or is
// on: live (not over, not called off), dated, starting within the window.
// A trip months out does not need its confirmation numbers on the phone
// today, and every request is one more read of the booking rows.
//
// No imports: the screen calls this, and node's test runner loads it bare.

export const OFFLINE_WINDOW_DAYS = 45;
export const OFFLINE_MAX_TRIPS = 5;

export interface KeepablePlan {
  id?: unknown;
  status?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whole days from `a` to `b`, both YYYY-MM-DD, read as calendar dates (never UTC instants). */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** A client-made id the server has never seen: asking for its wallet is a 404. */
const isTemp = (id: string) => /^g_local_/.test(id) || /^p\d{10,}$/.test(id);

/**
 * The plan ids to keep a wallet for, soonest first.
 *
 * `todayISO` is the local date (lib/calendar.ts today()), never a UTC one:
 * the UTC day rolls over at 8pm in New York.
 */
export function walletsToKeep(
  groups: { plans?: KeepablePlan[] | null }[] | null | undefined,
  todayISO: string,
  opts: { windowDays?: number; max?: number } = {},
): string[] {
  const windowDays = opts.windowDays ?? OFFLINE_WINDOW_DAYS;
  const max = opts.max ?? OFFLINE_MAX_TRIPS;
  if (!DAY.test(todayISO)) return [];
  const keep: { id: string; start: string }[] = [];
  const seen = new Set<string>();
  for (const g of groups ?? []) {
    for (const p of g?.plans ?? []) {
      const id = typeof p?.id === 'string' ? p.id : null;
      if (!id || seen.has(id) || isTemp(id)) continue;
      if (p.status === 'cancelled' || p.status === 'completed') continue;
      const start = typeof p.startDate === 'string' && DAY.test(p.startDate) ? p.startDate : null;
      if (!start) continue; // undated: nothing booked to need at a desk
      const end = typeof p.endDate === 'string' && DAY.test(p.endDate) ? p.endDate : start;
      if (daysBetween(todayISO, end) < 0) continue; // over
      if (daysBetween(todayISO, start) > windowDays) continue; // not yet
      seen.add(id);
      keep.push({ id, start });
    }
  }
  keep.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return keep.slice(0, max).map(k => k.id);
}
