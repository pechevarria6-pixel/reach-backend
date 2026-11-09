// ─── /api/ops/exceptions — the concierge exception queue (directive C4) ──
// Count, age and SLA of booking rows a person at Reach must act on. Ops only:
// guarded by REACH_OPS_SECRET in the x-reach-ops header, like
// /api/ops/taste-profile. Never linked from member UI.
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { createServerClient } from '@/lib/supabase';
import { exceptionQueue, type ExceptionRow } from '@/lib/ops/exceptions';

export const dynamic = 'force-dynamic';

function authorised(req: NextRequest): boolean {
  const secret = process.env.REACH_OPS_SECRET;
  if (!secret) {
    console.error('[ops/exceptions] REACH_OPS_SECRET is not set — refusing');
    return false;
  }
  const a = Buffer.from(req.headers.get('x-reach-ops') ?? '');
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  const db = createServerClient();
  const { data, error } = await db.from('bookings')
    .select('id, plan_id, vertical, status, mode, provider, created_at')
    .or('mode.eq.concierge,provider.eq.concierge').eq('status', 'pending')
    .order('created_at', { ascending: true }).limit(500);
  if (error) {
    console.error('[ops/exceptions] could not read the queue', { code: error.code });
    return NextResponse.json({ error: 'Could not read the queue' }, { status: 500 });
  }
  return NextResponse.json(exceptionQueue((data ?? []) as ExceptionRow[]), { headers: { 'cache-control': 'no-store' } });
}
