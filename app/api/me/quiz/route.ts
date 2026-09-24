// ─── /api/me/quiz ────────────────────────────────────────────────────────
// POST { answers, finish?, skip?, dismiss? } → { profile, stored }
//
// The one way the onboarding quiz, its drip questions and the reveal's dial
// nudges are saved. The browser sends answers; the profile is computed here
// by scoreQuiz and the browser's own preview is never read. A profile the
// client could write is a profile anybody could write.
//
// `stored: false` means the migration (sql/quiz-v3-2026-09-24.sql) has not
// run: the v2 columns were saved and the profile could not be kept. The
// reveal still shows it — it is the server's computation either way.
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import { parseQuizSave } from '@/lib/contracts/traveler-profile';
import { saveQuiz } from '@/lib/quiz-store';

export async function POST(req: NextRequest) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const body = await req.json().catch(() => null);
  const parsed = parseQuizSave(body);
  if (parsed.ok === false) {
    // Which field, not what was in it: the answers include what somebody
    // cannot eat, and that does not belong in a log.
    console.error('[me/quiz] refused a save', { fields: parsed.fields });
    return NextResponse.json({ error: "That answer isn't one we know — try again" }, { status: 400 });
  }

  const result = await saveQuiz(ctx.db, ctx.user.id, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: "Couldn't save that — try again" }, { status: 500 });
  }
  return NextResponse.json({ profile: result.profile, stored: result.stored });
}
