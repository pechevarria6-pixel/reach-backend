// ─── /api/connected-accounts ─────────────────────────────────────────────
// Tracks which providers the user has pre-signed into via the in-app
// webview. The client marks a provider connected after the user completes
// sign-in on the provider's own page. NO credentials ever touch Reach.
// GET    → list my connections (drives the "Connected accounts" screen
//          and lets checkout know which redirects will be 1-tap)
// POST   { provider, label? }         → mark connected
// DELETE { provider }                 → mark disconnected
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';

const supabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Canonical provider ids the advisory engine understands
export const KNOWN_PROVIDERS = [
  'united', 'american', 'delta', 'alaska', 'jetblue', 'southwest',
  'chase_travel', 'amex_travel', 'citi_travel', 'capitalone_travel',
  'ticketmaster', 'axs', 'seatgeek', 'dice', 'eventbrite',
  'opentable', 'resy', 'tock',
] as const;

export async function GET() {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data, error } = await supabase()
    .from('connected_accounts').select('*').eq('user_id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ accounts: data, known: KNOWN_PROVIDERS });
}

export async function POST(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.provider) return NextResponse.json({ error: 'provider required' }, { status: 400 });
  const { data, error } = await supabase()
    .from('connected_accounts')
    .upsert(
      { user_id: userId, provider: body.provider, label: body.label || null, status: 'connected', last_used_at: new Date().toISOString() },
      { onConflict: 'user_id,provider' }
    )
    .select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ account: data });
}

export async function DELETE(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.provider) return NextResponse.json({ error: 'provider required' }, { status: 400 });
  const { error } = await supabase()
    .from('connected_accounts')
    .update({ status: 'disconnected' })
    .eq('user_id', userId).eq('provider', body.provider);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
