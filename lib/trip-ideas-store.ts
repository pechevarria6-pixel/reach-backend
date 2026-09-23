// ─── Where a group trip's three ideas are kept ──────────────────────────
// The database half of lib/trip-vote.ts. Every write here is conditional in
// the same statement as the write, because every one of them can race:
//
//   - two members press "Find our trips" at once: both build, the first to
//     save wins, and the second is handed the first's ideas
//   - the three sets of days are written in parallel, each onto the same
//     jsonb: each write names the revision it read, and a write that lost
//     reads again and retries
//   - "Get three different ideas" names the set it replaces, so it cannot
//     replace a set it never saw
//
// Arrives with sql/trip-options-2026-09-23.sql. Until that has run, nothing
// is saved: the ideas are shown to whoever found them and nobody else, and
// every place that happens says so in the log, naming the file.
import type { SupabaseClient } from '@supabase/supabase-js';
import { readIdeas, withDays, type SavedIdeas } from './trip-vote.ts';

export const MIGRATION = 'sql/trip-options-2026-09-23.sql';

type PgError = { code?: string; message?: string } | null | undefined;

/** The column or table this feature adds is not there yet. */
export function notMigrated(e: PgError): boolean {
  if (!e) return false;
  return e.code === '42703' || e.code === 'PGRST204' || e.code === '42P01' || e.code === 'PGRST205'
    || /trip_options|trip_vetoes/.test(e.message || '') && /does not exist|could not find/i.test(e.message || '');
}

export type ReadResult =
  | { available: true; ideas: SavedIdeas | null; undecided: boolean }
  | { available: false; ideas: null; undecided: boolean }
  | { available: true; ideas: null; undecided: boolean; error: string };

export async function readSavedIdeas(db: SupabaseClient, planId: string): Promise<ReadResult> {
  const { data, error } = await db.from('plans').select('trip_options, destination_style').eq('id', planId).maybeSingle();
  if (error) {
    if (notMigrated(error)) {
      console.error(`[trip ideas] plans.trip_options is not there yet — run ${MIGRATION}`);
      return { available: false, ideas: null, undecided: false };
    }
    console.error('[trip ideas] could not read the saved ideas', { planId, code: error.code });
    return { available: true, ideas: null, undecided: false, error: error.code || 'read failed' };
  }
  const row = data as { trip_options?: unknown; destination_style?: string | null } | null;
  return { available: true, ideas: readIdeas(row?.trip_options), undecided: row?.destination_style === 'undecided' };
}

export type SaveResult =
  | { outcome: 'saved'; ideas: SavedIdeas }
  | { outcome: 'taken'; ideas: SavedIdeas | null }
  | { outcome: 'unavailable' }
  | { outcome: 'error' };

/**
 * Saves a set of ideas on an undecided plan and opens the vote. Only onto a
 * plan with no ideas yet, or — for "Get three different ideas" — onto the
 * exact set being replaced. Anything else lost a race, and gets the ideas
 * that won.
 */
export async function saveIdeas(
  db: SupabaseClient, planId: string, ideas: SavedIdeas, replacing: string | null,
): Promise<SaveResult> {
  let q = db.from('plans').update({
    trip_options: ideas,
    // What the existing vote route checks a vote against.
    vote_options: ideas.options.map(o => o.title),
    status: 'voting',
    updated_at: new Date().toISOString(),
  }).eq('id', planId).eq('destination_style', 'undecided');
  q = replacing ? q.eq('trip_options->>set', replacing) : q.is('trip_options', null);
  const { data, error } = await q.select('id').maybeSingle();
  if (error) {
    if (notMigrated(error)) {
      console.error(`[trip ideas] could not save the ideas: plans.trip_options is not there yet — run ${MIGRATION}`);
      return { outcome: 'unavailable' };
    }
    console.error('[trip ideas] could not save the ideas', { planId, code: error.code });
    return { outcome: 'error' };
  }
  if (data) return { outcome: 'saved', ideas };
  const again = await readSavedIdeas(db, planId);
  return { outcome: 'taken', ideas: again.ideas };
}

