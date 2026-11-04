// ─── POST /api/webhooks/reservation-call — the provider says a call ended ─
// Retell (call_ended, call_analyzed) or Vapi (end-of-call-report). Public, as
// every webhook is (middleware.ts), so nothing is read from the body until
// its signature checks out against the provider's own secret:
//
//   Retell — x-retell-signature, HMAC-SHA256 keyed with RETELL_API_KEY
//   Vapi   — x-vapi-secret, equal to VAPI_WEBHOOK_SECRET
//
// Idempotent: a provider retries, and Retell sends two events per call. The
// row settles with a conditional update (settled_at is null), so only one
// delivery ever moves the booking, lists a "stop calling", or tells anybody.
// Every other delivery answers 200 and does nothing; a non-2xx would make
// the provider retry for nothing.
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { pushSender } from '@/lib/push';
import { settleCall } from '@/lib/reservations/call';
import { providerFor, senderOf } from '@/lib/reservations/providers';
import { supabaseStore, MIGRATION } from '@/lib/reservations/store';

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const name = senderOf(req.headers);
  if (!name) return NextResponse.json({ error: 'No signature' }, { status: 401 });
  const provider = providerFor(name, process.env);
  if (!provider.verify(raw, req.headers)) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });

  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Not JSON' }, { status: 400 }); }
  const event = provider.parse(body);
  // Events we do not settle on (call_started, transcript updates, Vapi's
  // status-update): acknowledged and ignored.
  if (!event) return new NextResponse(null, { status: 204 });

  const result = await settleCall(event, name, supabaseStore(createServerClient(), pushSender()));
  if (result.ok === false) {
    if (result.why === 'not_migrated') console.error(`[reservation webhook] no reservation_calls table — run ${MIGRATION}`);
    if (result.why === 'unknown_call') console.error('[reservation webhook] a call we have no row for', { provider: name, providerCallId: event.providerCallId });
    // A store failure is the one worth a retry.
    if (result.why === 'store_error') return NextResponse.json({ error: 'Could not record the call' }, { status: 500 });
    return new NextResponse(null, { status: 204 });
  }
  return new NextResponse(null, { status: 204 });
}
