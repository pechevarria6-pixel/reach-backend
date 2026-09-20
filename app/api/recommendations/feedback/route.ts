// ─── Saying "been there" or "not for me" about a suggestion ─────────────
// Discover kept offering places somebody had already been to, and the only
// way to say so was to stop opening the screen.
//
// Two verdicts, kept apart on purpose: 'done' is a positive signal — they
// went, they may go again, and the choice says what they like — while
// 'not_interested' is a refusal that never comes back. One "hide" button
// would have lost the difference.
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import { hiddenFor, type Feedback, type Verdict } from '@/lib/recommendation-memory';

export const dynamic = 'force-dynamic';

const VERDICTS: Verdict[] = ['done', 'not_interested'];

/** Everything this person has ruled on, for the screen to filter with. */
export async function GET() {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const { data, error } = await ctx.db
    .from('recommendation_feedback')
    .select('item_ref, vertical, verdict, created_at, title')
    .eq('user_id', ctx.user.id);

  if (error) {
    if (/recommendation_feedback|schema cache|PGRST205/i.test(`${error.code} ${error.message}`)) {
      // The migration has not been run. Nothing is hidden, which is exactly
      // how the screen behaved before any of this existed.
      console.error('[feedback] the table is not there yet — nothing is hidden');
      return NextResponse.json({ feedback: [], hidden: [], available: false });
    }
    console.error('[feedback] could not read', { code: error.code });
    return NextResponse.json({ error: 'Could not read your preferences' }, { status: 500 });
  }

  const feedback: Feedback[] = (data ?? []).map(r => ({
    itemRef: String(r.item_ref),
    vertical: String(r.vertical ?? 'unknown'),
    verdict: r.verdict as Verdict,
    at: String(r.created_at),
  }));

  return NextResponse.json({
    feedback: (data ?? []).map(r => ({
      itemRef: r.item_ref, vertical: r.vertical, verdict: r.verdict, title: r.title,
    })),
    // Worked out on the server so every screen hides the same things: a
    // refusal is permanent, somewhere they have been comes back only if it
    // is the kind of place worth going to twice, and not for months.
    hidden: [...hiddenFor(feedback)],
    available: true,
  });
}

/** "Already done it" or "Not for me", from the × on a card. */
export async function POST(req: NextRequest) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const body = await req.json().catch(() => ({}));
  const itemRef = String(body.itemRef ?? '').trim();
  const verdict = String(body.verdict ?? '') as Verdict;

  if (!itemRef) return NextResponse.json({ error: 'Which place?' }, { status: 400 });
  if (!VERDICTS.includes(verdict)) {
    return NextResponse.json({ error: 'That is not one of the two answers' }, { status: 400 });
  }

  // Replaced rather than added to: the latest verdict wins, because people
  // change their minds and the older row must not.
  const { error } = await ctx.db
    .from('recommendation_feedback')
    .upsert({
      user_id: ctx.user.id,
      group_id: body.groupId ?? null,
      item_ref: itemRef,
      vertical: String(body.vertical ?? 'unknown'),
      title: body.title ? String(body.title).slice(0, 200) : null,
      verdict,
      created_at: new Date().toISOString(),
    }, { onConflict: 'user_id,item_ref' });

  if (error) {
    if (/recommendation_feedback|schema cache|PGRST205/i.test(`${error.code} ${error.message}`)) {
      console.error('[feedback] the table is not there yet', { code: error.code });
      return NextResponse.json(
        { error: 'This needs sql/recommendation-feedback-2026-09-20.sql in Supabase.' },
        { status: 503 },
      );
    }
    console.error('[feedback] could not store', { code: error.code });
    return NextResponse.json({ error: "We couldn't save that just now" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, itemRef, verdict });
}

/** Undo. The row goes, so the place is offered again as though nothing was said. */
export async function DELETE(req: NextRequest) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const itemRef = String(new URL(req.url).searchParams.get('itemRef') ?? '').trim();
  if (!itemRef) return NextResponse.json({ error: 'Which place?' }, { status: 400 });

  const { error } = await ctx.db
    .from('recommendation_feedback')
    .delete()
    .eq('user_id', ctx.user.id)
    .eq('item_ref', itemRef);

  if (error) {
    console.error('[feedback] could not undo', { code: error.code });
    return NextResponse.json({ error: "We couldn't undo that just now" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, itemRef });
}
