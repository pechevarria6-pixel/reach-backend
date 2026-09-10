import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { claimInvitesFor } from '@/lib/invites';

export async function GET() {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Not logged in' }, { status: 401 });

  const clerkUser = await currentUser();
  if (!clerkUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const supabase = createServerClient();
  const email = clerkUser.emailAddresses[0]?.emailAddress || '';
  const firstName = clerkUser.firstName || '';
  const lastName = clerkUser.lastName || '';
  const name = [firstName, lastName].filter(Boolean).join(' ') || email.split('@')[0];
  const avatar_url = clerkUser.imageUrl || null;
  const provider = clerkUser.externalAccounts[0]?.provider || 'email';

  // Check if user exists in Supabase
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('clerk_id', clerkId)
    .single();

  let dbUser = existing;

  if (!dbUser) {
    // Auto-create user in Supabase — this fixes the webhook gap
    const { data: newUser, error } = await supabase
      .from('users')
      .insert({
        clerk_id: clerkId,
        email,
        name,
        avatar_url,
        auth_provider: provider,
        consent_recorded_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (!error && newUser) {
      dbUser = newUser;
      // Create Stripe customer in background
      try {
        const { stripe } = await import('@/lib/stripe');
        const customer = await stripe.customers.create({
          email,
          name: name || undefined,
          metadata: { clerk_id: clerkId, supabase_id: newUser.id },
        });
        await supabase
          .from('users')
          .update({ stripe_customer_id: customer.id })
          .eq('id', newUser.id);
      } catch (e) {
        console.log('Stripe customer creation skipped:', e);
      }
    }
  } else {
    // Update avatar/name if changed
    if (dbUser.avatar_url !== avatar_url || dbUser.name !== name) {
      await supabase
        .from('users')
        .update({ avatar_url, name, email })
        .eq('clerk_id', clerkId);
    }
  }

  // Turn any pending group invites for this address into real memberships.
  // Only a verified address is honoured — otherwise signing up as someone
  // else's email would be enough to join their group.
  let joinedGroups: string[] = [];
  if (dbUser?.id) {
    const primary = clerkUser.emailAddresses.find(
      e => e.id === clerkUser.primaryEmailAddressId
    ) || clerkUser.emailAddresses[0];
    const verified = primary?.verification?.status === 'verified';
    if (verified && primary?.emailAddress) {
      try {
        const claimed = await claimInvitesFor(supabase, dbUser.id, primary.emailAddress);
        joinedGroups = claimed.joined;
      } catch (e) {
        console.error('[me] invite claim failed', e);
      }
    }
  }

  return NextResponse.json({
    joinedGroups,
    id: dbUser?.id || clerkId,
    clerkId,
    name,
    email,
    avatar: avatar_url,
    provider,
    firstName,
    lastName,
    preferences: dbUser ? {
      cuisines: dbUser.cuisines || [],
      musicGenres: dbUser.music_genres || [],
      diningVibe: dbUser.dining_vibe,
      drinkStyle: dbUser.drink_style,
      nightlifeStyle: dbUser.nightlife_style,
      concertTypes: dbUser.concert_types || [],
      activityVibe: dbUser.activity_vibe || [],
      budgetRange: dbUser.budget_range,
      climate: dbUser.climate_preference,
      dietary: dbUser.dietary_needs,
      travelStyle: dbUser.travel_style,
    } : null,
    quizComplete: !!(dbUser?.budget_range || dbUser?.cuisines?.length),
  });
}
