// ─── /api/health/modes — which mode each provider is in ─────────────────
// The standing rule is to confirm test mode before exercising any payment
// or booking flow. Until now the only way to check was
// /api/health/providers, which takes a CRON_SECRET bearer token and so
// cannot be read by a person signed into the app — and the CRON_SECRET in a
// local .env.local is not the one Vercel holds, so it could not be read from
// a terminal either. The rule existed and the check did not.
//
// It also answers a question that cost real money. Puerto Vallarta held two
// confirmed Duffel orders, MHW2Y3 and SFYVFK, whose test-mode status was
// unknown for days; both turned out to be unreachable by the key production
// now uses, which is a thing about the key that nothing in the app could
// say.
//
// Modes only, from key prefixes. No key material, no lengths, no suffixes —
// a prefix says test or live and nothing that helps anybody use the key.
// Signed in, because "which mode is the money in" is not for the public.
import { NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';

type Mode = 'test' | 'live' | 'unset' | 'unrecognised';

/** test or live, from the prefix alone. */
function modeOf(key: string | undefined, test: string[], live: string[]): Mode {
  const k = (key ?? '').trim();
  if (!k) return 'unset';
  if (test.some(p => k.startsWith(p))) return 'test';
  if (live.some(p => k.startsWith(p))) return 'live';
  // A key that matches neither is worth saying out loud: it is usually a
  // placeholder left in a .env file, which reads as configured and is not.
  return 'unrecognised';
}

export async function GET() {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  return NextResponse.json({
    stripe: modeOf(process.env.STRIPE_SECRET_KEY, ['sk_test_', 'rk_test_'], ['sk_live_', 'rk_live_']),
    stripePublishable: modeOf(process.env.STRIPE_PUBLISHABLE_KEY, ['pk_test_'], ['pk_live_']),
    duffel: modeOf(process.env.DUFFEL_API_KEY, ['duffel_test_'], ['duffel_live_']),
    liteapi: modeOf(process.env.LITEAPI_KEY, ['sand_'], ['prod_', 'live_']),
    // Whether a webhook can be verified at all. Not a mode, and the one
    // other thing somebody checking the money path needs to know.
    stripeWebhookConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
  });
}
