// ─── PATCH /api/bookings/[id] — concierge/ops fulfillment ────────────────
// Ops (you, for now) confirms concierge tickets: body { status:
// 'confirmed'|'failed'|'cancelled', providerRef?, detail? }. This is also
// where a future OpenTable/Resy integration would report back — the
// frontend only ever watches `status`.
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';

const supabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const allowed = ['confirmed', 'failed', 'cancelled', 'pending'];
  if (!allowed.includes(body.status)) {
    return NextResponse.json({ error: `status must be one of ${allowed.join(', ')}` }, { status: 400 });
  }
  const { data, error } = await supabase()
    .from('bookings')
    .update({
      status: body.status,
      provider_ref: body.providerRef ?? undefined,
      detail: body.detail ?? undefined,
      fulfilled_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ booking: data });
}
