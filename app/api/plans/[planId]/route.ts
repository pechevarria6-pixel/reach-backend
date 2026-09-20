import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import { toDateOrNull } from '@/lib/dates';
import { impactOfDateChange, describeImpact, needsConfirmation, stillWorksFor } from '@/lib/date-change';
import { z } from 'zod';

const UpdatePlanSchema = z.object({
  // Sent by the organiser on the second call, having read what moving the
  // dates costs. Never stored — it is a decision about this request.
  confirmDateChange: z.boolean().nullish(),
  title: z.string().min(1).max(200).nullish(),
  status: z.enum(['planning','voting','approved','booked','completed','cancelled']).nullish(),
  start_date: z.string().nullish(),
  destination_city: z.string().trim().max(120).nullish(),
  destination_country: z.string().trim().length(2).nullish(),
  end_date: z.string().nullish(),
  budget_cents: z.number().min(0).nullish(),
  accommodation: z.string().nullish(),
  vibe: z.string().nullish(),
  destination_style: z.string().nullish(),
  dealbreakers: z.array(z.string()).nullish(),
  vote_options: z.array(z.string()).nullish(),
});

// GET /api/plans/[id] — get a single plan with itinerary and votes
export async function GET(_: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const supabase = ctx.db;
  const user = ctx.user;

  const { data: plan } = await supabase.from('plans').select('*').eq('id', params.planId).single();
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  // Verify user is in the group
  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', plan.group_id).eq('user_id', user.id).single();
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const [itineraryRes, votesRes, membersRes] = await Promise.all([
    supabase.from('itinerary_items').select('*').eq('plan_id', params.planId).order('sort_order'),
    supabase.from('votes').select('option, user_id').eq('plan_id', params.planId),
    supabase.from('group_members').select('user_id, users(id, name, email, avatar_url)').eq('group_id', plan.group_id),
  ]);

  // Build vote tally
  const tally: Record<string, number> = {};
  votesRes.data?.forEach(v => { tally[v.option] = (tally[v.option] || 0) + 1; });
  const myVote = votesRes.data?.find(v => v.user_id === user.id)?.option || null;

  const participants = (membersRes.data || []).map(m => m.user_id);

  return NextResponse.json({
    plan: { ...plan, participants },
    participants,
    members: membersRes.data || [],
    itinerary: itineraryRes.data || [],
    votes: tally,
    myVote,
    totalVotes: votesRes.data?.length || 0,
  });
}

