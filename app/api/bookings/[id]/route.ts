// ─── PATCH /api/bookings/[id] — concierge/ops fulfillment ────────────────
// Ops (you, for now) confirms concierge tickets: body { status:
// 'confirmed'|'failed'|'cancelled', providerRef?, detail? }. This is also
// where a future OpenTable/Resy integration would report back — the
// frontend only ever watches `status`.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

const supabase = createServerClient;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const allowed = ['confirmed', 'failed', 'cancelled', 'pending'];
  if (!allowed.includes(body.status)) {
    return NextResponse.json({ error: `status must be one of ${allowed.join(', ')}` }, { status: 400 });
  }

  const { data: booking } = await supabase()
    .from('bookings').select('plan_id').eq('id', params.id).maybeSingle();
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  // Anyone signed in could previously mark any booking confirmed.
  const ctx = await requirePlanMember(booking.plan_id);
  if (isFail(ctx)) return ctx.error;

  const { data, error } = await ctx.db
    .from('bookings')
    .update({
      status: body.status,
      provider_ref: body.providerRef ?? undefined,
      detail: body.detail ?? undefined,
      fulfilled_by: ctx.user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .select()
    .single();
  if (error) {
    console.error('[bookings PATCH] update failed', { id: params.id, error });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ booking: data });
}
