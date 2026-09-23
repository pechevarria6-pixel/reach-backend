// ─── /api/notifications — my bell ────────────────────────────────────────
// GET  → { available, unread, items }  the latest thirty, mine only
// POST { ids? } → mark read (all of mine when no ids)
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, isFail } from '@/lib/auth';

const Read = z.object({ ids: z.array(z.string().uuid()).max(100).nullish() });

export async function GET() {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;
  const { data, error } = await ctx.db.from('notifications')
    .select('id, kind, title, body, url, plan_id, created_at, read_at')
    .eq('user_id', ctx.user.id).order('created_at', { ascending: false }).limit(30);
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return NextResponse.json({ available: false, unread: 0, items: [] });
    console.error('[notifications] could not read the bell', { code: error.code });
    return NextResponse.json({ error: 'Could not load notifications.' }, { status: 500 });
  }
  return NextResponse.json({ available: true, unread: (data ?? []).filter(n => !n.read_at).length, items: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;
  const parsed = Read.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'Which ones?' }, { status: 400 });
  let q = ctx.db.from('notifications').update({ read_at: new Date().toISOString() })
    .eq('user_id', ctx.user.id).is('read_at', null);
  if (parsed.data.ids?.length) q = q.in('id', parsed.data.ids);
  const { error } = await q;
  if (error) {
    console.error('[notifications] could not mark read', { code: error.code });
    return NextResponse.json({ error: 'Could not update that.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
