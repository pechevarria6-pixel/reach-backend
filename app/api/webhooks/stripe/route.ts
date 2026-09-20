import { NextRequest, NextResponse } from 'next/server';
import { appUrl } from '@/lib/app-url';
import { stripe } from '@/lib/stripe';
import { createServerClient } from '@/lib/supabase';
import { refundOutcome } from '@/lib/refunds';
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
        // Stripe has taken the money. If this write fails the contribution
        // stays 'pending', the group reads as short, and somebody pays a
        // second time for a share they have already paid. Logged, not
        // thrown: the webhook must answer 200 or Stripe retries for days,
        // and the funds-flow path is not being changed here.
        const { error: markPaid } = await supabase.from('contributions')
          .update({ status: 'succeeded', updated_at: new Date().toISOString() })
          .eq('stripe_payment_intent', intent.id);
        if (markPaid) {
          console.error('[stripe webhook] MONEY TAKEN BUT NOT RECORDED', {
            intent: intent.id, plan: intent.metadata.plan_id, code: markPaid.code,
          });
        }
        await announceIfFunded(supabase, intent.metadata.plan_id);
        break;
      }

      const { error: paid } = await supabase.from('payments').update({ status: 'succeeded', stripe_charge_id: intent.latest_charge as string, mfa_verified: intent.metadata.mfa_required === 'true' }).eq('stripe_payment_intent_id', intent.id);
      if (paid) {
        console.error('[stripe webhook] MONEY TAKEN BUT NOT RECORDED', {
          intent: intent.id, plan: intent.metadata.plan_id, code: paid.code,
        });
      }

      // Check if all travelers have paid and mark plan booked
      const { data: payments } = await supabase.from('payments').select('user_id').eq('plan_id', intent.metadata.plan_id).eq('status', 'succeeded');
      const { data: members } = await supabase.from('group_members').select('user_id').eq('group_id', (await supabase.from('plans').select('group_id').eq('id', intent.metadata.plan_id).single()).data?.group_id);

      if (payments && members && payments.length >= members.length) {
        const { error: booked } = await supabase.from('plans').update({ status: 'booked', booked_at: new Date().toISOString() }).eq('id', intent.metadata.plan_id);
        if (booked) console.error('[stripe webhook] everyone paid but the plan is not marked booked', { plan: intent.metadata.plan_id, code: booked.code });
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
        const { error: contribFailed } = await supabase.from('contributions')
          .update({ status: 'failed', updated_at: new Date().toISOString() })
          .eq('stripe_payment_intent', intent.id);
        if (contribFailed) console.error('[stripe webhook] could not record a failed contribution', { intent: intent.id, code: contribFailed.code });
        break;
      }

      const { error: failed } = await supabase.from('payments').update({ status: 'failed', failure_reason: intent.last_payment_error?.message }).eq('stripe_payment_intent_id', intent.id);
      // A payment left reading 'pending' after it failed is one nobody knows
      // to retry.
      if (failed) console.error('[stripe webhook] could not record a failed payment', { intent: intent.id, code: failed.code });
      break;
    }
    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      const { error: paymentError } = await supabase.from('payments')
        .update({
          status: charge.amount_refunded === charge.amount ? 'refunded' : 'partially_refunded',
          refund_amount_cents: charge.amount_refunded,
        })
        .eq('stripe_charge_id', charge.id);
      if (paymentError) console.error('[webhooks/stripe] could not record a refund against the payment', { charge: charge.id, error: paymentError.message });

      // A contribution is what the funding math counts, and it was never
      // told. A refunded share went on counting towards the target, so a
      // plan could sit there looking funded with the money already handed
      // back — and the approve gate would have spent it.
      const intentId = typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id;
      if (intentId) {
        const { data: contribution, error: readError } = await supabase
          .from('contributions')
          .select('id, amount_cents, status')
          .eq('stripe_payment_intent', intentId)
          .maybeSingle();
        if (readError) {
          console.error('[webhooks/stripe] could not read the contribution for a refund', { intent: intentId, error: readError.message });
        } else if (contribution) {
          const outcome = refundOutcome(contribution.amount_cents, charge.amount_refunded);
          if (outcome.note) {
            console.error('[webhooks/stripe] refund not fully reflected in the funding math', {
              contribution: contribution.id, plan: charge.metadata?.plan_id, note: outcome.note,
            });
          }
          if (outcome.status === 'refunded' && contribution.status !== 'refunded') {
            const { error: writeError } = await supabase.from('contributions')
              .update({ status: 'refunded', updated_at: new Date().toISOString() })
              .eq('id', contribution.id);
            if (writeError) {
              // Stripe will retry this event, which is the point of saying so.
              console.error('[webhooks/stripe] could not mark a contribution refunded', { contribution: contribution.id, error: writeError.message });
              return NextResponse.json({ error: 'could not record the refund' }, { status: 500 });
            }
          }
        }
      }
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

    // The money is in. A plan that does not hear about it sits unapproved
    // with every share collected, and the announcement below would then tell
    // the group their trip was on when nothing had changed. Loud, and it
    // stops here rather than sending that message.
    const { error: approved } = await supabase.from('plans').update({ status: 'approved' }).eq('id', planId);
    if (approved) {
      console.error('[webhooks/stripe] funded but could not approve the plan', { plan: planId, code: approved.code });
      return;
    }

    const { data: group } = await supabase
      .from('groups').select('name').eq('id', plan.group_id).single();
    const { data: members } = await supabase
      .from('group_members').select('user_id').eq('group_id', plan.group_id);
    const ids = (members || []).map(m => m.user_id);
    if (!ids.length) return;
    const { data: people } = await supabase.from('users').select('email').in('id', ids);

    // No request to ask: Stripe called us, not the traveller.
    const base = appUrl();
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
