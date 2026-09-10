import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import { z } from 'zod';

// The client stores dates as display strings ("Sat, Mar 8", "Dates TBD").
// Anything that isn't a real calendar date becomes NULL rather than blowing up
// the INSERT with a Postgres date-parse error and silently losing the plan.
function toDateOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().split('T')[0];
}

const CreatePlanSchema = z.object({
  group_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  type: z.enum(['trip', 'restaurant', 'concert', 'weekend']),
  start_date: z.string().nullish(),
  end_date: z.string().nullish(),
  budget_cents: z.number().min(0),
  accommodation: z.string().nullish(),
  vibe: z.string().nullish(),
  destination_style: z.string().nullish(),
  dealbreakers: z.array(z.string()).nullish(),
  vote_options: z.array(z.string()).nullish(),
  enable_voting: z.boolean().nullish(),
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
    end_date: toDateOrNull(body.end_date),
    budget_cents: body.budget_cents,
    accommodation: body.accommodation || null,
    vibe: body.vibe || null,
    destination_style: body.destination_style || null,
    dealbreakers: body.dealbreakers || [],
    vote_options: body.vote_options || [],
    created_by: user.id,
  }).select().single();

  if (error || !plan) {
    console.error('[plans POST] insert failed', error);
    return NextResponse.json({ error: error?.message || 'Failed to create plan' }, { status: 500 });
  }

  await supabase.from('audit_logs').insert({ user_id: user.id, action: 'plan_created', resource: 'plans', resource_id: plan.id, success: true });

  return NextResponse.json({ plan }, { status: 201 });
}