// PATCH /api/plans/[id] — update a plan
export async function PATCH(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  // safeParse, not parse: a throw here surfaces as an opaque 500 and the
  // client cannot tell bad input from a server fault.
  const parsed = UpdatePlanSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const body = parsed.data;
  const supabase = ctx.db;

  const user = ctx.user;

  const { data: plan } = await supabase.from('plans')
    .select('group_id, start_date, end_date, created_by').eq('id', params.planId).single();
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', plan.group_id).eq('user_id', user.id).single();
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Handle status-specific timestamps
  // confirmDateChange is a decision about this request, not a column.
  const { confirmDateChange: _confirm, ...fields } = body as Record<string, unknown>;
  const updates: any = { ...fields };
  // Same guard as POST /api/plans: never hand Postgres a display string.
  if ('start_date' in updates) updates.start_date = toDateOrNull(updates.start_date);
  if ('end_date' in updates) updates.end_date = toDateOrNull(updates.end_date);
  if (body.status === 'approved') updates.approved_at = new Date().toISOString();
  if (body.status === 'booked') updates.booked_at = new Date().toISOString();

  // ── Moving the dates ──────────────────────────────────────────────────
  // A trip nobody has booked anything for can have its dates edited like any
  // other field. Once there are bookings it is a different act: a hotel is
  // held for particular nights and a table exists at a particular hour, and
  // neither follows the plan when the plan moves.
  const movingStart = 'start_date' in updates && updates.start_date !== plan.start_date;
  const movingEnd = 'end_date' in updates && updates.end_date !== plan.end_date;

  if (movingStart || movingEnd) {
    // Whoever set the trip up moves it. Anybody else in the group asking to
    // is not a bug in their client, it is a decision that is not theirs.
    const organiser = membership.role === 'admin' || plan.created_by === user.id;
    if (!organiser) {
      return NextResponse.json(
        { error: 'Only whoever set this trip up can move its dates.' },
        { status: 403 },
      );
    }

    const nextStart = ('start_date' in updates ? updates.start_date : plan.start_date) ?? null;
    const nextEnd = ('end_date' in updates ? updates.end_date : plan.end_date) ?? null;

    const [{ data: existing }, { data: windows }] = await Promise.all([
      supabase.from('bookings')
        .select('id, vertical, status, mode, provider, detail, fulfilled_by, booked_by')
        .eq('plan_id', params.planId),
      supabase.from('availability_windows')
        .select('user_id, start_date, end_date').eq('plan_id', params.planId),
    ]);

    const impacts = impactOfDateChange(existing ?? []);
    const whoCanCome = nextStart && nextEnd
      ? stillWorksFor(
        (windows ?? []).map(w => ({ userId: String(w.user_id), start: String(w.start_date), end: String(w.end_date) })),
        nextStart, nextEnd,
      )
      : { works: [], out: [] };

    // Shown before anything is written. The organiser confirms with
    // { confirmDateChange: true }, having read what it costs.
    if (needsConfirmation(impacts) && body.confirmDateChange !== true) {
      return NextResponse.json({
        needsConfirmation: true,
        from: { start: plan.start_date, end: plan.end_date },
        to: { start: nextStart, end: nextEnd },
        consequences: describeImpact(impacts),
        worksFor: whoCanCome.works.length,
        outOf: whoCanCome.works.length + whoCanCome.out.length,
        confirmWith: { confirmDateChange: true },
      }, { status: 409 });
    }

    // A price for dates that no longer exist is not a price. Cancelled
    // rather than deleted: the trip's history is worth keeping, and the
    // bridge treats a cancelled row as a line it may quote again.
    const stale = impacts.filter(i => i.consequence === 'requote' && i.bookingId).map(i => i.bookingId as string);
    if (stale.length) {
      const { error: invalidated } = await supabase.from('bookings')
        .update({ status: 'cancelled', itinerary_item_id: null, updated_at: new Date().toISOString() })
        .in('id', stale);
      if (invalidated) {
        console.error('[plans PATCH] could not invalidate quotes for the old dates',
          { planId: params.planId, code: invalidated.code });
      }
    }
  }

  // The error used to be discarded here, so a failed or no-op update answered
  // 200 with { plan: null } and anything writing through this route could
  // silently not save.
  const { data: updated, error: writeError } = await supabase
    .from('plans').update(updates).eq('id', params.planId).select().single();
  if (writeError || !updated) {
    console.error('[plans PATCH] update failed', { planId: params.planId, code: writeError?.code });
    return NextResponse.json({ error: 'Could not save that change' }, { status: 500 });
  }

  if (movingStart || movingEnd) {
    // Who moved a trip, when, and from what — the same reason a deletion is
    // written down.
    const { error: logged } = await supabase.from('audit_logs').insert({
      user_id: user.id, action: 'plan_dates_changed', resource: 'plans',
      resource_id: params.planId, success: true,
      metadata: {
        from: { start: plan.start_date, end: plan.end_date },
        to: { start: updated.start_date, end: updated.end_date },
      },
    });
    if (logged) console.error('[plans PATCH] date change not logged', { planId: params.planId, code: logged.code });
  }

  return NextResponse.json({ plan: updated });
}

// DELETE /api/plans/[id] — delete a plan
export async function DELETE(_: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const supabase = ctx.db;
  const user = ctx.user;

  const { data: plan } = await supabase.from('plans').select('group_id, created_by').eq('id', params.planId).single();
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  // Only creator or group admin can delete
  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', plan.group_id).eq('user_id', user.id).single();
  if (!membership || (membership.role !== 'admin' && plan.created_by !== user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await supabase.from('plans').delete().eq('id', params.planId);
  return NextResponse.json({ success: true });
}
