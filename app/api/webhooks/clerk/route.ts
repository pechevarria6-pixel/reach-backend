import { NextRequest, NextResponse } from 'next/server';
import { Webhook } from 'svix';
import { createServerClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const svixId = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');

  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  const hasRealSecret = !!webhookSecret && webhookSecret !== 'placeholder';

  let event: any;

  if (hasRealSecret) {
    if (!svixId || !svixTimestamp || !svixSignature) {
      return NextResponse.json({ error: 'Missing signature headers' }, { status: 400 });
    }
    try {
      event = new Webhook(webhookSecret!).verify(body, {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      });
    } catch {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }
  } else {
    // Unsigned payloads are accepted only in local development. In production
    // this endpoint can schedule account deletion, so an unverified body would
    // let anyone delete any account by knowing its Clerk id.
    if (process.env.NODE_ENV === 'production') {
      console.error('[webhooks/clerk] refusing an unsigned payload in production — CLERK_WEBHOOK_SECRET is not set');
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
    }
    try { event = JSON.parse(body); } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
  }

  const supabase = createServerClient();
  const { type, data } = event;

  if (type === 'user.created') {
    const email = data.email_addresses?.[0]?.email_address || '';
    const firstName = data.first_name || '';
    const lastName = data.last_name || '';
    const name = [firstName, lastName].filter(Boolean).join(' ') || email.split('@')[0];
    const provider = data.external_accounts?.[0]?.provider || 'email';

    // Check if user already exists
    const { data: existing } = await supabase
      .from('users').select('id').eq('clerk_id', data.id).single();
    
    if (existing) {
      return NextResponse.json({ message: 'User already exists' });
    }

    const { data: newUser, error } = await supabase.from('users').insert({
      clerk_id: data.id,
      email,
      name,
      avatar_url: data.image_url || null,
      auth_provider: provider,
      consent_recorded_at: new Date().toISOString(),
    }).select().single();

    if (!error && newUser) {
      // Create Stripe customer
      try {
        const customer = await stripe.customers.create({
          email,
          name: name || undefined,
          metadata: { clerk_id: data.id, supabase_id: newUser.id },
        });
        const { error: linked } = await supabase.from('users').update({ stripe_customer_id: customer.id }).eq('id', newUser.id);
        if (linked) console.error('[webhooks/clerk] created a Stripe customer but could not save the id', { user: newUser.id, code: linked.code });
      } catch (e) {
        console.error('Stripe customer creation failed:', e);
      }
    }
  }

  if (type === 'user.updated') {
    const email = data.email_addresses?.[0]?.email_address || '';
    const name = [data.first_name, data.last_name].filter(Boolean).join(' ');

    // Only what Clerk actually sent.
    //
    // This wrote `name: name || null` on every update, so an event carrying
    // no first or last name erased the name we had — and Clerk has no name
    // for anybody who signed up through Apple's private relay, which is how
    // the home screen ended up greeting somebody as "there". The same for the
    // avatar: an update about an email address is not a statement that the
    // picture is gone.
    const changes: Record<string, string> = {};
    if (email) changes.email = email;
    if (name) changes.name = name;
    if (data.image_url) changes.avatar_url = data.image_url;

    if (Object.keys(changes).length) {
      const { error: updated } = await supabase.from('users').update(changes).eq('clerk_id', data.id);
      if (updated) console.error('[webhooks/clerk] could not apply a profile update', { code: updated.code });
    }
  }

  if (type === 'user.deleted') {
    const { data: user } = await supabase
      .from('users').select('id, email, stripe_customer_id').eq('clerk_id', data.id).single();
    if (user) {
      const deletionDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const { error: scheduled } = await supabase.from('users').update({
        deletion_requested_at: new Date().toISOString(),
        deletion_scheduled_at: deletionDate.toISOString(),
      }).eq('id', user.id);
      // Somebody deleted their account at Clerk. If this does not land, the
      // record here is never scheduled for removal and nothing will come
      // back to ask — so Stripe's retry is worth provoking.
      if (scheduled) console.error('[webhooks/clerk] account deleted at Clerk but not scheduled here', { user: user.id, code: scheduled.code });
      if (user.stripe_customer_id) {
        try { await stripe.customers.del(user.stripe_customer_id); }
        catch (e) { console.error('[webhooks/clerk] could not delete the Stripe customer', { user: user.id, error: e instanceof Error ? e.message : 'unknown' }); }
      }
    }
  }

  return NextResponse.json({ received: true });
}
