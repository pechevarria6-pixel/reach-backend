import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { sendDeletionConfirmation } from '@/lib/email';

// GET — download all user data (GDPR Article 20)
export async function GET() {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServerClient();
  const { data: user } = await supabase.from('users').select('*').eq('clerk_id', clerkId).single();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const [groups, payments, votes, loyalty, auditLogs] = await Promise.all([
    supabase.from('group_members').select('groups(name, emoji)').eq('user_id', user.id),
    supabase.from('payments').select('id, amount_cents, status, created_at').eq('user_id', user.id),
    supabase.from('votes').select('plan_id, option, voted_at').eq('user_id', user.id),
    supabase.from('loyalty_programs').select('program_name, tier, points').eq('user_id', user.id),
    supabase.from('audit_logs').select('action, created_at').eq('user_id', user.id).limit(100),
  ]);

  // An audit trail that loses entries silently is how nine plans once

  // vanished with nothing to read afterwards. Never fails the request; it

  // does have to leave a mark.

  const { error: audit } = await supabase.from('audit_logs').insert({ user_id: user.id, action: 'data_export_requested', resource: 'users', resource_id: user.id, success: true });
  if (audit) console.error('[audit] could not record data_export_requested', { code: audit.code });

  const export_data = {
    export_date: new Date().toISOString(),
    gdpr_basis: 'GDPR Article 20 — Right to Data Portability',
    user: { id: user.id, email: user.email, name: user.name, auth_provider: user.auth_provider, created_at: user.created_at, preferences: { seat: user.seat_preference, dietary: user.dietary_needs, climate: user.climate_preference }, consent: { personalized: user.consent_personalized, analytics: user.consent_analytics, marketing: user.consent_marketing } },
    groups: groups.data, payments: payments.data, votes: votes.data,
    loyalty_programs: loyalty.data, audit_log: auditLogs.data,
    note: 'Encrypted fields (passport, loyalty numbers) excluded for security. Card data managed by Stripe — visit stripe.com/privacy.',
  };

  return new NextResponse(JSON.stringify(export_data, null, 2), {
    headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="reach-data-${new Date().toISOString().split('T')[0]}.json"` },
  });
}

// DELETE — request account deletion (GDPR Article 17)
export async function DELETE(req: NextRequest) {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  if (body.confirm !== 'DELETE') return NextResponse.json({ error: 'Must confirm with {"confirm":"DELETE"}' }, { status: 400 });

  const supabase = createServerClient();
  const { data: user } = await supabase.from('users').select('id, email, stripe_customer_id, deletion_requested_at').eq('clerk_id', clerkId).single();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  if (user.deletion_requested_at) return NextResponse.json({ message: 'Deletion already scheduled', scheduled_at: user.deletion_requested_at });

  const deletionDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // Somebody asking to be deleted has to be able to rely on the answer. An
  // insert that failed silently here told them it was scheduled when nothing
  // had been recorded, and nothing would ever come to collect it.
  const { error: requested } = await supabase.from('deletion_requests')
    .insert({ user_id: user.id, clerk_id: clerkId, email: user.email, scheduled_for: deletionDate.toISOString() });
  if (requested) {
    console.error('[user/data] could not record a deletion request', { user: user.id, code: requested.code });
    return NextResponse.json({ error: "We couldn't schedule that — please try again" }, { status: 500 });
  }

  const { error: marked } = await supabase.from('users')
    .update({ deletion_requested_at: new Date().toISOString(), deletion_scheduled_at: deletionDate.toISOString() })
    .eq('id', user.id);
  if (marked) {
    console.error('[user/data] deletion requested but the account was not marked', { user: user.id, code: marked.code });
    return NextResponse.json({ error: "We couldn't schedule that — please try again" }, { status: 500 });
  }

  if (user.stripe_customer_id) {
    // Said out loud rather than swallowed: a customer record left behind at
    // Stripe after somebody asked to be deleted is the sort of thing that has
    // to be findable later.
    try { await stripe.customers.del(user.stripe_customer_id); }
    catch (e) { console.error('[user/data] could not delete the Stripe customer', { user: user.id, error: e instanceof Error ? e.message : 'unknown' }); }
  }

  await sendDeletionConfirmation(user.email, deletionDate.toLocaleDateString());

  return NextResponse.json({ message: 'Account deletion scheduled', deletion_date: deletionDate.toISOString() });
}

// PATCH — update user preferences (GDPR Article 16)
export async function PATCH(req: NextRequest) {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const allowed = ['name', 'seat_preference', 'dietary_needs', 'climate_preference', 'consent_personalized', 'consent_analytics', 'consent_marketing', 'consent_third_party', 'travel_style', 'trip_frequency', 'budget_range', 'favorite_activities', 'cuisines', 'music_genres', 'dining_vibe', 'drink_style', 'nightlife_style', 'concert_types', 'activity_vibe', 'no_way_jose', 'trip_summary'];
  const updates = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 });

  const supabase = createServerClient();
  // The error used to be discarded and this answered "Profile updated"
  // whatever happened. That is the taste quiz's save path — the answers the
  // whole app personalises from — so a failed write told somebody their
  // preferences were stored and they were not.
  const { error } = await supabase.from('users').update(updates).eq('clerk_id', clerkId);
  if (error) {
    // Code and message only: `updates` is what this person just told us about
    // themselves, and error.details can quote the row straight back.
    console.error('[user/data] update failed', { code: error.code, message: error.message });
    // Two phrasings for the same fact. Postgres says `column "x" ... does not
    // exist`; PostgREST, which is what actually answers here, says `Could not
    // find the 'x' column of 'users' in the schema cache`. Matching only the
    // first turned a missing migration into a generic "try again", which is
    // advice that cannot work.
    const missing = /column "?'?([a-z_]+)'?"? .*does not exist/i.exec(error.message || '')
      ?? /could not find the '?([a-z_]+)'? column/i.exec(error.message || '');
    if (missing) {
      return NextResponse.json(
        { error: `This needs a migration: the ${missing[1]} column does not exist yet.` },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Couldn't save that — try again" }, { status: 500 });
  }

  return NextResponse.json({ message: 'Profile updated', updated_fields: Object.keys(updates) });
}
