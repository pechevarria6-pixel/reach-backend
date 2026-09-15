import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createServerClient } from '@/lib/supabase';
import { sendPaymentReceipt, sendFullyFunded } from '@/lib/email';
import Stripe from 'stripe';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'No signature' }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const supabase = createServerClient();

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const intent = event.data.object as Stripe.PaymentIntent;

      // Collect-then-approve contributions live in their own table and have
      // no `payments` row. Mark the share collected, then check whether that
      // was the last one.
      //
      // The checkout screen promised the group "we'll lock everything in the
      // moment the group is fully funded". Nothing watched for that moment,
      // so a fully funded trip sat silent until somebody happened to open the
      // app. Booking is still nobody's but a member's decision — a webhook
      // must not spend their money unprompted — but the moment now arrives.
      if (intent.metadata.kind === 'reach_contribution') {
        await supabase.from('contributions')
          .update({ status: 'succeeded', updated_at: new Date().toISOString() })
          .eq('stripe_payment_intent', intent.id);
        await announceIfFunded(supabase, intent.metadata.plan_id);
        break;
      }

      await supabase.from('payments').update({ status: 'succeeded', stripe_charge_id: intent.latest_charge as string, mfa_verified: intent.metadata.mfa_required === 'true' }).eq('stripe_payment_intent_id', intent.id);

      // Check if all travelers have paid and mark plan booked
      const { data: payments } = await supabase.from('payments').select('user_id').eq('plan_id', intent.metadata.plan_id).eq('status', 'succeeded');
      const { data: members } = await supabase.from('group_members').select('user_id').eq('group_id', (await supabase.from('plans').select('group_id').eq('id', intent.metadata.plan_id).single()).data?.group_id);

      if (payments && members && payments.length >= members.length) {
        await supabase.from('plans').update({ status: 'booked', booked_at: new Date().toISOString() }).eq('id', intent.metadata.plan_id);
      }

      // Send receipt
      const { data: user } = await supabase.from('users').select('email').eq('id', intent.metadata.user_id).single();
      const { data: plan } = await supabase.from('plans').select('title').eq('id', intent.metadata.plan_id).single();
      if (user?.email && plan?.title) {
        await sendPaymentReceipt(user.email, intent.amount, plan.title, intent.id);
      }
      break;
    }
    case 'payment_intent.payment_failed': {
      const intent = event.data.object as Stripe.PaymentIntent;

      if (intent.metadata.kind === 'reach_contribution') {
        await supabase.from('contributions')
          .update({ status: 'failed', updated_at: new Date().toISOString() })
          .eq('stripe_payment_intent', intent.id);
        break;
      }

      await supabase.from('payments').update({ status: 'failed', failure_reason: intent.last_payment_error?.message }).eq('stripe_payment_intent_id', intent.id);
      break;
    }
    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      await supabase.from('payments').update({ status: charge.amount_refunded === charge.amount ? 'refunded' : 'partially_refunded', refund_amount_cents: charge.amount_refunded }).eq('stripe_charge_id', charge.id);
      break;
    }
  }

  return NextResponse.json({ received: true });
}

/**
 * Did that payment complete the pot? If so, flip the plan to approved and
 * tell the group. Every step guards: a plan that cannot be read, a group with
 * no members or an email that will not send must never fail the webhook, or
 * Stripe retries a payment that already succeeded.
 */
async function announceIfFunded(
  supabase: ReturnType<typeof createServerClient>, planId?: string
) {
  if (!planId) return;
  try {
    const { data: bookings } = await supabase
      .from('bookings').select('price_cents,status').eq('plan_id', planId)
      .not('status', 'in', '("failed","cancelled")');
    const targetCents = (bookings || []).reduce((s, b) => s + (b.price_cents || 0), 0);
    if (targetCents <= 0) return;

    const { data: contributions } = await supabase
      .from('contributions').select('amount_cents,status').eq('plan_id', planId);
    const collectedCents = (contributions || [])
      .filter(c => c.status === 'succeeded')
      .reduce((s, c) => s + c.amount_cents, 0);
    if (collectedCents < targetCents) return;

    const { data: plan } = await supabase
      .from('plans').select('id,title,group_id,status').eq('id', planId).single();
    if (!plan) return;
    // Already announced, or already past this point.
    if (plan.status === 'approved' || plan.status === 'booked') return;

    await supabase.from('plans').update({ status: 'approved' }).eq('id', planId);

    const { data: group } = await supabase
      .from('groups').select('name').eq('id', plan.group_id).single();
    const { data: members } = await supabase
      .from('group_members').select('user_id').eq('group_id', plan.group_id);
    const ids = (members || []).map(m => m.user_id);
    if (!ids.length) return;
    const { data: people } = await supabase.from('users').select('email').in('id', ids);

    const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.alcanzar.io').replace(/\/$/, '');
    for (const person of people || []) {
      if (!person.email) continue;
      await sendFullyFunded(person.email, {
        planTitle: plan.title, groupName: group?.name || 'Your group',
        totalCents: collectedCents, url: `${base}/home`,
      });
    }
  } catch (e) {
    console.error('[webhooks/stripe] fully-funded announcement failed', { planId, e });
  }
}
