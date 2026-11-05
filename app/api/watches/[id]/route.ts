// ─── /api/watches/[id] — one watch: where a notification lands, and stop ─
// GET → 200 { watch, planId, groupId, bookingId, solo, seed }
//   seed: while a table is held for this watch, the reserve route's own
//   terms_required answer for it — { code, hold, button, title, body,
//   changeNote } — so the screen shows the restaurant's policy and the
//   platform's terms and its button posts press two ({ holdId, accept }) to
//   POST /api/bookings/[bookingId]/reserve. Null when nothing is held: a
//   hold that ran out is said as that (watch.said), never shown as live.
// DELETE → 200 { watch }  stopped. A table already held stays held only for
//   what is left of its five minutes, and nothing books it unless they tap.
//
// Only the person who set the watch reads or stops it.
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import { publicHold, tableStateOf } from '@/lib/booking/tables/flow';
import { WATCH_COLUMNS, rowOf } from '@/lib/watch/store';
import { readBooking } from '@/lib/watch/table-server';
import { heldOf } from '@/lib/watch/tables';
import { watchView } from '@/lib/watch/routes';
import { LIVE, missingTable, type WatchRow } from '@/lib/watch/types';

export const dynamic = 'force-dynamic';

async function mine(id: string) {
  const ctx = await requireUser();
  if (isFail(ctx)) return { res: ctx.error };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { res: NextResponse.json({ error: 'Watch not found' }, { status: 404 }) };
  const { data, error } = await ctx.db.from('watches').select(WATCH_COLUMNS).eq('id', id).eq('user_id', ctx.user.id).maybeSingle();
  if (error) {
    if (missingTable(error)) return { res: NextResponse.json({ error: 'Watch not found' }, { status: 404 }) };
    console.error('[watches] could not read a watch', { code: error.code });
    return { res: NextResponse.json({ error: 'Could not read that watch just now.' }, { status: 500 }) };
  }
  if (!data) return { res: NextResponse.json({ error: 'Watch not found' }, { status: 404 }) };
  return { ctx, row: rowOf(data as Record<string, unknown>) };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const got = await mine(params.id);
  if ('res' in got) return got.res;
  const { ctx, row } = got as { ctx: Exclude<Awaited<ReturnType<typeof requireUser>>, { ok: false }>; row: WatchRow };
  const now = new Date();
  let seed: Record<string, unknown> | null = null;
  let groupId: string | null = null;
  let solo = !row.plan_id;
  const held = heldOf(row);
  if (row.booking_id) {
    const { row: b } = await readBooking(ctx.db, row.booking_id);
    if (b) {
      const { data: plan, error } = await ctx.db.from('plans').select('group_id, solo_mode').eq('id', b.plan_id).maybeSingle();
      if (error) console.error('[watches] could not read the plan', { code: error.code });
      groupId = (plan as { group_id?: string | null } | null)?.group_id ?? null;
      solo = (plan as { solo_mode?: boolean } | null)?.solo_mode === true;
      // Live only if the row still holds this very hold and its time has not run out.
      const onRow = tableStateOf(b as never)?.hold ?? null;
      if (row.status === 'held' && held && onRow && onRow.holdId === held.holdId && Date.parse(onRow.expiresAt) > now.getTime()) {
        seed = { code: 'terms_required', hold: publicHold(onRow), button: held.button, title: held.title, body: held.body, changeNote: held.changeNote };
      }
    }
  }
  return NextResponse.json({ watch: watchView(row, now), planId: row.plan_id, groupId, bookingId: row.booking_id, solo, seed });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const got = await mine(params.id);
  if ('res' in got) return got.res;
  const { ctx, row } = got as { ctx: Exclude<Awaited<ReturnType<typeof requireUser>>, { ok: false }>; row: WatchRow };
  if (!(LIVE as string[]).includes(row.status)) return NextResponse.json({ watch: watchView(row) });
  const { data, error } = await ctx.db.from('watches')
    .update({ status: 'stopped', updated_at: new Date().toISOString() })
    .eq('id', row.id).eq('user_id', ctx.user.id).in('status', LIVE as string[])
    .select(WATCH_COLUMNS).maybeSingle();
  if (error) {
    console.error('[watches] could not stop a watch', { code: error.code });
    return NextResponse.json({ error: 'Could not stop it just now. Reach is still watching.' }, { status: 500 });
  }
  return NextResponse.json({ watch: watchView(data ? rowOf(data as Record<string, unknown>) : { ...row, status: 'stopped' }) });
}
