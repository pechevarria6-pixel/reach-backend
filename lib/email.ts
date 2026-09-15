// ─── Email ───────────────────────────────────────────────────────────────
// Every message Reach sends. Three things were wrong with the old version and
// all three could only be found by looking:
//
//   1. A missing RESEND_API_KEY threw inside whatever route was sending, so a
//      configuration gap surfaced as an unrelated failure — or was swallowed
//      by a caller's catch and looked like nothing happened.
//   2. The from address defaulted to a domain Reach does not own.
//   3. The booking confirmation pasted raw JSON into the customer's email.
//
// Sending is always best-effort: it reports what happened and never throws
// into a request that was doing something more important.
import { Resend } from 'resend';
import { emailButtonStyle } from '@/lib/brand';

const FROM = process.env.EMAIL_FROM || 'Reach <hello@alcanzar.io>';
const SUPPORT = 'hello@alcanzar.io';

// One shape rather than a discriminated union: this project compiles with
// `strict` off, which disables the literal-type narrowing a union relies on,
// and turning strict on across 5,000 lines is not a change to make in passing.
export type SendResult = {
  sent: boolean;
  id?: string;
  reason?: 'no_key' | 'rejected' | 'error';
  detail?: string;
};

function escape(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

const shell = (title: string, body: string) => `
  <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#241C10;">
    <div style="font-size:20px;letter-spacing:-.01em;margin-bottom:20px;color:#8A6512;">reach</div>
    <h1 style="font-size:22px;font-weight:600;line-height:1.25;margin:0 0 14px;">${title}</h1>
    ${body}
    <p style="color:#7E6F52;font-size:12.5px;line-height:1.6;margin-top:28px;border-top:1px solid #E5DCCA;padding-top:16px;">
      Sent by Reach &middot; <a href="https://www.alcanzar.io" style="color:#8A6512;">alcanzar.io</a><br>
      Questions? Reply to this email or write to ${SUPPORT}.
    </p>
  </div>`;

async function send(to: string, subject: string, html: string, label: string): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // Loud but harmless: the request that triggered this carries on.
    console.error(`[email] ${label} not sent — RESEND_API_KEY is not set`);
    return { sent: false, reason: 'no_key' };
  }
  try {
    const { data, error } = await new Resend(key).emails.send({ from: FROM, to, subject, html });
    if (error) {
      console.error(`[email] ${label} rejected`, error);
      return { sent: false, reason: 'rejected', detail: error.message };
    }
    return { sent: true, id: data?.id };
  } catch (e: any) {
    console.error(`[email] ${label} failed`, e?.message ?? e);
    return { sent: false, reason: 'error', detail: e?.message };
  }
}

// ── Money ────────────────────────────────────────────────────────────────

export function sendPaymentReceipt(to: string, amountCents: number, planTitle: string, stripeId: string) {
  const amount = `$${(amountCents / 100).toFixed(2)}`;
  return send(to, `Receipt for ${planTitle} — ${amount}`, shell('Payment received', `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">
      We've received <strong>${amount}</strong> towards <strong>${escape(planTitle)}</strong>.
    </p>
    <table style="width:100%;font-size:14px;border-collapse:collapse;">
      <tr><td style="padding:8px 0;color:#635539;">Amount</td><td style="padding:8px 0;text-align:right;"><strong>${amount}</strong></td></tr>
      <tr><td style="padding:8px 0;color:#635539;">Trip</td><td style="padding:8px 0;text-align:right;">${escape(planTitle)}</td></tr>
      <tr><td style="padding:8px 0;color:#635539;">Reference</td><td style="padding:8px 0;text-align:right;font-family:monospace;font-size:12px;">${escape(stripeId)}</td></tr>
    </table>
    <p style="font-size:14px;color:#635539;line-height:1.6;margin-top:16px;">
      Keep this for your records. Your share is held by Stripe and goes to the people being paid — Reach never holds it.
    </p>`), 'payment receipt');
}

