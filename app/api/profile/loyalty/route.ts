// ─── /api/profile/loyalty ────────────────────────────────────────────────
// The loyalty_programs table has existed since the first schema with nothing
// reading or writing it, while the Profile screen showed three invented
// memberships. These are the routes that make that list the user's own.
//
// POST   { programName, tier?, points?, number? } → add
// DELETE { id }                                    → remove
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import { encrypt } from '@/lib/encryption';
import { z } from 'zod';

const AddSchema = z.object({
  programName: z.string().trim().min(2).max(80),
  tier: z.string().trim().max(40).optional(),
  points: z.number().int().min(0).max(100_000_000).optional(),
  // The membership number is PII and follows the same rule as a passport:
  // encrypted at rest, never returned.
  number: z.string().trim().min(2).max(60).optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const parsed = AddSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'A programme name is required', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { programName, tier, points, number } = parsed.data;

  const { data, error } = await ctx.db.from('loyalty_programs').insert({
    user_id: ctx.user.id,
    program_name: programName,
    tier: tier || null,
    points: points ?? null,
    // The live table calls this member_number_enc; sql/core-schema.sql
    // says number_enc. The database is the one that runs.
    member_number_enc: number ? encrypt(number) : null,
  }).select('id, program_name, tier, points').single();

  if (error) {
    console.error('[loyalty POST]', error);
    return NextResponse.json({ error: 'Could not add that programme' }, { status: 500 });
  }
  return NextResponse.json({ program: data }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === 'string' ? body.id : null;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // Scoped to the caller so an id from another account cannot be removed.
  const { error } = await ctx.db.from('loyalty_programs')
    .delete().eq('id', id).eq('user_id', ctx.user.id);
  if (error) {
    console.error('[loyalty DELETE]', error);
    return NextResponse.json({ error: 'Could not remove that programme' }, { status: 500 });
  }
  return NextResponse.json({ removed: true });
}
