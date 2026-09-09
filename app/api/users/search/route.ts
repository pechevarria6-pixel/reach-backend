import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const q = req.nextUrl.searchParams.get('q') || '';
  if (q.length < 2) return NextResponse.json({ users: [] });
  const supabase = createServerClient();
  const { data: me } = await supabase.from('users').select('id').eq('clerk_id', clerkId).single();
  const { data: users } = await supabase
    .from('users')
    .select('id, name, email, avatar_url')
    .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
    .neq('id', me?.id || '')
    .limit(10);
  return NextResponse.json({ users: users || [] });
}