/** Somebody still owes their share, and nothing books until everybody is in. */
export function sendFundingNeeded(to: string, opts: { planTitle: string; groupName: string; shareCents: number; url: string }) {
  const share = `$${(opts.shareCents / 100).toFixed(2)}`;
  return send(to, `Your share for ${opts.planTitle} — ${share}`, shell('Your share is ready to pay', `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">
      <strong>${escape(opts.groupName)}</strong> is booking <strong>${escape(opts.planTitle)}</strong>.
      Your share is <strong>${share}</strong>.
    </p>
    <p style="font-size:14px;color:#635539;line-height:1.6;margin:0 0 20px;">
      Nothing is booked until everyone has paid, so the trip is waiting on this.
    </p>
    <a href="${escape(opts.url)}" style="${emailButtonStyle}">Pay your share</a>`), 'funding needed');
}

// ── Coordination ─────────────────────────────────────────────────────────

/** A plan is open for votes and this person has not voted. */
export function sendVoteNeeded(to: string, opts: { planTitle: string; groupName: string; options: string[]; url: string }) {
  const list = opts.options.slice(0, 6).map(o =>
    `<li style="padding:3px 0;">${escape(o)}</li>`).join('');
  return send(to, `${opts.groupName} needs your vote`, shell('Where should you go?', `
    <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">
      <strong>${escape(opts.groupName)}</strong> is deciding on <strong>${escape(opts.planTitle)}</strong>
      and is waiting on you.
    </p>
    ${list ? `<ul style="font-size:14px;color:#635539;margin:0 0 20px;padding-left:20px;">${list}</ul>` : ''}
    <a href="${escape(opts.url)}" style="${emailButtonStyle}">Cast your vote</a>`), 'vote needed');
}

