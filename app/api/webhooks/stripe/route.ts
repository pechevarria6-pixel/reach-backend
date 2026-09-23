import { NextRequest, NextResponse } from 'next/server';
import { NOT_CHARGED, chargedRows } from '@/lib/booking/charged';
import { appUrl } from '@/lib/app-url';
import { stripe } from '@/lib/stripe';
import { createServerClient } from '@/lib/supabase';
import { refundOutcome, refundedCentsOf, collectedCents as sumCollected, liveRefundedCents, isMissingColumn, isMissingTable, REFUNDS_MIGRATION, type StripeRefund } from '@/lib/refunds';
import { report } from '@/lib/report';
import { sendPaymentReceipt, sendFullyFunded } from '@/lib/email';
import Stripe from 'stripe';
import { track } from '@/lib/track';

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

  // A refund that fails after it was created — a closed card, a bank that
  // sends it back — used to stay counted as gone: the payment kept saying
  // refunded, the plan undercounted, the payer never got the money and the
  // claim blocked asking again, and nobody was told. Stripe names this event
  // differently across API versions, so all three names come here.
  const type = event.type as string;
  if (type === 'charge.refund.updated' || type === 'refund.updated' || type === 'refund.failed') {
    return refundChanged(supabase, event.data.object as Stripe.Refund);
  }

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
        //
        // Never over a refund: Stripe retries this event for days, and one
        // arriving after the payment was handed back would make the plan
        // count that money again.
        const { error: markPaid } = await supabase.from('contributions')
          .update({ status: 'succeeded', updated_at: new Date().toISOString() })
          .eq('stripe_payment_intent', intent.id)
          .neq('status', 'refunded');
        if (markPaid) {
          console.error('[stripe webhook] MONEY TAKEN BUT NOT RECORDED', {
            intent: intent.id, plan: intent.metadata.plan_id, code: markPaid.code,
          });
        }
        // Emitted here rather than from the screen: a contribution succeeded
        // when Stripe says so, not when a browser believes it did.
        void track(supabase, 'contribution_succeeded', {
          planId: intent.metadata.plan_id ?? null,
          props: { amount_cents: Number(intent.amount_received || intent.amount || 0) },
        });
        await announceIfFunded(supabase, intent.metadata.plan_id);
        break;
      }

      const { error: paid } = await supabase.from('payments').update({ status: 'succeeded', stripe_charge_id: intent.latest_charge as string, mfa_verified: intent.metadata.mfa_required === 'true' }).eq('stripe_payment_intent_id', intent.id);
      if (paid) {
        console.error('[stripe webhook] MONEY TAKEN BUT NOT RECORDED', {
          intent: intent.id, plan: intent.metadata.plan_id, code: paid.code,
        });
      }

      // Check if all travelers have paid and mark plan booked.
      //
      // Reads `payments` deliberately: this whole branch is the legacy
      // one-payment-per-traveller path, whose rows /api/payments writes and
      // this handler updates. It is internally consistent and currently
      // unused — nothing in the client calls /api/payments, and funding
      // writes contributions instead, handled above and returned before
      // reaching here. Left working rather than half-removed, so an intent
      // that does arrive on the old path is still recorded.
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
      //
      // charge.amount_refunded is the authority: it is the running total of
      // every refund on the charge, whether it came from
      // /api/plans/[planId]/funding/refund or from somebody pressing Refund
      // in the Stripe dashboard. It is written as-is into refunded_cents
      // rather than added to it, so a retried event writes the same number
      // twice instead of counting a refund twice. Stripe does not promise
      // order, so an older event (a smaller running total) arriving late
      // never lowers what is already recorded.
      if (intentId) {
        // select('*') so this read works before refunded_cents exists.
        const { data: contribution, error: readError } = await supabase
          .from('contributions')
          .select('*')
          .eq('stripe_payment_intent', intentId)
          .maybeSingle();
        if (readError) {
          console.error('[webhooks/stripe] could not read the contribution for a refund', { intent: intentId, error: readError.message });
        } else if (contribution) {
          const outcome = refundOutcome(
            contribution.amount_cents,
            Math.max(refundedCentsOf(contribution), Number(charge.amount_refunded) || 0),
          );
          const now = new Date().toISOString();
          let { error: writeError } = await supabase.from('contributions')
            .update({ status: outcome.status, refunded_cents: outcome.refundedCents, updated_at: now })
            .eq('id', contribution.id);

          // Before sql/wave1-refunds-2026-09-22.sql there is no column to
          // hold an amount. A whole refund can still be said with the
          // status, as it always was. Part of one cannot — and answering 200
          // for it meant Stripe never sent it again, so the plan counted that
          // money for good. It answers 500 instead: Stripe retries for up to
          // three days, and the event lands once the migration has run.
          if (writeError && isMissingColumn(writeError)) {
            if (outcome.partial) {
              console.error(`[webhooks/stripe] a part refund cannot be recorded until ${REFUNDS_MIGRATION} runs — answering 500 so Stripe sends it again`, {
                contribution: contribution.id, plan: charge.metadata?.plan_id,
                refundedCents: outcome.refundedCents, amountCents: contribution.amount_cents,
              });
              return NextResponse.json({ error: `part refund waits for ${REFUNDS_MIGRATION}` }, { status: 500 });
            } else {
              ({ error: writeError } = await supabase.from('contributions')
                .update({ status: outcome.status, updated_at: now })
                .eq('id', contribution.id));
            }
          }
          if (writeError) {
            // Stripe will retry this event, which is the point of saying so.
            console.error('[webhooks/stripe] could not record a refund on the contribution', { contribution: contribution.id, error: writeError.message });
            return NextResponse.json({ error: 'could not record the refund' }, { status: 500 });
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
      .from('bookings').select('price_cents,status,mode,provider').eq('plan_id', planId)
      .not('status', 'in', NOT_CHARGED);
    const targetCents = chargedRows(bookings).reduce((s, b) => s + (b.price_cents || 0), 0);
    if (targetCents <= 0) return;

    // Net of refunds, and select('*') so a missing refunded_cents column
    // reads as nothing refunded rather than failing the read.
    const { data: contributions } = await supabase
      .from('contributions').select('*').eq('plan_id', planId);
    const collectedCents = sumCollected(contributions || []);
    if (collectedCents < targetCents) return;

    const { data: plan } = await supabase
      .from('plans').select('id,title,group_id,status').eq('id', planId).single();
    if (!plan) return;
    // Already announced, or already past this point.
    if (plan.status === 'approved' || plan.status === 'booked') return;

    void track(supabase, 'plan_fully_funded', {
      groupId: String(plan.group_id), planId,
      props: { collected_cents: collectedCents, target_cents: targetCents },
    });

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

/**
 * A refund's status moved at Stripe. Its row in `refunds` takes Stripe's
 * word for it, which also settles a 'pending' one. When it failed or was
 * cancelled, the money is back in the payment: refunded_cents is rewritten
 * from the refunds Stripe still has live on it — lower, for this event only —
 * the payment is 'succeeded' again if it had read 'refunded', and the owner
 * is told, because the payer is still owed it.
 *
 * Answers 500 on a write that failed, so Stripe sends it again.
 */
async function refundChanged(supabase: ReturnType<typeof createServerClient>, refund: Stripe.Refund) {
  const status = String(refund.status ?? '');
  const now = new Date().toISOString();
  const claimId = refund.metadata?.refund_claim_id;
  const fields = {
    status, stripe_refund_id: refund.id, updated_at: now,
    ...(status === 'failed' || status === 'canceled' ? { error: String(refund.failure_reason ?? status) } : {}),
  };
  if (['pending', 'requires_action', 'succeeded', 'failed', 'canceled'].includes(status)) {
    // By Stripe's id; failing that by the claim id the route put in metadata,
    // for a claim whose answer the route never recorded.
    let { data: moved, error } = await supabase.from('refunds').update(fields).eq('stripe_refund_id', refund.id).select('id');
    if (!error && !moved?.length && claimId) {
      ({ data: moved, error } = await supabase.from('refunds').update(fields).eq('id', claimId).select('id'));
    }
    if (error && !isMissingTable(error)) {
      console.error('[webhooks/stripe] could not record a refund\'s new status', { refund: refund.id, status, code: error.code });
      return NextResponse.json({ error: 'could not record the refund status' }, { status: 500 });
    }
  }
  if (status !== 'failed' && status !== 'canceled') return NextResponse.json({ received: true });

  const intentId = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id;
  report(new Error(`a refund ${status} at Stripe after it was made; the payer has not got the money`), {
    where: 'webhooks/stripe', extra: { refund: refund.id, intent: intentId ?? null, cents: refund.amount, reason: refund.failure_reason ?? null },
  });
  if (!intentId) return NextResponse.json({ received: true });

  const { data: contribution, error: readError } = await supabase
    .from('contributions').select('*').eq('stripe_payment_intent', intentId).maybeSingle();
  if (readError) {
    console.error('[webhooks/stripe] could not read the contribution for a failed refund', { intent: intentId, code: readError.code });
    return NextResponse.json({ error: 'could not read the contribution' }, { status: 500 });
  }
  if (!contribution) return NextResponse.json({ received: true });

  // Stripe's own list of refunds on this payment is the authority on what
  // is still going back; charge.amount_refunded is not relied on to fall.
  let live: number;
  try {
    const list = await stripe.refunds.list({ payment_intent: intentId, limit: 100 });
    live = liveRefundedCents(list.data as StripeRefund[]);
  } catch (e) {
    console.error('[webhooks/stripe] could not list refunds for a failed refund', { intent: intentId, e: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'could not list refunds' }, { status: 500 });
  }
  const outcome = refundOutcome(contribution.amount_cents, live);
  let { error: writeError } = await supabase.from('contributions')
    .update({ status: outcome.status, refunded_cents: outcome.refundedCents, updated_at: now })
    .eq('id', contribution.id);
  if (writeError && isMissingColumn(writeError)) {
    // Before the migration only the status can say it.
    ({ error: writeError } = await supabase.from('contributions')
      .update({ status: outcome.status, updated_at: now }).eq('id', contribution.id));
  }
  if (writeError) {
    console.error('[webhooks/stripe] could not put a failed refund back on the contribution', { contribution: contribution.id, code: writeError.code });
    return NextResponse.json({ error: 'could not record the failed refund' }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
