// ─── /api/profile ────────────────────────────────────────────────────────
// Everything the Profile screen shows, from the database and Stripe.
//
// That screen used to be entirely literals: a passport expiring in 2029, a
// Visa ending 4242, three signed-in devices. The columns for most of it had
// existed all along with nothing reading or writing them.
//
// GET   → stats, documents (masked), loyalty, connected accounts, cards,
//         recent payments, preferences, deletion state
// PATCH → travel documents and preferences
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import { encrypt, decrypt } from '@/lib/encryption';
import { GENDERS, missingFor, validBirthDate, plausiblePhone } from '@/lib/essentials';
import { z } from 'zod';
import { paymentRefundCents } from '@/lib/refunds';

// A document number is stored encrypted and must never travel back in full.
// The screen only needs to prove it holds the right one, so it gets the last
// four characters and nothing else.
function mask(ciphertext: string | null): { present: boolean; last4?: string } {
  if (!ciphertext) return { present: false };
  try {
    const plain = decrypt(ciphertext);
    return { present: true, last4: plain.slice(-4) };
  } catch {
    // A key rotation makes old ciphertext unreadable. Say it is there rather
    // than silently reporting the document as missing.
    return { present: true };
  }
}

export async function GET() {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;
  const { db, user } = ctx;

  const { data: row } = await db.from('users').select('*').eq('id', user.id).single();
  if (!row) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const [memberships, loyalty, connected, contributions] = await Promise.all([
    db.from('group_members').select('group_id').eq('user_id', user.id),
    db.from('loyalty_programs').select('id, program_name, tier, points').eq('user_id', user.id).order('created_at'),
    db.from('connected_accounts').select('provider, label, status, last_used_at').eq('user_id', user.id),
    // `contributions`, not `payments`. The funding flow writes contributions
    // and always has; `payments` belongs to a path that was replaced and
    // holds zero rows, so this screen showed an empty payment history to
    // somebody who had paid — twice, in this database.
    //
    // select('*') so refunded_cents (sql/wave1-refunds-2026-09-22.sql) is
    // read the moment it exists without failing this read before then; the
    // rows are narrowed to what the screen shows below.
    db.from('contributions')
      .select('*')
      .eq('user_id', user.id).order('created_at', { ascending: false }).limit(10),
  ]);

  const groupIds = (memberships.data || []).map(m => m.group_id);
  // Plans are group-wide, so the count is every plan in every group you are in.
  const { count: planCount } = groupIds.length
    ? await db.from('plans').select('id', { count: 'exact', head: true }).in('group_id', groupIds)
    : { count: 0 };
  // Distinct people you share a group with, yourself excluded.
  const { data: peers } = groupIds.length
    ? await db.from('group_members').select('user_id').in('group_id', groupIds)
    : { data: [] };
  const friends = new Set((peers || []).map(p => p.user_id).filter(id => id !== user.id)).size;

  // Cards live at Stripe, never here. Import lazily so a missing Stripe key
  // degrades this one section instead of failing the whole request.
  //
  // Timed on production at about a second, nearly all of it this call — and
  // every row on the screen waits for it to say anything at all. A card list
  // is worth a second when somebody opens the payment section; it is not
  // worth making them watch the rest of their profile arrive behind it, so
  // it gives up early and the section asks again if it has to.
  let cards: any[] = [];
  if (row.stripe_customer_id) {
    try {
      const { stripe } = await import('@/lib/stripe');
      const list = await stripe.paymentMethods.list(
        { customer: row.stripe_customer_id, type: 'card', limit: 10 },
        { timeout: 2500, maxNetworkRetries: 0 },
      );
      cards = list.data.map(pm => ({
        id: pm.id,
        brand: pm.card?.brand ?? 'card',
        last4: pm.card?.last4 ?? '••••',
        expMonth: pm.card?.exp_month ?? null,
        expYear: pm.card?.exp_year ?? null,
      }));
    } catch (e) {
      console.error('[profile] stripe payment methods failed', e);
    }
  }

  return NextResponse.json({
    stats: { groups: groupIds.length, plans: planCount ?? 0, friends },
    documents: {
      passport: mask(row.passport_number_enc),
      tsaPrecheck: mask(row.tsa_precheck_enc),
      globalEntry: mask(row.global_entry_enc),
    },
    loyalty: loyalty.data || [],
    connected: connected.data || [],
    cards,
    payments: (contributions.data || []).map(c => ({
      id: c.id, amount_cents: c.amount_cents, currency: c.currency,
      status: c.status, created_at: c.created_at, plan_id: c.plan_id,
      // The screen reads this to show a refund. Part of a payment given back
      // is recorded in refunded_cents and showed as nothing back at all when
      // this read only the status; a whole one before the migration is still
      // said by the status alone.
      refund_amount_cents: paymentRefundCents(c),
    })),
    // Undefined rather than null means the column is not there yet, so the
    // screen can tell "not set" apart from "migration not run".
    home: {
      airport: row.home_airport ?? null,
      city: row.home_city ?? null,
      available: 'home_airport' in row,
    },
    identity: {
      name: row.name ?? null,
      firstName: row.first_name ?? null,
      lastName: row.last_name ?? null,
    },
    // What an airline needs before it will sell a seat. This is the only
    // response in the app that carries these values, and it carries them to
    // exactly one person: requireUser above, and `eq('id', user.id)` on the
    // row. Everyone else in a group gets readiness from
    // /api/plans/[planId]/readiness, which has no values in it at all.
    essentials: {
      // The legal name is the same name the app greets them by, deliberately:
      // two copies would drift and the airline would refuse the ticket.
      firstName: row.first_name ?? null,
      lastName: row.last_name ?? null,
      dateOfBirth: row.date_of_birth ?? null,
      // The airline's requirement — no order is accepted without one.
      phone: row.phone ?? null,
      // Undefined means the migration has not run, which the screen shows
      // differently from an unanswered question.
      gender: 'gender' in row ? (row.gender ?? null) : undefined,
      // Never in full, not even to its owner — a phone gets looked over.
      knownTravelerNumber: mask(row.tsa_precheck_enc),
      homeAirport: row.home_airport ?? null,
      seatPreference: row.seat_preference ?? null,
      missing: missingFor({
        firstName: row.first_name,
        lastName: row.last_name,
        dateOfBirth: row.date_of_birth,
        gender: row.gender,
        phone: row.phone,
      }),
    },
    preferences: {
      seat: row.seat_preference ?? null,
      dietary: row.dietary_needs ?? null,
      climate: row.climate_preference ?? null,
    },
    consent: {
      personalized: row.consent_personalized ?? true,
      analytics: row.consent_analytics ?? true,
      marketing: row.consent_marketing ?? false,
      thirdParty: row.consent_third_party ?? false,
    },
    deletion: row.deletion_requested_at
      ? { requestedAt: row.deletion_requested_at, scheduledFor: row.deletion_scheduled_at }
      : null,
    provider: row.auth_provider ?? 'email',
  });
}