export function sendBookingConfirmation(to: string, opts: {
  planTitle: string;
  items: Array<{ label: string; detail?: string | null; confirmation?: string | null }>;
  url: string;
}) {
  // This used to paste JSON.stringify(details) into a <pre> block and send it
  // to a customer.
  const rows = opts.items.map(i => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #EFE8DA;">
        <div style="font-weight:600;font-size:14px;">${escape(i.label)}</div>
        ${i.detail ? `<div style="font-size:13px;color:#635539;margin-top:2px;">${escape(i.detail)}</div>` : ''}
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #EFE8DA;text-align:right;font-family:monospace;font-size:12px;color:#635539;white-space:nowrap;">
        ${i.confirmation ? escape(i.confirmation) : ''}
      </td>
    </tr>`).join('');

  return send(to, `Confirmed — ${opts.planTitle}`, shell("You're booked", `
    <p style="font-size:15px;line-height:1.6;margin:0 0 18px;">
      Everything for <strong>${escape(opts.planTitle)}</strong> is confirmed. Here is what was booked.
    </p>
    <table style="width:100%;border-collapse:collapse;">${rows}</table>
    <p style="margin-top:22px;"><a href="${escape(opts.url)}" style="${emailButtonStyle}">Open your itinerary</a></p>`),
  'booking confirmation');
}

// ── Account ──────────────────────────────────────────────────────────────

export function sendDeletionConfirmation(to: string, deletionDate: string) {
  return send(to, 'Your Reach account will be deleted', shell('Deletion scheduled', `
    <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">
      Your account and everything in it will be permanently deleted on <strong>${escape(deletionDate)}</strong>.
    </p>
    <p style="font-size:14px;color:#635539;line-height:1.6;">
      Records of payments already taken are kept where tax law requires it. Everything else goes.
      If you did not ask for this, write to ${SUPPORT} straight away and we will stop it.
    </p>`), 'deletion confirmation');
}

export function sendGroupInvite(
  to: string,
  opts: { groupName: string; groupEmoji?: string | null; inviterName?: string | null; acceptUrl: string },
) {
  const who = opts.inviterName ? `${escape(opts.inviterName)} invited you` : 'You have been invited';
  return send(to, `${opts.inviterName ?? 'Someone'} invited you to ${opts.groupName} on Reach`,
    shell(`${opts.groupEmoji || '✈️'} ${escape(opts.groupName)}`, `
      <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">${who} to plan trips together on Reach.</p>
      <a href="${escape(opts.acceptUrl)}" style="${emailButtonStyle}">Join ${escape(opts.groupName)}</a>
      <p style="color:#7E6F52;font-size:13px;line-height:1.6;margin-top:18px;">
        Signing in with this address joins you automatically — the link is just a shortcut.
        The invitation expires in 30 days.
      </p>`), 'group invite');
}

/**
 * The whole trip as an email: every day, every cost, and what each place
 * takes. A group needs this somewhere they can find it on the day — in a
 * pocket, on a plane, with no signal and no app open.
 */
export function sendItinerary(to: string, opts: {
  planTitle: string;
  dates: string;
  groupName: string;
  fixed: Array<{ title: string; detail?: string | null; cents: number }>;
  days: Array<{ when: string; title: string; payment?: string | null; cents: number }>;
  url: string;
}) {
  const money = (c: number) => `$${Math.round(c / 100).toLocaleString()}`;
  const fixedTotal = opts.fixed.reduce((a, f) => a + f.cents, 0);
  const dayTotal = opts.days.reduce((a, d) => a + d.cents, 0);

  const fixedRows = opts.fixed.map(f => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #EFE8DA;">
        <div style="font-size:14px;">${escape(f.title)}</div>
        ${f.detail ? `<div style="font-size:12px;color:#635539;margin-top:1px;">${escape(f.detail)}</div>` : ''}
      </td>
      <td style="padding:8px 0;border-bottom:1px solid #EFE8DA;text-align:right;font-size:14px;white-space:nowrap;">${money(f.cents)}</td>
    </tr>`).join('');

  // Cash-only is called out inline, because knowing you need notes for dinner
  // is only useful before dinner.
  const dayRows = opts.days.map(d => {
    const cash = d.payment && /cash only/i.test(d.payment);
    return `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #EFE8DA;">
        <div style="font-size:11px;color:#7E6F52;text-transform:uppercase;letter-spacing:.06em;">${escape(d.when)}</div>
        <div style="font-size:14px;margin-top:2px;">${escape(d.title)}</div>
        ${d.payment ? `<div style="font-size:12px;margin-top:2px;color:${cash ? '#8A5A0B' : '#635539'};">${cash ? '&#128181; ' : ''}${escape(d.payment)}</div>` : ''}
      </td>
      <td style="padding:8px 0;border-bottom:1px solid #EFE8DA;text-align:right;font-size:14px;white-space:nowrap;">${d.cents ? money(d.cents) : ''}</td>
    </tr>`;
  }).join('');

  return send(to, `${opts.planTitle} — your itinerary`, shell(escape(opts.planTitle), `
    <p style="font-size:15px;line-height:1.6;margin:0 0 4px;">${escape(opts.dates)}</p>
    <p style="font-size:13px;color:#635539;margin:0 0 24px;">${escape(opts.groupName)}</p>

    ${fixedRows ? `
      <h2 style="font-size:15px;font-weight:600;margin:0 0 4px;">Reach will book these</h2>
      <p style="font-size:12.5px;color:#635539;margin:0 0 8px;">Paid once the group funds the trip.</p>
      <table style="width:100%;border-collapse:collapse;">${fixedRows}</table>
      <p style="text-align:right;font-size:14px;font-weight:600;margin:8px 0 26px;">${money(fixedTotal)} per person</p>` : ''}

    <h2 style="font-size:15px;font-weight:600;margin:0 0 4px;">Day by day</h2>
    <p style="font-size:12.5px;color:#635539;margin:0 0 8px;">What you spend as you go. Estimates, not a bill.</p>
    <table style="width:100%;border-collapse:collapse;">${dayRows}</table>
    <p style="text-align:right;font-size:14px;font-weight:600;margin:8px 0 26px;">${money(dayTotal)} per person</p>

    <table style="width:100%;border-collapse:collapse;border-top:2px solid #241C10;">
      <tr>
        <td style="padding:12px 0;font-size:15px;font-weight:600;">Per person, all in</td>
        <td style="padding:12px 0;text-align:right;font-size:17px;font-weight:700;">${money(fixedTotal + dayTotal)}</td>
      </tr>
    </table>

    <p style="margin-top:20px;"><a href="${escape(opts.url)}" style="${emailButtonStyle}">Open it in Reach</a></p>`),
  'itinerary');
}
