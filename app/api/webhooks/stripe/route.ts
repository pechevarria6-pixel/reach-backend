import { NextRequest, NextResponse } from 'next/server';
import { NOT_CHARGED, chargedRows } from '@/lib/booking/charged';
import { appUrl } from '@/lib/app-url';
import { stripe } from '@/lib/stripe';
import { createServerClient } from '@/lib/supabase';
import { refundOutcome, collectedCents as sumCollected, liveRefundedCents, isMissingColumn, isMissingTable, REFUNDS_MIGRATION, type StripeRefund } from '@/lib/refunds';
import { report } from '@/lib/report';
import { sendPaymentReceipt, sendFullyFunded } from '@/lib/email';
import Stripe from 'stripe';
import { track } from '@/lib/track';
import { markPlanFunded, recordContributionDisputed, recordContributionFailed, recordContributionMove } from '@/lib/contribution-events';
import { methodOf, recordMethod } from '@/lib/contribution-method';
import { contributionMove } from '@/lib/rail/contribution-state';
import { balanceTransactionId, feeOf, feeOfCharge, recordFee } from '@/lib/rail/fees';
import { chargeOfDispute, disputeGaveBack, disputeTookMoney, intentOfDispute } from '@/lib/rail/disputes';

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

  // A bank return or a chargeback (directive P5): the money left Reach's
  // balance when the dispute opened, and came back if it was won.
  if (type.startsWith('charge.dispute.')) {
    return disputeChanged(supabase, type, event.data.object as Stripe.Dispute);
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
        // How it was paid, from the charge that paid it (directive P1), and
        // what Stripe kept of it (P6), from one read of the intent as it is.
        const fresh = await readIntent(intent.id);
        let method = methodOf(intent as never);
        if (!method || method === 'other') method = methodOf(fresh as never) ?? method;
        await recordMethod(supabase, intent.id, method);
        const feeCents = feeOfCharge(fresh?.latest_charge as never);
        await recordFee(supabase, intent.id, feeCents);
        // Emitted here rather than from the screen: a contribution succeeded
        // when Stripe says so, not when a browser believes it did. Method and
        // fee feed the pilot's card-vs-bank mix and fee per trip (§3).
        void track(supabase, 'contribution_succeeded', {
          planId: intent.metadata.plan_id ?? null,
          props: { amount_cents: Number(intent.amount_received || intent.amount || 0), payment_method: method ?? 'unknown', fee_cents: typeof feeCents === 'number' ? feeCents : null },
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
        // Decided against what Stripe says about the payment now, never the
        // event's snapshot (lib/rail/contribution-state.ts): a decline's
        // event arriving after a second card or a bank debit paid must not
        // unpay it, and a bank debit returned after it cleared (an ACH
        // return, directive P5) must. Without Stripe's answer nothing is
        // written and Stripe is asked to send it again.
        const fresh = await readIntent(intent.id);
        if (!fresh) {
          console.error('[stripe webhook] a failed payment could not be read back — answering 500 so Stripe sends it again', { intent: intent.id });
          return NextResponse.json({ error: 'could not read the payment' }, { status: 500 });
        }
        const { data: before, error: readErr } = await supabase.from('contributions')
          .select('id, status, plan_id, amount_cents').eq('stripe_payment_intent', intent.id);
        if (readErr) {
          console.error('[stripe webhook] could not read a contribution that failed', { intent: intent.id, code: readErr.code });
          return NextResponse.json({ error: 'could not read the contribution' }, { status: 500 });
        }
        const { data: moved, error: contribFailed } = await recordContributionFailed(supabase, intent.id, fresh.status);
        if (contribFailed) {
          console.error('[stripe webhook] could not record a failed contribution', { intent: intent.id, code: contribFailed.code });
          return NextResponse.json({ error: 'could not record the failed payment' }, { status: 500 });
        }
        const movedIds = new Set(moved.map(r => String(r.id)));
        const returned = (before ?? []).filter(r => r.status === 'succeeded' && movedIds.has(String(r.id)));
        if (moved.length) {
          void track(supabase, 'contribution_failed', {
            planId: intent.metadata.plan_id ?? null,
            props: { amount_cents: Number(intent.amount || 0), after_cleared: returned.length > 0 },
          });
        }
        if (returned.length) {
          await moneyCameBack(supabase, String(returned[0].plan_id ?? intent.metadata.plan_id ?? ''), {
            how: 'returned', intent: intent.id,
            cents: returned.reduce((s, r) => s + (Number(r.amount_cents) || 0), 0),
          });
        }
        break;
      }

      const { error: failed } = await supabase.from('payments').update({ status: 'failed', failure_reason: intent.last_payment_error?.message }).eq('stripe_payment_intent_id', intent.id);
      // A payment left reading 'pending' after it failed is one nobody knows
      // to retry.
      if (failed) console.error('[stripe webhook] could not record a failed payment', { intent: intent.id, code: failed.code });
      break;
    }
    case 'payment_intent.processing': {
      // A bank debit on its way, for days (directive P2). Not money held,
      // not money owed: the row says 'processing', so approval waits and
      // says "still clearing", and funding never starts a second payment.
      const intent = event.data.object as Stripe.PaymentIntent;
      if (intent.metadata.kind !== 'reach_contribution') break;
      const fresh = await readIntent(intent.id);
      const move = contributionMove('processing', fresh?.status ?? null);
      if (move) {
        const { error: clearing } = await recordContributionMove(supabase, intent.id, move);
        if (clearing) {
          console.error('[stripe webhook] could not mark a bank payment as clearing', { intent: intent.id, code: clearing.code });
          return NextResponse.json({ error: 'could not record the payment clearing' }, { status: 500 });
        }
        void track(supabase, 'contribution_processing', { planId: intent.metadata.plan_id ?? null, props: { amount_cents: Number(intent.amount || 0) } });
      }
      await recordMethod(supabase, intent.id, methodOf((fresh ?? intent) as never));
      break;
    }
    case 'charge.succeeded': {
      // What Stripe kept of a contribution (directive P6), from the charge's
      // balance transaction. A charge that is not a contribution's matches
      // no row and changes nothing.
      const charge = event.data.object as Stripe.Charge;
      const intentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
      if (!intentId) break;
      let fee = feeOfCharge(charge as never);
      const txn = fee === null ? balanceTransactionId(charge as never) : null;
      if (txn) {
        try {
          fee = feeOf(await stripe.balanceTransactions.retrieve(txn) as never);
        } catch (e) {
          // The fee is a measurement, not money; not worth a retry storm.
          console.error('[stripe webhook] could not read the balance transaction for a fee', { intent: intentId, e: e instanceof Error ? e.message : String(e) });
        }
      }
      await recordFee(supabase, intentId, fee);
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
      // Stripe's own list of refunds on the payment, as it stands now, is the
      // authority — every refund, from /api/plans/[planId]/funding/refund or
      // from somebody pressing Refund in the dashboard, less any that failed
      // or were cancelled. It is written as it is, never added to, so a
      // retried event writes the same number twice instead of counting a
      // refund twice.
      //
      // Not the event's own charge.amount_refunded. That is a snapshot from
      // when the event was made, and Stripe retries and does not promise
      // order: a late charge.refunded, kept from falling by Math.max, put the
      // figure back up after charge.refund.updated had lowered it for a
      // refund that failed — and that money was counted as gone for good.
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
          const failed = await recountFromRefunds(supabase, contribution, intentId, charge.metadata?.plan_id);
          if (failed) return failed;
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
    // The money is in. A plan that does not hear about it sits unapproved
    // with every share collected, and the announcement below would then tell
    // the group their trip was on when nothing had changed. Loud, and it
    // stops here rather than sending that message.
    //
    // Moved only from planning, and only by one call: a plan already
    // approved or booked has been announced, and one called off or finished
    // is not brought back by money that cleared late — that is a refund to
    // make, not a trip to announce (lib/contribution-events.ts).
    const funded = await markPlanFunded(supabase, planId);
    if (funded.error) {
      console.error('[webhooks/stripe] funded but could not approve the plan', { plan: planId, code: funded.error.code });
      return;
    }
    if (!funded.moved) {
      if (plan.status === 'cancelled' || plan.status === 'completed') {
        report(new Error(`a payment cleared on a plan that is ${plan.status}; the payer is owed it back`), {
          where: 'webhooks/stripe', extra: { planId, collectedCents, targetCents },
        });
      }
      return;
    }

    void track(supabase, 'plan_fully_funded', {
      groupId: String(plan.group_id), planId,
      props: { collected_cents: collectedCents, target_cents: targetCents },
    });

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
        totalCents: collectedCents, url: `${base}/home`, memberCount: ids.length,
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
    // Never out of failed or canceled: those are final at Stripe, and events
    // arrive in no promised order — a late "succeeded" written over "failed"
    // counted the money as gone for good and locked the payer out of it.
    let { data: moved, error } = await supabase.from('refunds').update(fields).eq('stripe_refund_id', refund.id)
      .not('status', 'in', '("failed","canceled")').select('id');
    if (!error && !moved?.length && claimId) {
      // Only the attempt this refund was made for. There is one row per
      // payment, so an event about attempt 1 arriving after attempt 2 was
      // claimed would otherwise write attempt 1's status and refund id over
      // a claim that is still at Stripe.
      const attempt = Math.max(1, Number(refund.metadata?.attempt ?? 1) || 1);
      ({ data: moved, error } = await supabase.from('refunds').update(fields).eq('id', claimId).eq('attempt', attempt)
        .not('status', 'in', '("failed","canceled")').select('id'));
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

/**
 * Write a contribution's status and refunded_cents from Stripe's own list of
 * refunds on its payment, as it stands now. Returns a response to send when
 * Stripe should send the event again, or null when it is recorded.
 *
 * Used by charge.refunded and by a dispute won: in both, what the payment
 * still holds is the payment less what Stripe has live as refunded.
 */
async function recountFromRefunds(
  supabase: ReturnType<typeof createServerClient>,
  contribution: { id: string; amount_cents: number },
  intentId: string,
  planForLog?: string | null,
): Promise<NextResponse | null> {
  let live: number;
  try {
    const list = await stripe.refunds.list({ payment_intent: intentId, limit: 100 });
    live = liveRefundedCents(list.data as StripeRefund[]);
  } catch (e) {
    // Stripe sends it again; guessing from the event is what this replaced.
    console.error('[webhooks/stripe] could not list refunds for a refunded charge', { intent: intentId, e: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'could not list refunds' }, { status: 500 });
  }
  const outcome = refundOutcome(contribution.amount_cents, live);
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
        contribution: contribution.id, plan: planForLog ?? null,
        refundedCents: outcome.refundedCents, amountCents: contribution.amount_cents,
      });
      return NextResponse.json({ error: `part refund waits for ${REFUNDS_MIGRATION}` }, { status: 500 });
    }
    ({ error: writeError } = await supabase.from('contributions')
      .update({ status: outcome.status, updated_at: now })
      .eq('id', contribution.id));
  }
  if (writeError) {
    // Stripe will retry this event, which is the point of saying so.
    console.error('[webhooks/stripe] could not record a refund on the contribution', { contribution: contribution.id, error: writeError.message });
    return NextResponse.json({ error: 'could not record the refund' }, { status: 500 });
  }
  return null;
}

