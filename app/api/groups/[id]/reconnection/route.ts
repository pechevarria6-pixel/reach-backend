// ─── /api/groups/[id]/reconnection — "When did you last see this group in person?" ─
// Business-model §4G M3 and the §3 reconnection metric. Asked once per person
// per group: when they join it, and of the organiser when they create it. The
// answer is a fixed choice (components/pilot/rules.ts RECONNECTION_ANSWERS),
// stored as a `reconnection_answered` event with `answer` in its props. A
// skip is stored as answer 'skipped', so the question is not asked again and
// the readout can say how many people declined rather than losing them.
//
// GET  → 200 { ask: boolean, answer: string | null, available: boolean }
//        available is false while the events table is not there: the
//        question is not asked when its answer has nowhere to go.
// POST { answer } → 200 { answer, already: boolean }
//        once per person per group: a second answer (a double tap, a second
//        phone) gets the first one back, not a second row
//      → 400 not one of the answers · 403 not in this group
//      → 503 the events table is not there, or could not be read
//
// Read-then-write, so two requests in the same instant could both record an
// answer. Nothing moves on it, and the readout SQL takes the earliest answer
// per person per group (docs/pilot/READOUTS.md), which is the same rule this
// route applies.
import { NextRequest, NextResponse } from 'next/server';
import { requireGroupMember, isFail } from '@/lib/auth';
import { track } from '@/lib/track';
import { parseReconnection, refused, tableMissing } from '@/components/pilot/rules';

const EVENT = 'reconnection_answered';

type Ctx = Exclude<Awaited<ReturnType<typeof requireGroupMember>>, { error: unknown }>;

async function earlier(ctx: Ctx) {
  const { data, error } = await ctx.db.from('events').select('props, created_at')
    .eq('name', EVENT).eq('group_id', ctx.groupId).eq('user_id', ctx.user.id)
    .order('created_at', { ascending: true }).limit(1);
  if (error) return { error, missing: tableMissing(error, 'events'), answer: null };
  const props = (data?.[0]?.props ?? null) as { answer?: unknown } | null;
  return { error: null, missing: false, answer: data?.length ? String(props?.answer ?? 'skipped') : null };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireGroupMember(params.id);
  if (isFail(ctx)) return ctx.error;
  const prior = await earlier(ctx);
  if (prior.error && !prior.missing) {
    console.error('[reconnection] could not read an earlier answer', { groupId: params.id, code: prior.error.code });
    return NextResponse.json({ error: 'Could not check that just now.' }, { status: 503 });
  }
  return NextResponse.json({ ask: !prior.missing && prior.answer === null, answer: prior.answer, available: !prior.missing });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireGroupMember(params.id);
  if (isFail(ctx)) return ctx.error;

  const parsed = parseReconnection(await req.json().catch(() => null));
  if (refused(parsed)) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const prior = await earlier(ctx);
  if (prior.error) {
    console.error('[reconnection] could not read an earlier answer', { groupId: params.id, code: prior.error.code, missing: prior.missing });
    return NextResponse.json({ error: "Couldn't save that just now." }, { status: 503 });
  }
  if (prior.answer !== null) return NextResponse.json({ answer: prior.answer, already: true });

  await track(ctx.db, EVENT, { userId: ctx.user.id, groupId: params.id, props: { answer: parsed.value, role: ctx.role } });
  return NextResponse.json({ answer: parsed.value, already: false });
}
