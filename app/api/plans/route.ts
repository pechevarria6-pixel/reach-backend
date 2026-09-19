import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import { toDateOrNull } from '@/lib/dates';
import { z } from 'zod';

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

  const { data: plan, error } = await supabase.from('plans').insert({
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
    created_by: user.id,
  }).select().single();

  if (error || !plan) {
    console.error('[plans POST] insert failed', error);
    return NextResponse.json({ error: error?.message || 'Failed to create plan' }, { status: 500 });
  }

  // The organiser has now said what this trip is for, which is exactly what
  // the readiness gate is waiting to hear. Recording it here is what makes
  // readiness about this trip rather than about a quiz somebody did once.
  if (body.goal_blurb) {
    const { error: prefError } = await supabase.from('plan_preferences').upsert({
      plan_id: plan.id,
      user_id: user.id,
      summary_text: body.goal_blurb,
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'plan_id,user_id' });
    // Never fatal. A plan that exists without its blurb recorded is a working
    // plan; failing the creation over it would lose the trip instead.
    if (prefError) {
      console.error('[plans POST] could not record the goal', { plan: plan.id, code: prefError.code });
    }
  }

  await supabase.from('audit_logs').insert({ user_id: user.id, action: 'plan_created', resource: 'plans', resource_id: plan.id, success: true });

  return NextResponse.json({ plan }, { status: 201 });
}
