import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase';
import { stripe, toCents } from '@/lib/stripe';
import { z } from 'zod';

const Schema = z.object({
  plan_id: z.string().uuid(),
  split_method: z.enum(['personal', 'wallet', 'split']),
});

// POST /api/payments — create Stripe PaymentIntent
export async function POST(req: NextRequest) {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // safeParse, not parse: a throw here surfaces as an opaque 500 and the
  // client cannot tell bad input from a server fault.
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const body = parsed.data;
  const supabase = createServerClient();

  const { data: user } = await supabase
    .from('users').select('id, email, name, stripe_customer_id, is_minor').eq('clerk_id', clerkId).single();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  if (user.is_minor) return NextResponse.json({ error: 'Payments not available for users under 13' }, { status: 403 });

  const { data: plan } = await supabase.from('plans').select('*, groups(group_members(user_id))').eq('id', body.plan_id).single();
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  // Verify user is a group member
  const planData = plan as any;
  const memberIds = (planData.groups?.group_members || []).map((m: any) => m.user_id);
  if (!memberIds.includes(user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Prevent double charging
  const { data: existing } = await supabase
    .from('payments').select('stripe_payment_intent_id, status').eq('plan_id', body.plan_id).eq('user_id', user.id).eq('status', 'succeeded').single();
  if (existing) return NextResponse.json({ error: 'Already paid' }, { status: 409 });

  // Get or create Stripe customer
  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email, name: user.name || undefined,
      metadata: { clerk_id: clerkId, supabase_user_id: user.id },
    });
    customerId = customer.id;
    await supabase.from('users').update({ stripe_customer_id: customerId }).eq('id', user.id);
  }

  const amountCents = plan.budget_cents;
  const requiresMFA = amountCents > 50000; // $500

  // Create PaymentIntent — secret key stays server-side
  const intent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    customer: customerId,
    payment_method_options: { card: { request_three_d_secure: requiresMFA ? 'any' : 'automatic' } },
    setup_future_usage: 'on_session',
    metadata: { plan_id: body.plan_id, user_id: user.id, clerk_id: clerkId, split_method: body.split_method },
    description: `Reach: ${plan.title}`,
    receipt_email: user.email,
    statement_descriptor_suffix: 'REACH TRAVEL',
  });

  // Record pending payment
  await supabase.from('payments').insert({
    plan_id: body.plan_id, user_id: user.id,
    stripe_payment_intent_id: intent.id,
    amount_cents: amountCents, currency: 'usd',
    status: 'pending', split_method: body.split_method,
  });

  await supabase.from('audit_logs').insert({
    user_id: user.id, action: 'payment_initiated', resource: 'payments', success: true,
    metadata: { stripe_pi: intent.id, amount_cents: amountCents, plan_id: body.plan_id },
  });

  // Return client_secret — browser uses this with Stripe.js
  return NextResponse.json({ client_secret: intent.client_secret, payment_intent_id: intent.id, requires_mfa: requiresMFA });
}
