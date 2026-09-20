// ─── The few moments only the browser can see ───────────────────────────
// Almost everything worth counting happens on the server, where the truth
// is: a contribution succeeded when Stripe says so, not when a screen
// believes it did. Those are emitted from the routes that know.
//
// A handful are genuinely client-side — an invitation link being opened is
// the first step of the growth loop and happens before anybody has an
// account — so this exists for those, and only those.
//
// The allowlist is the point. An endpoint that accepts arbitrary names from
// a browser is an endpoint that fills the table with whatever anybody feels
// like sending, and the first time somebody puts an email in a property is
// the last time this data is safe to look at.
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase';
import { track, isEventName, type EventName } from '@/lib/track';

export const dynamic = 'force-dynamic';

/** Only these may be sent from a browser. The rest are the server's own. */
const FROM_BROWSER = new Set<EventName>([
  'invite_link_opened',
  'quiz_completed',
  'trip_input_submitted',
  'recommendation_dismissed',
]);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = body?.name;

  if (!isEventName(name) || !FROM_BROWSER.has(name)) {
    // Said plainly rather than accepted quietly: a name this endpoint does
    // not know is a caller expecting something that will never be recorded.
    return NextResponse.json({ error: 'Not a recordable moment' }, { status: 400 });
  }

  // Signed in or not. An invitation opened before anybody has an account is
  // the most interesting version of that event, so a missing session is not
  // a reason to refuse — it is the data.
  const { userId: clerkId } = auth();
  const db = createServerClient();

  let userId: string | null = null;
  if (clerkId) {
    const { data } = await db.from('users').select('id').eq('clerk_id', clerkId).maybeSingle();
    userId = data?.id ?? null;
  }

  // Not awaited into the response: instrumentation never makes anybody wait.
  void track(db, name, {
    userId,
    groupId: typeof body.groupId === 'string' ? body.groupId : null,
    planId: typeof body.planId === 'string' ? body.planId : null,
    props: typeof body.props === 'object' && body.props ? body.props : {},
  });

  return NextResponse.json({ ok: true });
}
