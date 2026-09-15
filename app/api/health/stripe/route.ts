// ─── /api/health/stripe — is the Stripe key usable, without moving money ─
// The only thing that used the secret key was the funding route, which
// creates a PaymentIntent. So the only way to find out the key was wrong was
// for somebody to try to pay — which is how a key *identifier* (mk_…) sat in
// production for fifty-one days with every contribution refused.
//
// This asks Stripe for the account balance: a read that cannot charge,
// refund or create anything. It reports what kind of key is configured and
// whether Stripe accepted it, and never any part of the key itself — not even
// Stripe's own error text, which quotes a masked copy of the key back.
//
// Protected by CRON_SECRET, like the jobs, because whether payments work is
// nobody else's business.
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[health/stripe] CRON_SECRET is not set — refusing to run');
    return false;
  }
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

/** What sort of key this is, from its prefix alone. */
function shapeOf(key: string | undefined): string {
  if (!key) return 'missing';
  const m = /^(sk|rk)_(live|test)_/.exec(key);
  if (m) return `${m[1]}_${m[2]}`;
  // Three characters is enough to say "that is a key ID" and too few to help
  // anybody who should not have it.
  return `not a secret key (starts ${key.slice(0, 3)})`;
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: 'Not authorised' }, { status: 401 });

  const key = process.env.STRIPE_SECRET_KEY;
  const secretKey = shapeOf(key);
  const webhook = process.env.STRIPE_WEBHOOK_SECRET;
  // The shape is all that can be checked here. Whether it belongs to a live
  // mode endpoint is only visible in the Stripe dashboard.
  const webhookSecret = !webhook ? 'missing' : webhook.startsWith('whsec_') ? 'whsec' : 'not a signing secret';

  if (!/^(sk|rk)_/.test(key ?? '')) {
    return NextResponse.json({ secretKey, stripe: 'not tried', webhookSecret });
  }

  try {
    const res = await fetch('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[health/stripe] Stripe refused the key', res.status, body?.error?.type, body?.error?.code);
      return NextResponse.json({
        secretKey, webhookSecret,
        stripe: 'rejected', status: res.status,
        // The type and code only. The message quotes the key.
        type: body?.error?.type ?? null, code: body?.error?.code ?? null,
      });
    }
    return NextResponse.json({ secretKey, webhookSecret, stripe: 'accepted', livemode: body?.livemode === true });
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : 'request failed';
    console.error('[health/stripe] could not reach Stripe', detail);
    return NextResponse.json({ secretKey, webhookSecret, stripe: 'unreachable' });
  }
}
