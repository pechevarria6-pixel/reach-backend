import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { claimInvitesFor } from '@/lib/invites';
import { quizFromRow, withinQuietPeriod } from '@/lib/contracts/traveler-profile';

export async function GET() {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Not logged in' }, { status: 401 });

  const clerkUser = await currentUser();
  if (!clerkUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const supabase = createServerClient();
  const email = clerkUser.emailAddresses[0]?.emailAddress || '';
  // Sign in with Apple hands its name to the external account and not always
  // to the Clerk user, so look there before giving up on a real name.
  const external = clerkUser.externalAccounts[0] as { firstName?: string; lastName?: string } | undefined;
  const firstName = clerkUser.firstName || external?.firstName || '';
  const lastName = clerkUser.lastName || external?.lastName || '';
  const realName = [firstName, lastName].filter(Boolean).join(' ');
  const name = realName || email.split('@')[0];
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
    // Keep the avatar and address current. The name is only taken from Clerk
    // when Clerk actually has one and the person has not chosen their own in
    // Profile: this used to write `name` on every app open, so a name set in
    // Profile was replaced by the email's local part — "ntzc6jh94w" for an
    // Apple private-relay account — the next time the app loaded.
    const refresh: Record<string, string | null> = {};
    if (dbUser.avatar_url !== avatar_url) refresh.avatar_url = avatar_url;
    if (dbUser.email !== email) refresh.email = email;
    if (realName && !dbUser.first_name && dbUser.name !== realName) refresh.name = realName;
    if (Object.keys(refresh).length) {
      const { error: refreshed } = await supabase.from('users').update(refresh).eq('clerk_id', clerkId);
      if (refreshed) console.error('[me] could not refresh the profile from Clerk', { code: refreshed.code });
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
    // Null rather than the Clerk id.
    //
    // This read `dbUser?.id || clerkId`, so when the row was missing — the
    // first moments of a new account, or a failed find-or-create — the app's
    // id came back as `user_2abc...`. Both are strings and both are truthy,
    // so nothing downstream noticed: a filter keyed on it matches no row and
    // reads as an empty account, and an insert keyed on it writes a row
    // belonging to nobody.
    //
    // Null is the honest answer to "which id is this person" when we do not
    // have one yet, and it is the answer a caller can actually check.
    id: dbUser?.id ?? null,
    clerkId,
    email,
    avatar: avatar_url,
    provider,
    // What the person set in Profile wins over whatever Clerk knows: Clerk has
    // no first name at all for an Apple private-relay sign-up, which is why
    // the home screen greeted people with "there".
    // Built from the parts when they exist, because rows written before the
    // fix above may already hold the email's local part in `name`.
    name: [dbUser?.first_name, dbUser?.last_name].filter(Boolean).join(' ')
      || realName || dbUser?.name || name,
    firstName: dbUser?.first_name || firstName,
    lastName: dbUser?.last_name || lastName,
    // Departure airport for every flight estimate. Null until they set one,
    // in which case the client falls back to guessing from geolocation.
    homeAirport: dbUser?.home_airport || null,
    homeCity: dbUser?.home_city || null,
    preferences: dbUser ? {
      cuisines: dbUser.cuisines || [],
      musicGenres: dbUser.music_genres || [],
      // What somebody is actually into — pottery, cooking, climbing. The
      // quiz writes these two and could not prefill them without reading
      // them back, so editing your answers started from blank every time.
      favoriteActivities: dbUser.favorite_activities || [],
      noWayJose: dbUser.no_way_jose || [],
      diningVibe: dbUser.dining_vibe,
      drinkStyle: dbUser.drink_style,
      nightlifeStyle: dbUser.nightlife_style,
      concertTypes: dbUser.concert_types || [],
      activityVibe: dbUser.activity_vibe || [],
      budgetRange: dbUser.budget_range,
      // Their own words about what they want from a trip. Read back so the
      // quiz is something you revise rather than redo.
      tripSummary: dbUser.trip_summary ?? '',
      climate: dbUser.climate_preference,
      dietary: dbUser.dietary_needs,
      travelStyle: dbUser.travel_style,
    } : null,
    // The onboarding quiz v3: version, the profile the server computed, and
    // this person's own answers — returned to them and nobody else. Through
    // the contract, so a column the migration adds cannot be read here and
    // dropped on the way to the screen.
    quiz: quizFromRow(dbUser),
    // Done is: answered v2, worked through v3, or skipped it inside the last
    // sixty days. Skipping is a real answer and is not asked again.
    // v3 asks no budget and no cuisines, so its interests count too — before
    // the migration they are the only trace a finished v3 quiz leaves.
    quizComplete: !!(dbUser?.budget_range || dbUser?.cuisines?.length || dbUser?.favorite_activities?.length
      || dbUser?.quiz_version === 3 || withinQuietPeriod(dbUser?.quiz_skipped_at)),
  });
}
