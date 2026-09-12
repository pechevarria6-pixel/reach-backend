// ─── /api/config/stripe ──────────────────────────────────────────────────
// Hands the browser the Stripe publishable key at runtime.
//
// The key cannot be read directly by the checkout component. Next.js inlines
// only NEXT_PUBLIC_* into the client bundle, and it does that at build time —
// which is exactly when Vercel hides variables marked Sensitive. Reading it
// here, on the server, on demand, sidesteps both traps: the variable keeps the
// plain STRIPE_PUBLISHABLE_KEY name it already has in Vercel, and staying
// Sensitive costs nothing because no build ever needs to see it.
//
// A publishable key is public by design — it ships to every browser that opens
// checkout — so this endpoint needs no auth. The secret key must never be
// served here.
import { NextResponse } from 'next/server';

// Never prerender: a cached response would bake in whatever the build saw,
// which is the failure this route exists to avoid.
export const dynamic = 'force-dynamic';

export function GET() {
  // The public name is the fallback so existing setups keep working.
  const key =
    process.env.STRIPE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    '';

  if (!/^pk_(test|live)_/.test(key)) {
    return NextResponse.json(
      {
        error:
          'Stripe publishable key is missing or malformed. Set STRIPE_PUBLISHABLE_KEY ' +
          'to the pk_test_ or pk_live_ key from Stripe → Developers → API keys.',
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ publishableKey: key });
}