/** The PaymentIntent as Stripe has it now, with its charge's fee, or null. */
async function readIntent(id: string): Promise<Stripe.PaymentIntent | null> {
  try {
    return await stripe.paymentIntents.retrieve(id, { expand: ['latest_charge.balance_transaction'] });
  } catch (e) {
    console.error('[webhooks/stripe] could not read the payment back from Stripe', { intent: id, e: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/**
 * A dispute opened, had money withdrawn, was reinstated or closed
 * (lib/rail/disputes.ts). Money taken: the contribution is 'refunded' and
 * stops counting. Money given back: counted again, less any real refunds.
 * Answers 500 on a failed read or write, so Stripe sends it again.
 */
async function disputeChanged(supabase: ReturnType<typeof createServerClient>, type: string, dispute: Stripe.Dispute) {
  const took = disputeTookMoney(type, dispute);
  const gave = disputeGaveBack(type, dispute);
  if (!took && !gave) return NextResponse.json({ received: true });

  let intentId = intentOfDispute(dispute);
  const chargeId = chargeOfDispute(dispute);
  if (!intentId && chargeId) {
    try {
      const charge = await stripe.charges.retrieve(chargeId);
      intentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id ?? null;
    } catch (e) {
      console.error('[webhooks/stripe] could not read the charge a dispute is about', { dispute: dispute.id, e: e instanceof Error ? e.message : String(e) });
      return NextResponse.json({ error: 'could not read the disputed charge' }, { status: 500 });
    }
  }
  if (!intentId) return NextResponse.json({ received: true });

  const { data: contribution, error: readError } = await supabase
    .from('contributions').select('*').eq('stripe_payment_intent', intentId).maybeSingle();
  if (readError) {
    console.error('[webhooks/stripe] could not read the contribution a dispute is about', { intent: intentId, code: readError.code });
    return NextResponse.json({ error: 'could not read the contribution' }, { status: 500 });
  }
  // Not a contribution: the legacy payments path, or nothing of ours.
  if (!contribution) return NextResponse.json({ received: true });

  if (took) {
    const { data: moved, error } = await recordContributionDisputed(supabase, intentId);
    if (error) {
      console.error('[webhooks/stripe] could not record money taken back by a dispute', { intent: intentId, code: error.code });
      return NextResponse.json({ error: 'could not record the dispute' }, { status: 500 });
    }
    if (moved.length) {
      void track(supabase, 'contribution_reversed', {
        planId: contribution.plan_id ? String(contribution.plan_id) : null,
        props: { amount_cents: Number(dispute.amount) || Number(contribution.amount_cents) || 0, how: 'dispute' },
      });
      await moneyCameBack(supabase, String(contribution.plan_id ?? ''), {
        how: 'disputed', intent: intentId, cents: Number(dispute.amount) || Number(contribution.amount_cents) || 0,
      });
    }
    return NextResponse.json({ received: true });
  }

  // Given back. Only a row a dispute took off — 'refunded' — is recounted;
  // anything else already says what it holds.
  if (contribution.status !== 'refunded') return NextResponse.json({ received: true });
  const failed = await recountFromRefunds(supabase, contribution, intentId, contribution.plan_id);
  return failed ?? NextResponse.json({ received: true });
}

/**
 * Money that had counted towards a plan is gone again: a bank debit returned
 * after it cleared, or a dispute. Every funding figure is computed from the
 * contributions as they now stand, so the target, the shares and the approve
 * gate already see the gap; what nobody sees is that it happened. The owner
 * is told — with what the plan now holds against what it owes, and whether
 * anything was already bought with that money, which is a loss to recover by
 * hand, not something to book over.
 */
async function moneyCameBack(
  supabase: ReturnType<typeof createServerClient>,
  planId: string,
  what: { how: 'returned' | 'disputed'; intent: string; cents: number },
) {
  if (!planId) return;
  try {
    const [{ data: bookings }, { data: contributions }, { data: plan }] = await Promise.all([
      supabase.from('bookings').select('price_cents,status,mode,provider').eq('plan_id', planId).not('status', 'in', NOT_CHARGED),
      supabase.from('contributions').select('*').eq('plan_id', planId),
      supabase.from('plans').select('id,status').eq('id', planId).maybeSingle(),
    ]);
    const owed = chargedRows(bookings);
    const targetCents = owed.reduce((s, b) => s + (b.price_cents || 0), 0);
    const heldCents = sumCollected(contributions || []);
    const bought = owed.filter(b => b.status === 'confirmed' || b.status === 'booking' || b.status === 'pending').length;
    report(new Error(`a contribution's money was ${what.how === 'returned' ? 'returned by the bank' : 'taken back by a dispute'}; the plan now holds less than it did`), {
      where: 'webhooks/stripe', extra: {
        planId, intent: what.intent, cents: what.cents, planStatus: plan?.status ?? null,
        targetCents, heldCents, shortCents: Math.max(0, targetCents - heldCents), alreadyBought: bought,
      },
    });
  } catch (e) {
    console.error('[webhooks/stripe] could not work out what a returned payment left the plan holding', { planId, e: e instanceof Error ? e.message : String(e) });
  }
}
