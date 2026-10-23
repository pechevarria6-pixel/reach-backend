// ─── GET /api/ops/taste-profile?userId= — the one read of a taste profile ──
// For whoever is tuning the distill (lib/taste-profile.ts) and needs to see
// what it made of somebody. Nothing a person can reach shows it: not to them,
// not to their group. This is the only route that returns one.
//
// Behind a server secret, sent as `X-Reach-Ops: $REACH_OPS_SECRET`. Never a
// NEXT_PUBLIC variable — that would ship it in the browser bundle — and with
// no secret configured the route refuses rather than running open.
//
// The answer is keyed by the opaque profile_id, never the user id: the user
// id goes in, is turned into a profile_id through taste_profile_ids, and the
// profile is read from v_taste_profile_ops, which holds no user id, name,
// email or phone. What leaves this route can be pasted into a ticket.
//
//   curl -H "X-Reach-Ops: $REACH_OPS_SECRET" ".../api/ops/taste-profile?userId=<uuid>"
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { createServerClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function authorised(req: NextRequest): boolean {
  const secret = process.env.REACH_OPS_SECRET;
  if (!secret) {
    console.error('[ops/taste-profile] REACH_OPS_SECRET is not set — refusing');
    return false;
  }
  const sent = req.headers.get('x-reach-ops') ?? '';
  const a = Buffer.from(sent);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: 'Not authorised' }, { status: 401 });

  const userId = (req.nextUrl.searchParams.get('userId') ?? '').trim();
  if (!UUID.test(userId)) return NextResponse.json({ error: 'userId must be a uuid' }, { status: 400 });

  const db = createServerClient();
  const { data: idRow, error: idErr } = await db
    .from('taste_profile_ids').select('profile_id').eq('user_id', userId).maybeSingle();
  if (idErr) {
    console.error('[ops/taste-profile] could not read the profile id', { code: idErr.code });
    return NextResponse.json({ error: 'Could not read the profile id' }, { status: 500 });
  }
  if (!idRow) return NextResponse.json({ error: 'No profile distilled for this person yet' }, { status: 404 });

  const { data: row, error } = await db
    .from('v_taste_profile_ops')
    .select('profile_id, profile, model_version, signal_count, last_signal_at, distilled_at')
    .eq('profile_id', idRow.profile_id)
    .maybeSingle();
  if (error) {
    console.error('[ops/taste-profile] could not read the profile', { code: error.code });
    return NextResponse.json({ error: 'Could not read the profile' }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: 'No profile distilled for this person yet' }, { status: 404 });

  return NextResponse.json(row, { headers: { 'cache-control': 'no-store' } });
}
