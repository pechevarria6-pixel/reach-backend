// ─── /api/plans/[planId]/mute — "Mute reminders for this trip" ───────────
// GET → 200 { muted, available }   available is false before the table exists
// PUT { muted: boolean } → 200 { muted }
//   503 { error, available: false } before sql/pings-2026-09-25.sql runs
//
// Only ever the caller's own row: nobody mutes a trip for somebody else.
// The rules are in lib/plan-mute.ts.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { MUTE_SQL, readMute, writeMute } from '@/lib/plan-mute';

export async function GET(_req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const read = await readMute(ctx.db, params.planId, ctx.user.id);
  if (!read.ok) {
    console.error('[mute GET] could not read the switch', { planId: params.planId });
    return NextResponse.json({ error: "Couldn't check your reminders just now." }, { status: 503 });
  }
  return NextResponse.json({ muted: read.muted, available: read.available });
}

export async function PUT(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const body = await req.json().catch(() => null) as { muted?: unknown } | null;
  if (typeof body?.muted !== 'boolean') return NextResponse.json({ error: 'muted must be true or false' }, { status: 400 });
  const wrote = await writeMute(ctx.db, params.planId, ctx.user.id, body.muted);
  if (wrote.ok === false) {
    console.error('[mute PUT] not saved', { planId: params.planId, missing: wrote.missing });
    return wrote.missing
      ? NextResponse.json({ error: `Muting isn't switched on yet — run ${MUTE_SQL}.`, available: false }, { status: 503 })
      : NextResponse.json({ error: "Couldn't save that just now." }, { status: 500 });
  }
  return NextResponse.json({ muted: wrote.muted });
}
