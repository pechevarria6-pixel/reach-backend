// ─── /api/plans/[planId]/ledger — trip close-out ─────────────────────────
// GET  → per-person totals (contributions + expenses), net of every payment
//        members have marked as paid to each other, and the caller's own
//        settle-up lines ("You owe Sam $42 · Alex owes you $18") with the
//        ways to pay each one. See lib/ledger.ts and lib/money.ts.
// POST { description, amountCents, splitBetween[] } → log an on-trip expense.
//
// Every id here is a `users.id` UUID. `paid_by` used to hold a Clerk id while
// `split_between` held UUIDs from the member list, so the payer and the people
// splitting the bill were never the same person and settle-up was nonsense.
//
// Reach never moves this money. The pay links open the payer's own Venmo or
// Cash App; Zelle has no link, so it is the contact the payee typed for it.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, groupMemberIds, isFail } from '@/lib/auth';
import { loadLedger, settleNote } from '@/lib/ledger';
import { payeesOf, viewerLines, type Handles } from '@/lib/money';

export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;

  const body = await req.json().catch(() => ({}));
  const amountCents = Number(body.amountCents);
  if (!body.description || !Number.isFinite(amountCents) || amountCents <= 0) {
    return NextResponse.json({ error: 'description and a positive amountCents are required' }, { status: 400 });
  }

  // Default to splitting across the whole group, and reject anyone who isn't
  // in it — an unknown id would sit in the ledger owing money forever.
  const members = await groupMemberIds(ctx.db, ctx.plan.group_id as string);
  const requested: string[] = Array.isArray(body.splitBetween) && body.splitBetween.length
    ? body.splitBetween
    : members;
  const splitBetween = requested.filter(id => members.includes(id));
  if (splitBetween.length === 0) {
    return NextResponse.json({ error: 'splitBetween must name at least one group member' }, { status: 400 });
  }

  const { data, error } = await ctx.db.from('expenses').insert({
    plan_id: params.planId,
    group_id: ctx.plan.group_id,
    paid_by: ctx.user.id,
    description: body.description,
    amount_cents: Math.round(amountCents),
    split_between: splitBetween,
  }).select().single();
  if (error) {
    console.error('[plans/planId/ledger] failed', error.code, error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ expense: data });
}

type HandleRow = { id: string; venmo_handle?: string | null; cashtag?: string | null; zelle_contact?: string | null };

export async function GET(_req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const me = ctx.user.id;

  let ledger;
  try {
    ledger = await loadLedger(ctx.db, ctx.plan);
  } catch (e) {
    console.error('[ledger GET]', e instanceof Error ? e.message : 'unknown');
    return NextResponse.json({ error: 'Could not read the ledger' }, { status: 500 });
  }

  // A trip of one has nobody to settle up with. Nothing to settle, no lines,
  // and no prompt to add a Venmo nobody will ever pay into.
  if (ledger.solo) {
    return NextResponse.json({
      solo: true,
      settlementsAvailable: ledger.settlementsAvailable,
      contributions: ledger.contributions,
      expenses: ledger.expenses,
      netBalances: {},
      settleUp: [],
      lines: [],
      people: {},
      you: { hasHandle: false, handlesAvailable: false, askForHandle: false },
    });
  }

  // The handles of the people this caller owes, and the caller's own — the
  // caller's only to say whether they have given one, never to anyone else.
  // viewerLines keeps the rule a second time: it gives pay links only on a
  // line the caller pays, whatever this read returned.
  const payees = payeesOf(me, ledger.lines);
  let handlesAvailable = true;
  const handles: Record<string, Handles> = {};
  let mine: HandleRow | undefined;
  {
    const { data, error } = await ctx.db.from('users')
      .select('id, venmo_handle, cashtag, zelle_contact')
      .in('id', [...payees, me]);
    if (error) {
      // Before sql/settle-up-2026-09-25.sql the columns are not there. Say
      // so, rather than reading it as "nobody has a Venmo".
      handlesAvailable = false;
      if (!/^(42703|PGRST204)$/.test(String(error.code ?? ''))) {
        console.error('[ledger] could not read settle-up handles', error.code);
      }
    }
    for (const r of (data || []) as HandleRow[]) {
      if (r.id === me) { mine = r; continue; }
      handles[r.id] = { venmo: r.venmo_handle, cashtag: r.cashtag, zelle: r.zelle_contact };
    }
  }

  const lines = viewerLines(me, ledger.lines, handles, settleNote(ctx.plan));

  // The names of the people on the caller's lines, which they already see on
  // the group's member list. Nothing else about them.
  const others = [...new Set(lines.map(l => l.with))];
  const people: Record<string, { name: string | null }> = {};
  if (others.length) {
    const { data } = await ctx.db.from('users').select('id, name, first_name').in('id', others);
    for (const u of data || []) people[u.id] = { name: u.first_name || u.name || null };
  }

  const hasHandle = !!(mine && (mine.venmo_handle || mine.cashtag || mine.zelle_contact));
  const owedToMe = lines.some(l => l.direction === 'owed_to_you' && l.amountCents > 0);

  return NextResponse.json({
    solo: false,
    settlementsAvailable: ledger.settlementsAvailable,
    contributions: ledger.contributions,
    expenses: ledger.expenses,
    // After every settlement marked paid; a pending one moves nothing.
    netBalances: ledger.netBalances,
    // The whole group's lines, amounts only — no handles, no pending detail.
    settleUp: ledger.lines.filter(l => l.amountCents > 0).map(({ from, to, amountCents }) => ({ from, to, amountCents })),
    // The caller's own lines, with pay links on the ones they pay.
    lines,
    people,
    you: {
      hasHandle,
      handlesAvailable,
      // "Add your Venmo so friends can pay you back": only to someone who is
      // owed, has not given a way to be paid, and can save one.
      askForHandle: handlesAvailable && owedToMe && !hasHandle,
    },
  });
}