/**
 * Writes one idea's days into the saved set. Three of these run at once, so
 * each names the revision it read; one that lost to another reads again.
 */
export async function attachDays(
  db: SupabaseClient, planId: string, optionId: string, days: unknown[],
): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const read = await readSavedIdeas(db, planId);
    // Picked already: the days go on the trip itself, not on an idea.
    if (!read.ideas || !read.undecided) return false;
    const next = withDays(read.ideas, optionId, days);
    if (!next) return false;
    const { data, error } = await db.from('plans').update({ trip_options: next })
      .eq('id', planId).eq('destination_style', 'undecided')
      .eq('trip_options->>set', read.ideas.set)
      .eq('trip_options->>rev', String(read.ideas.rev))
      .select('id').maybeSingle();
    if (error) {
      console.error('[trip ideas] could not save the days of an idea', { planId, optionId, code: error.code });
      return false;
    }
    if (data) return true;
  }
  console.error('[trip ideas] gave up saving the days of an idea after five goes', { planId, optionId });
  return false;
}

/** Everybody's votes and vetoes, cleared for a fresh set. */
export async function clearVotes(db: SupabaseClient, planId: string): Promise<boolean> {
  const [{ error: v }, { error: x }] = await Promise.all([
    db.from('votes').delete().eq('plan_id', planId),
    db.from('trip_vetoes').delete().eq('plan_id', planId),
  ]);
  if (v) console.error('[trip ideas] could not clear the votes for the new ideas', { planId, code: v.code });
  if (x && !notMigrated(x)) console.error('[trip ideas] could not clear the vetoes for the new ideas', { planId, code: x.code });
  return !v && (!x || notMigrated(x));
}

export type VetoRead = { available: boolean; rows: Array<{ user_id: string; option: string }>; error?: string };

export async function readVetoes(db: SupabaseClient, planId: string): Promise<VetoRead> {
  const { data, error } = await db.from('trip_vetoes').select('user_id, option').eq('plan_id', planId);
  if (error) {
    if (notMigrated(error)) {
      console.error(`[trip ideas] trip_vetoes is not there yet — run ${MIGRATION}`);
      return { available: false, rows: [] };
    }
    console.error('[trip ideas] could not read the vetoes', { planId, code: error.code });
    return { available: true, rows: [], error: error.code || 'read failed' };
  }
  return { available: true, rows: (data ?? []).map(r => ({ user_id: String(r.user_id), option: String(r.option) })) };
}

export interface Member { userId: string; role: string; name: string }

export async function membersOf(db: SupabaseClient, groupId: string): Promise<Member[] | null> {
  const { data, error } = await db.from('group_members').select('user_id, role, users(name)').eq('group_id', groupId);
  if (error) {
    console.error('[trip ideas] could not read the group', { groupId, code: error.code });
    return null;
  }
  return (data ?? []).map(m => {
    const u = (Array.isArray(m.users) ? m.users[0] : m.users) as { name?: string } | null;
    return { userId: String(m.user_id), role: String(m.role || 'member'), name: String(u?.name || '') };
  });
}

export function firstName(name: string): string {
  return String(name || '').trim().split(/\s+/)[0] || 'Someone';
}

/**
 * Who makes the pick, by name, for "Waiting for Sam to pick". Whoever set the
 * trip up, while they are still in the group; otherwise the group's admin.
 */
export function organiserOf(members: Member[], createdBy: string | null): Member | null {
  return members.find(m => createdBy && m.userId === createdBy)
    ?? members.find(m => m.role === 'admin')
    ?? null;
}

/** Everyone who counts as the organiser — told when everyone has voted. */
export function organisersOf(members: Member[], createdBy: string | null): string[] {
  return members.filter(m => m.role === 'admin' || (createdBy && m.userId === createdBy)).map(m => m.userId);
}
