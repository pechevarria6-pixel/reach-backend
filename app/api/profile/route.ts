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
import { z } from 'zod';

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

  const [memberships, loyalty, connected, payments] = await Promise.all([
    db.from('group_members').select('group_id').eq('user_id', user.id),
    db.from('loyalty_programs').select('id, program_name, tier, points').eq('user_id', user.id).order('created_at'),
    db.from('connected_accounts').select('provider, label, status, last_used_at').eq('user_id', user.id),
    db.from('payments')
      .select('id, amount_cents, currency, status, refund_amount_cents, created_at')
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
  let cards: any[] = [];
  if (row.stripe_customer_id) {
    try {
      const { stripe } = await import('@/lib/stripe');
      const list = await stripe.paymentMethods.list({ customer: row.stripe_customer_id, type: 'card', limit: 10 });
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
    payments: payments.data || [],
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
  passport: z.string().trim().min(4).max(60).nullable().optional(),
  tsaPrecheck: z.string().trim().min(4).max(60).nullable().optional(),
  globalEntry: z.string().trim().min(4).max(60).nullable().optional(),
  seat: z.string().trim().max(40).nullable().optional(),
  dietary: z.string().trim().max(200).nullable().optional(),
  climate: z.string().trim().max(40).nullable().optional(),
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
  for (const [key, column] of [['seat', 'seat_preference'], ['dietary', 'dietary_needs'], ['climate', 'climate_preference']] as const) {
    const value = parsed.data[key];
    if (value !== undefined) updates[column] = value || null;
  }

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const { error } = await ctx.db.from('users').update(updates).eq('id', ctx.user.id);
  if (error) {
    console.error('[profile PATCH]', error);
    return NextResponse.json({ error: 'Could not save that' }, { status: 500 });
  }
  return NextResponse.json({ saved: Object.keys(updates).length });
}
