// ─── POST /api/support — "Message us" ────────────────────────────────────
// A member's message to the founder's inbox, Reply going back to them.
//
//   body { topic, message, planId?, bookingRef? }  (lib/support.ts parseSupport)
//   → 200 { sent: true }      only when the email provider accepted it
//   → 400 { error }           nothing to send, or too long
//   → 429 { error }           five an hour is plenty for a person; a loop is not a person
//   → 503 { error, mailto }   not sent — and says so, with the address to write to instead
//
// A plan id is named in the message only when the sender is on that plan, so
// this cannot be used to learn another group's trip title.

import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import { allowance } from '@/lib/rate-limit';
import { parseSupport, SUPPORT_ACTION, SUPPORT_PER_HOUR, TOPIC_LABEL } from '@/lib/support';
import { sendSupportMessage } from '@/lib/email';
import { SUPPORT_EMAIL } from '@/lib/checkout';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const parsed = parseSupport(await req.json().catch(() => null));
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const m = parsed.value;

  const rate = await allowance(ctx.db, ctx.user.id, SUPPORT_ACTION, SUPPORT_PER_HOUR);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: `That's a lot of messages in an hour — try again in ${rate.retryAfterMinutes} min, or write to ${SUPPORT_EMAIL}.` },
      { status: 429 },
    );
  }

  // The sender's name, and the trip only if they are on it.
  const { data: me, error: meErr } = await ctx.db.from('users').select('name').eq('id', ctx.user.id).maybeSingle();
  if (meErr) console.error('[support] could not read the sender name', { code: meErr.code });
  let plan: string | null = null;
  if (m.planId) {
    const { data: p, error: pErr } = await ctx.db.from('plans').select('title, group_id').eq('id', m.planId).maybeSingle();
    if (pErr) console.error('[support] could not read the plan', { code: pErr.code });
    if (p?.group_id) {
      const { data: member, error: gErr } = await ctx.db.from('group_members').select('user_id')
        .eq('group_id', p.group_id).eq('user_id', ctx.user.id).maybeSingle();
      if (gErr) console.error('[support] could not check membership', { code: gErr.code });
      if (member) plan = `${p.title ?? 'Untitled'} (${m.planId})`;
    }
  }

  const sent = await sendSupportMessage({
    fromEmail: ctx.user.email, fromName: (me as { name?: string } | null)?.name ?? null,
    topic: TOPIC_LABEL[m.topic], message: m.message, plan, bookingRef: m.bookingRef, userId: ctx.user.id,
  });
  if (!sent.sent) {
    return NextResponse.json(
      { error: `We couldn't send that just now. Write to ${SUPPORT_EMAIL} and it reaches the same inbox.`, mailto: SUPPORT_EMAIL },
      { status: 503 },
    );
  }

  // Counted for the hourly limit, after the send: a refused send is not a message.
  const { error: logErr } = await ctx.db.from('audit_logs').insert({
    user_id: ctx.user.id, action: SUPPORT_ACTION, resource: 'support', resource_id: null, success: true,
    metadata: { topic: m.topic, plan: m.planId, has_ref: !!m.bookingRef },
  });
  if (logErr) console.error('[support] sent, but could not count it for the limit', { code: logErr.code });

  return NextResponse.json({ sent: true });
}
