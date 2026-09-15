// ─── /api/recommendations ────────────────────────────────────────────────
// Six suggestions for whatever the group is planning: a dinner, a gig, a
// weekend, a fortnight. Reach plans experiences, not only travel.
//
// This route was the last one still on the old pattern — a raw HTTP call to a
// previous-generation model, asking for JSON in the prompt and parsing the
// answer unguarded. The trip path learned each of those lessons by failing in
// production. Applying them here rather than waiting for the same failures.
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';
import {
  RecommendationsSchema, RECOMMENDATIONS_JSON_SCHEMA, EXPERIENCE_BRIEF,
} from '@/lib/recommendation-schema';
import { parseModelJSON, textOf } from '@/lib/trip-schema';

// Six short suggestions while somebody waits on a form. Speed is the feature.
const MODEL = 'claude-haiku-4-5';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[recommendations] ANTHROPIC_API_KEY is not set');
    return NextResponse.json(
      { error: 'Suggestions are switched off for this deployment.' },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const type = typeof body.planType === 'string' && EXPERIENCE_BRIEF[body.planType]
    ? body.planType : 'trip';

  // What this person is actually into. These columns have existed since the
  // first schema and only trip generation ever read them, so a suggestion for
  // a Thursday evening knew nothing about you beyond the form you were on.
  // Reach is a night out as much as a fortnight away; this is the difference
  // between "six restaurants" and "six restaurants for someone who cooks".
  const { data: me } = await ctx.db
    .from('users')
    .select('favorite_activities, cuisines, music_genres, dining_vibe, drink_style, nightlife_style, dietary_needs, no_way_jose, budget_range')
    .eq('id', ctx.user.id).single();

  const list = (v: unknown) => Array.isArray(v) ? v.filter(Boolean).slice(0, 8).join(', ') : '';
  const about = me ? [
    list(me.favorite_activities) && `Into: ${list(me.favorite_activities)}`,
    list(me.cuisines) && `Eats: ${list(me.cuisines)}`,
    list(me.music_genres) && `Listens to: ${list(me.music_genres)}`,
    me.dining_vibe && `Prefers dining: ${me.dining_vibe}`,
    me.drink_style && `Drinks: ${me.drink_style}`,
    me.nightlife_style && `A good night out: ${me.nightlife_style}`,
    me.dietary_needs && `Cannot eat: ${me.dietary_needs}`,
    list(me.no_way_jose) && `Never suggest: ${list(me.no_way_jose)}`,
  ].filter(Boolean).join('\n') : '';

  const prompt = `${EXPERIENCE_BRIEF[type](body)}
${about ? `\nWho this is for:\n${about}\nLean into these. If something here rules a suggestion out, it is out.\n` : ''}

For every suggestion:
- "cost" is what one person actually spends, in whole dollars. Free is 0.
- "booking" is "reach" if it can be reserved through a booking system, "ahead"
  if it needs booking direct, "walk_in" if you just turn up.
- "payment" is what they really take, in a few words — "Cash only", "Cards, no
  Amex", "Contactless everywhere". Say so when somewhere is known for cash
  only; that is the thing nobody finds out until they are standing there.
- "reason" is one sentence on why this group in particular.
- "highlights" is three short specifics — a dish, a room, a support act.

Real places with real names. Never "placeholder", "TBD" or any other filler —
return fewer than six rather than pad.`;

  try {
    const res = await new Anthropic({ apiKey }).messages.create({
      model: MODEL,
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
      output_config: { format: { type: 'json_schema', schema: RECOMMENDATIONS_JSON_SCHEMA } },
    });

    const parsed = parseModelJSON(textOf(res), RecommendationsSchema, 'recommendations');
    const all = parsed?.recommendations ?? [];
    // Same filler rule as the itinerary: a suggestion nobody can act on is
    // worse than one fewer suggestion.
    const recommendations = all.filter(r => r.title && r.title.trim().length > 3);

    if (!recommendations.length) {
      console.error('[recommendations] nothing usable came back', {
        type, stop_reason: res.stop_reason, returned: all.length,
      });
      return NextResponse.json(
        { error: 'No suggestions came back — try adjusting the budget or the vibe.' },
        { status: 502 },
      );
    }

    return NextResponse.json({ recommendations, type });
  } catch (e: any) {
    console.error('[recommendations] generation failed', { type, status: e?.status, message: e?.message });
    const status = e?.status === 429 ? 429 : 502;
    return NextResponse.json(
      { error: status === 429
          ? 'Reach is busy right now — try again in a moment.'
          : 'Could not fetch suggestions — please try again.' },
      { status },
    );
  }
}
