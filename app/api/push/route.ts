// ─── /api/push — this device, and whether Reach may notify it ────────────
// GET    → { configured, publicKey }  the key a browser subscribes with
// POST   { subscription }             remember this device for me
// DELETE { endpoint }                 forget it (notifications turned off)
//
// A subscription is only ever stored against the signed-in person, and only
// deleted by them; nobody can register a device for somebody else.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, isFail } from '@/lib/auth';
import { pushConfigured, publicKey } from '@/lib/push';

const Sub = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(1000),
    keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  }),
});
const Gone = z.object({ endpoint: z.string().url().max(1000) });

export async function GET() {
  return NextResponse.json({ configured: pushConfigured(), publicKey: publicKey() });
}

export async function POST(req: NextRequest) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;
  if (!pushConfigured()) {
    console.error('[push] a device tried to subscribe but VAPID keys are not set on this deployment');
    return NextResponse.json({ error: 'Phone notifications are not switched on yet.' }, { status: 503 });
  }
  const parsed = Sub.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'That is not a device we can notify.' }, { status: 400 });
  const { endpoint, keys } = parsed.data.subscription;
  // Upsert by endpoint: the same phone re-subscribing, or changing hands
  // between accounts on one device, lands on the person signed in now.
  const { error } = await ctx.db.from('push_subscriptions').upsert({
    user_id: ctx.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth,
    user_agent: (req.headers.get('user-agent') || '').slice(0, 300),
  }, { onConflict: 'endpoint' });
  if (error) {
    console.error('[push] could not save the device', { code: error.code });
    return NextResponse.json({ error: 'Could not turn notifications on just now.' }, { status: error.code === '42P01' ? 503 : 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;
  const parsed = Gone.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Which device?' }, { status: 400 });
  const { error } = await ctx.db.from('push_subscriptions').delete()
    .eq('endpoint', parsed.data.endpoint).eq('user_id', ctx.user.id);
  if (error) {
    console.error('[push] could not forget the device', { code: error.code });
    return NextResponse.json({ error: 'Could not turn notifications off just now.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
