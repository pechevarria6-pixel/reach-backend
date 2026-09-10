import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM || 'noreply@reach.app';

export async function sendBookingConfirmation(to: string, planTitle: string, details: object) {
  return resend.emails.send({
    from: FROM,
    to,
    subject: `Your booking is confirmed — ${planTitle}`,
    html: `
      <h1>You're all booked! ✓</h1>
      <p>Your booking for <strong>${planTitle}</strong> has been confirmed.</p>
      <pre>${JSON.stringify(details, null, 2)}</pre>
      <p>Open the Reach app to view your full itinerary.</p>
    `,
  });
}

export async function sendPaymentReceipt(to: string, amount: number, planTitle: string, stripeId: string) {
  return resend.emails.send({
    from: FROM,
    to,
    subject: `Payment receipt — ${planTitle}`,
    html: `
      <h1>Payment confirmed</h1>
      <p>Amount: <strong>$${(amount / 100).toFixed(2)}</strong></p>
      <p>For: <strong>${planTitle}</strong></p>
      <p>Transaction ID: <code>${stripeId}</code></p>
      <p>This is your official receipt. Keep it for your records.</p>
    `,
  });
}

export async function sendDeletionConfirmation(to: string, deletionDate: string) {
  return resend.emails.send({
    from: FROM,
    to,
    subject: 'Account deletion scheduled — Reach',
    html: `
      <h1>Account deletion request received</h1>
      <p>Your account and all associated data will be permanently deleted on <strong>${deletionDate}</strong>.</p>
      <p>This complies with GDPR Article 17 (Right to Erasure).</p>
      <p>If you did not request this, contact us immediately at privacy@reach.app</p>
    `,
  });
}

export async function sendGroupInvite(
  to: string,
  opts: { groupName: string; groupEmoji?: string | null; inviterName?: string | null; acceptUrl: string }
) {
  const who = opts.inviterName ? `${opts.inviterName} invited you` : 'You have been invited';
  return resend.emails.send({
    from: FROM,
    to,
    subject: `${who} to ${opts.groupName} on Reach`,
    html: `
      <h1>${opts.groupEmoji || '\u2708\uFE0F'} ${opts.groupName}</h1>
      <p>${who} to plan trips together on Reach.</p>
      <a href="${opts.acceptUrl}" style="background:#6C63FF;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;margin:16px 0;">Join ${opts.groupName}</a>
      <p style="color:#666;font-size:13px;">Signing in with this email address joins you automatically — the link is just a shortcut. The invite expires in 30 days.</p>
    `,
  });
}

export async function sendMagicLink(to: string, link: string) {
  return resend.emails.send({
    from: FROM,
    to,
    subject: 'Your sign-in link — Reach',
    html: `
      <h1>Sign in to Reach</h1>
      <p>Tap the button below to sign in instantly. This link expires in 10 minutes.</p>
      <a href="${link}" style="background:#6C63FF;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;margin:16px 0;">Sign in to Reach</a>
      <p>If you didn't request this, you can safely ignore this email.</p>
    `,
  });
}
