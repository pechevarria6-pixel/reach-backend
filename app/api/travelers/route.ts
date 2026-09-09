// ─── GET /api/travelers?groupId=… — traveler autofill ────────────────────
// Assembles TravelerInfo for every group member from stored profiles so no
// booking form (native or redirected) ever asks for anything twice.
// Sources: users table (name/email/dob) + loyalty columns already in schema.
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';

const supabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const groupId = req.nextUrl.searchParams.get('groupId');
  if (!groupId) return NextResponse.json({ error: 'groupId required' }, { status: 400 });

  const db = supabase();
  const { data: members, error } = await db
    .from('group_members').select('user_id, users(*)').eq('group_id', groupId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const travelers = (members || []).map((m: { user_id: string; users: Record<string, unknown> | null }) => {
    const u = m.users || {};
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
