// ─── /api/connected-accounts ─────────────────────────────────────────────
// Tracks which providers the user has pre-signed into via the in-app
// webview. The client marks a provider connected after the user completes
// sign-in on the provider's own page. NO credentials ever touch Reach.
// GET    → list my connections (drives the "Connected accounts" screen
//          and lets checkout know which redirects will be 1-tap)
// POST   { provider, label? }         → mark connected
// DELETE { provider }                 → mark disconnected
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import { KNOWN_PROVIDERS } from '@/lib/booking/providers';


export async function GET() {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;
  const { data, error } = await ctx.db
    .from('connected_accounts').select('*').eq('user_id', ctx.user.id);
  if (error) console.error('[connected-accounts] query failed', error);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ accounts: data, known: KNOWN_PROVIDERS });
}

export async function POST(req: NextRequest) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;
  const body = await req.json().catch(() => ({}));
  if (!body.provider) return NextResponse.json({ error: 'provider required' }, { status: 400 });
  const { data, error } = await ctx.db
    .from('connected_accounts')
    .upsert(
      { user_id: ctx.user.id, provider: body.provider, label: body.label || null, status: 'connected', last_used_at: new Date().toISOString() },
      { onConflict: 'user_id,provider' }
    )
    .select().single();
  console.error('[connected-accounts] failed', error);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ account: data });
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;
  const body = await req.json().catch(() => ({}));
  if (!body.provider) return NextResponse.json({ error: 'provider required' }, { status: 400 });
  const { error } = await ctx.db
    .from('connected_accounts')
    .update({ status: 'disconnected' })
    .eq('user_id', ctx.user.id).eq('provider', body.provider);
  console.error('[connected-accounts] failed', error);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
