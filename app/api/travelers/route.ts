// ─── GET /api/travelers?groupId=… — traveler autofill ────────────────────
// Assembles TravelerInfo for every group member from stored profiles so no
// booking form (native or redirected) ever asks for anything twice.
// Sources: users table (name/email/dob) + loyalty columns already in schema.
import { NextRequest, NextResponse } from 'next/server';
import { requireGroupMember, isFail } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const groupId = req.nextUrl.searchParams.get('groupId');
  if (!groupId) return NextResponse.json({ error: 'groupId required' }, { status: 400 });

  // Traveler records carry names, emails and dates of birth — group members only.
  const ctx = await requireGroupMember(groupId);
  if (isFail(ctx)) return ctx.error;

  const { data: members, error } = await ctx.db
    .from('group_members').select('user_id, users(*)').eq('group_id', groupId);
  console.error('[travelers] failed', error);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const travelers = (members || []).map((m: any) => {
    // Supabase types an embedded row as an array; a to-one join returns an object.
    const u: Record<string, unknown> = (Array.isArray(m.users) ? m.users[0] : m.users) || {};
    const name = String(u.name || '');
    return {
      userId: m.user_id,
      firstName: String(u.first_name || name.split(' ')[0] || ''),
      lastName: String(u.last_name || name.split(' ').slice(1).join(' ') || ''),
      email: String(u.email || ''),
      phone: u.phone ? String(u.phone) : undefined,
      dateOfBirth: u.date_of_birth ? String(u.date_of_birth) : undefined,
      knownTravelerNumber: u.ktn ? String(u.ktn) : undefined,
      loyaltyPrograms: u.loyalty_programs || null,   // fed to Duffel bookings for mileage accrual
      seatPreference: u.seat_preference || null,
      dietaryNeeds: u.dietary_needs || null,
    };
  });
  return NextResponse.json({ travelers });
}
