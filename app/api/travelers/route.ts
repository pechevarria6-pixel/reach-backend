// ─── GET /api/travelers?groupId=… — traveler autofill ────────────────────
// This route used to assemble a full TravelerInfo for every member of a
// group and hand the lot to whoever asked: names, emails, phone numbers,
// dates of birth, Known Traveler Numbers. Membership of a group is not
// consent to be read that way — joining a trip should not disclose your date
// of birth to everyone else on it.
//
// So it now answers two different questions with two different shapes:
//   you       — your own details, in full, for filling your own form
//   travelers — everyone in the group as readiness only: a name the group can
//               already see, ready or not, and which fields are outstanding
//
// The booking machinery does not use this route. It runs server-side at
// approval, reads the rows it needs with the service key, and sends them
// straight to the airline — no client ever holds another person's details.
import { NextRequest, NextResponse } from 'next/server';
import { requireGroupMember, isFail } from '@/lib/auth';
import { maskNumber } from '@/lib/essentials';
import { groupReadiness } from '@/lib/essentials-server';

export async function GET(req: NextRequest) {
  const groupId = req.nextUrl.searchParams.get('groupId');
  if (!groupId) return NextResponse.json({ error: 'groupId required' }, { status: 400 });

  const ctx = await requireGroupMember(groupId);
  if (isFail(ctx)) return ctx.error;

  const { travelers, ready, blocking } = await groupReadiness(ctx.db, groupId);

  // Your own row, in full, because it is yours. Selected by your id rather
  // than filtered out of a group-wide read, so the details of anyone else are
  // never in memory here to be returned by a later mistake.
  // select('*') rather than a column list, so this keeps working in the
  // window between a deploy and the migration that adds `gender` — a named
  // column that does not exist fails the whole select.
  const { data: u, error } = await ctx.db
    .from('users').select('*').eq('id', ctx.user.id).single();

  if (error) {
    console.error('[travelers] could not read your own details', { code: error.code });
    return NextResponse.json({ error: 'Could not read your details just now.' }, { status: 500 });
  }

  const you = u ? {
    userId: ctx.user.id,
    firstName: String(u.first_name || String(u.name || '').split(' ')[0] || ''),
    lastName: String(u.last_name || String(u.name || '').split(' ').slice(1).join(' ') || ''),
    email: String(u.email || ''),
    phone: u.phone ? String(u.phone) : undefined,
    dateOfBirth: u.date_of_birth ? String(u.date_of_birth) : undefined,
    gender: u.gender ? String(u.gender) : undefined,
    // Four characters, even to its owner.
    knownTravelerNumber: maskNumber(u.ktn ? String(u.ktn) : null),
    homeAirport: u.home_airport ? String(u.home_airport) : undefined,
    seatPreference: u.seat_preference ?? null,
    dietaryNeeds: u.dietary_needs ?? null,
    loyaltyPrograms: u.loyalty_programs ?? null,
  } : null;

  return NextResponse.json({ you, travelers, ready, blocking });
}
