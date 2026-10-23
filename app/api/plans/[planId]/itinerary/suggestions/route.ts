// ─── GET /api/plans/[planId]/itinerary/suggestions — every open one ─────
// The plan screen shows "Sam suggests Bar X · 👍 2" under each line it is
// about; this is all of them in one read, each carrying its itemId, rather
// than one request per line. Read only — suggesting, voting and applying are
// on .../itinerary/[itemId]/suggestions.
//
// Empty, with `closed` saying why, on a trip for one and once the trip is
// locked in.
import { NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { planState, readSuggestions } from '@/lib/itinerary-change-server';
import { suggestionsClosed } from '@/lib/itinerary-change';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const st = await planState(ctx);
  if ('fail' in st) return st.fail;
  const closed = suggestionsClosed(st.state);
  if (closed) return NextResponse.json({ available: true, closed, canApply: false, suggestions: [] });
  const read = await readSuggestions(ctx, st.state.members);
  if (read.error) {
    console.error('[suggestions] could not read the plan\'s suggestions', { plan: params.planId });
    return NextResponse.json({ error: "Couldn't read the suggestions just now." }, { status: 500 });
  }
  return NextResponse.json({ available: read.available, closed: null, canApply: st.state.organiser, suggestions: read.suggestions });
}
