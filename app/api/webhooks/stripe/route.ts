import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createServerClient } from '@/lib/supabase';
import { sendPaymentReceipt } from '@/lib/email';
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
