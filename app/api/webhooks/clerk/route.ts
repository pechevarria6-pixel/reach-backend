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
        await supabase.from('users').update({ stripe_customer_id: customer.id }).eq('id', newUser.id);
      } catch (e) {
        console.error('Stripe customer creation failed:', e);
      }
    }
  }

  if (type === 'user.updated') {
    const email = data.email_addresses?.[0]?.email_address || '';
    const name = [data.first_name, data.last_name].filter(Boolean).join(' ');
    await supabase.from('users').update({
      email,
      name: name || null,
      avatar_url: data.image_url || null,
    }).eq('clerk_id', data.id);
  }

  if (type === 'user.deleted') {
    const { data: user } = await supabase
      .from('users').select('id, email, stripe_customer_id').eq('clerk_id', data.id).single();
    if (user) {
      const deletionDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await supabase.from('users').update({
        deletion_requested_at: new Date().toISOString(),
        deletion_scheduled_at: deletionDate.toISOString(),
      }).eq('id', user.id);
      if (user.stripe_customer_id) {
        try { await stripe.customers.del(user.stripe_customer_id); } catch {}
      }
    }
  }

  return NextResponse.json({ received: true });
}