const DOC_FIELDS = {
  passport: 'passport_number_enc',
  tsaPrecheck: 'tsa_precheck_enc',
  globalEntry: 'global_entry_enc',
} as const;

// A document is either a non-empty string to store, or null to clear it.
const Schema = z.object({
  passport: z.string().trim().min(4).max(60).nullable().nullish(),
  tsaPrecheck: z.string().trim().min(4).max(60).nullable().nullish(),
  globalEntry: z.string().trim().min(4).max(60).nullable().nullish(),
  seat: z.string().trim().max(40).nullable().nullish(),
  dietary: z.string().trim().max(200).nullable().nullish(),
  climate: z.string().trim().max(40).nullable().nullish(),
  // A three-letter IATA code, upper-cased on the way in so "sfo" and "SFO"
  // are the same airport.
  homeAirport: z.string().trim().regex(/^[A-Za-z]{3}$/, 'An airport code is three letters, like SFO')
    .transform(v => v.toUpperCase()).nullable().optional(),
  homeCity: z.string().trim().max(80).nullable().nullish(),
  // What the app calls you. Clerk has no first name for anyone who signed up
  // with Apple private relay, which is why the home screen said "Hey there".
  firstName: z.string().trim().min(1).max(40).nullable().nullish(),
  lastName: z.string().trim().max(40).nullable().nullish(),
  // Travel essentials. Validated with the same function that decides whether
  // someone is ready to fly, so the form cannot accept a date the readiness
  // check will then call missing.
  dateOfBirth: z.string().trim()
    .refine(v => validBirthDate(v), 'A date of birth looks like 1991-04-02, and is in the past')
    .nullable().optional(),
  gender: z.enum(GENDERS as [string, ...string[]]).nullable().optional(),
  // Checked with the same rule readiness uses, so the form cannot accept a
  // number that the chips will then call missing — or worse, that they will
  // call present right up until the airline refuses it.
  phone: z.string().trim().max(32)
    .refine(v => plausiblePhone(v), 'That does not look like a phone number an airline will accept')
    .nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Check the values and try again', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const updates: Record<string, string | null> = {};
  for (const [key, column] of Object.entries(DOC_FIELDS)) {
    const value = parsed.data[key as keyof typeof DOC_FIELDS];
    if (value === undefined) continue;
    // Encrypting here is the whole point of the column name: the number must
    // never sit in the table in plaintext.
    updates[column] = value === null ? null : encrypt(value);
  }
  for (const [key, column] of [
    ['seat', 'seat_preference'], ['dietary', 'dietary_needs'], ['climate', 'climate_preference'],
    ['homeAirport', 'home_airport'], ['homeCity', 'home_city'],
    ['firstName', 'first_name'], ['lastName', 'last_name'],
    ['dateOfBirth', 'date_of_birth'], ['gender', 'gender'], ['phone', 'phone'],
  ] as const) {
    const value = parsed.data[key];
    if (value !== undefined) updates[column] = value || null;
  }

  // `name` is what the greeting and every member list read, so keep it in step
  // with the parts rather than letting them disagree.
  if (parsed.data.firstName !== undefined || parsed.data.lastName !== undefined) {
    const { data: current } = await ctx.db
      .from('users').select('first_name, last_name').eq('id', ctx.user.id).single();
    const first = parsed.data.firstName !== undefined ? parsed.data.firstName : current?.first_name;
    const last = parsed.data.lastName !== undefined ? parsed.data.lastName : current?.last_name;
    const full = [first, last].filter(Boolean).join(' ').trim();
    if (full) updates.name = full;
  }

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const { error } = await ctx.db.from('users').update(updates).eq('id', ctx.user.id);
  if (error) {
    // Code and message only. Postgres puts "Failing row contains (…)" in
    // error.details, and that row is this person's date of birth — logging
    // the whole object would copy it into the platform's log store.
    console.error('[profile PATCH]', error.code, error.message);
    // The home-airport columns arrive in a migration. Say so plainly instead
    // of "could not save that", which sends someone hunting for a typo.
    const missingColumn = /column "?([a-z_]+)"? .*does not exist/i.exec(error.message || '');
    if (missingColumn) {
      // Name the migration that adds the column that is actually missing —
      // sending someone to the wrong file is worse than saying nothing.
      const file = missingColumn[1] === 'gender'
        ? 'sql/travel-essentials-2026-09-18.sql'
        : 'sql/home-airport-2026-09-12.sql';
      return NextResponse.json({ error: `This needs a migration: run ${file} in Supabase.` }, { status: 503 });
    }
    return NextResponse.json({ error: 'Could not save that' }, { status: 500 });
  }
  return NextResponse.json({ saved: Object.keys(updates).length });
}
