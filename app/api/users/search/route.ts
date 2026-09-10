import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const raw = req.nextUrl.searchParams.get('q') || '';
  // PostgREST parses .or() as an expression: an unescaped comma, paren, or
  // backslash in the term rewrites the filter rather than matching text.
  const q = raw.trim().replace(/[,()\\%*]/g, '').slice(0, 60);
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
