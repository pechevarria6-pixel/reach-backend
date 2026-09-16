// ─── Who is sitting what out ─────────────────────────────────────────────
// Read by every route that says what somebody owes — funding, participation,
// the reminder email and the ledger — so none of them can quietly forget it.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Skip } from './money.ts';

/** PostgREST's code for a table that does not exist: the migration has not run. */
const NO_TABLE = 'PGRST205';

export async function readSkips(db: SupabaseClient, planId: string): Promise<{ skips: Skip[]; ready: boolean }> {
  const { data, error } = await db.from('item_optouts').select('item_ref, user_id').eq('plan_id', planId);
  // Before sql/preferences-v1.sql runs there is nobody sitting anything out,
  // and every share splits evenly, exactly as it did before this existed.
  if (error?.code === NO_TABLE) return { skips: [], ready: false };
  if (error) {
    // Charging somebody for a dinner they sat out is worse than refusing to
    // charge at all, so a failed read stops the caller rather than reading as
    // "nobody skipped anything".
    console.error('[participation] could not read who is sitting what out', { planId, error: error.message });
    throw new Error('Could not read who is sitting what out');
  }
  return {
    skips: (data || []).map(r => ({ ref: String(r.item_ref), userId: String(r.user_id) })),
    ready: true,
  };
}

export async function planSkips(db: SupabaseClient, planId: string): Promise<Skip[]> {
  return (await readSkips(db, planId)).skips;
}
