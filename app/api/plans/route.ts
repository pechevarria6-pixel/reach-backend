import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import { toDateOrNull } from '@/lib/dates';
import { z } from 'zod';
import { track } from '@/lib/track';

const CreatePlanSchema = z.object({
  group_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  type: z.enum(['trip', 'restaurant', 'concert', 'weekend']),
  start_date: z.string().nullish(),
  // Where this actually is, in the two parts a hotel provider can search on.
  destination_city: z.string().trim().max(120).nullish(),
  destination_country: z.string().trim().length(2).nullish(),
  end_date: z.string().nullish(),
  budget_cents: z.number().min(0),
  accommodation: z.string().nullish(),
  vibe: z.string().nullish(),
  destination_style: z.string().nullish(),
  dealbreakers: z.array(z.string()).nullish(),
  vote_options: z.array(z.string()).nullish(),
  enable_voting: z.boolean().nullish(),
  // What the organiser wrote when asked what this trip is about. Kept with
  // the plan rather than only on the person, because it is the answer for
  // this trip — and because it is what the readiness gate counts.
  goal_blurb: z.string().trim().max(500).nullish(),
  // What the organiser answered on the trip quiz to get here. Loose on
  // purpose: the quiz's questions are a product decision that changes, and a
  // schema pinned to today's would reject tomorrow's answers.
  trip_answers: z.record(z.unknown()).nullish(),
  // The lines the model wrote about what this option does for whom. Shown on
  // the card they chose from, and worth keeping on the screen they return to.
  why_chosen: z.array(z.string()).nullish(),
  // A trip somebody is taking alone waits for nobody.
  solo_mode: z.boolean().nullish(),
});

// POST /api/plans — create a new plan
export async function POST(req: NextRequest) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  // safeParse, not parse: a throw here surfaces as an opaque 500 and the
  // client cannot tell bad input from a server fault.
  const parsed = CreatePlanSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const body = parsed.data;
  const supabase = ctx.db;

  const user = ctx.user;

  // Verify user is a group member
  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', body.group_id).eq('user_id', user.id).single();
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Built once and inserted twice if need be. why_chosen and solo_mode arrive
  // in migrations, and PostgREST fails the WHOLE insert on a column it does
  // not know — so a migration that had not been run yet would stop anybody
  // creating a trip at all, to keep a line of explanatory text. The trip
  // matters more than the sentence about it.
  const row: Record<string, unknown> = {
    group_id: body.group_id,
    title: body.title,
    type: body.type,
    status: body.enable_voting ? 'voting' : 'planning',
    start_date: toDateOrNull(body.start_date),
    destination_city: body.destination_city || null,
    destination_country: body.destination_country ? body.destination_country.toUpperCase() : null,
    end_date: toDateOrNull(body.end_date),
    budget_cents: body.budget_cents,
    accommodation: body.accommodation || null,
    vibe: body.vibe || null,
    destination_style: body.destination_style || null,
    dealbreakers: body.dealbreakers || [],
    vote_options: body.vote_options || [],
    solo_mode: body.solo_mode === true,
    why_chosen: body.why_chosen?.length ? body.why_chosen : null,
    created_by: user.id,
  };

  const first = await supabase.from('plans').insert(row).select().single();
  // "Could not find the 'x' column" — drop the ones a migration adds and go
  // again, rather than losing the plan.
  const unknownColumn = /could not find the '([a-z_]+)' column|column "?([a-z_]+)"? .*does not exist/i
    .exec(first.error?.message || '');
  let retry = null;
  if (first.error && unknownColumn) {
    const name = unknownColumn[1] || unknownColumn[2];
    console.error('[plans POST] retrying without a column this database does not have yet', { column: name });
    delete row[name];
    retry = await supabase.from('plans').insert(row).select().single();
  }
  const { data: plan, error } = retry ?? first;

  if (error || !plan) {
    console.error('[plans POST] insert failed', error);
    return NextResponse.json({ error: error?.message || 'Failed to create plan' }, { status: 500 });
  }

  // The organiser has now said what this trip is for, which is exactly what
  // the readiness gate is waiting to hear. Recording it here is what makes
  // readiness about this trip rather than about a quiz somebody did once.
  if (body.goal_blurb || body.trip_answers) {
    const { error: prefError } = await supabase.from('plan_preferences').upsert({
      plan_id: plan.id,
      user_id: user.id,
      summary_text: body.goal_blurb || null,
      answers: body.trip_answers ?? null,
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'plan_id,user_id' });
    // Never fatal. A plan that exists without its blurb recorded is a working
    // plan; failing the creation over it would lose the trip instead.
    if (prefError) {
      console.error('[plans POST] could not record the goal', { plan: plan.id, code: prefError.code });
    }
  }

  // An audit trail that loses entries silently is how nine plans once

  // vanished with nothing to read afterwards. Never fails the request; it

  // does have to leave a mark.

  const { error: audit } = await supabase.from('audit_logs').insert({ user_id: user.id, action: 'plan_created', resource: 'plans', resource_id: plan.id, success: true });
  if (audit) console.error('[audit] could not record plan_created', { code: audit.code });

  return NextResponse.json({ plan }, { status: 201 });
}
