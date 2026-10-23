// ─── /api/plans/[planId]/itinerary/[itemId]/suggestions ─────────────────
// "Sam suggests Bar X · 👍 2", before a group trip is locked in.
//
// GET  → { available, closed, canApply, suggestions: [...] }, most 👍 first.
// POST { action: 'suggest', to: "<ref>", note? }   any member; the place must
//        be one of this line's alternatives (the verified menu, same kind,
//        near the day, open then). The same place suggested twice for one
//        line is one suggestion with two 👍 — the open-suggestion unique
//        index makes a double-tap the same. With `title`, it is a member's
//        "Something else…": any menu type, the title kept with it.
// POST { action: 'vote' | 'unvote', suggestionId }   any member, one 👍 each.
// POST { action: 'withdraw', suggestionId }           whoever suggested it.
// POST { action: 'apply' | 'dismiss', suggestionId }  the organiser. Apply
//        swaps the line exactly as PATCH .../[itemId] does.
//
// Closed on a trip for one — there is nobody to suggest to — and once the
// trip is locked in, when only the organiser changes a line (decision 14).
// Both are refused here as well as left off the screen.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlanMember, isFail } from '@/lib/auth';
import {
  readLine, menuFor, swapLine, candidateFor, readSuggestions, suggestionsMissing, SUGGESTIONS_SQL,
} from '@/lib/itinerary-change-server';
import { suggestionsClosed } from '@/lib/itinerary-change';
import { whyLine, titleNaming, slotCostCents, BOOKING_TYPES } from '@/lib/itinerary-alternatives';

export const dynamic = 'force-dynamic';

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('suggest'), to: z.string().regex(/^v:[0-9a-f]{8}$/), title: z.string().trim().min(1).max(200).nullish(), cost: z.number().min(0).max(5000).nullish(), note: z.string().trim().max(280).nullish() }),
  z.object({ action: z.enum(['vote', 'unvote', 'withdraw', 'apply', 'dismiss']), suggestionId: z.string().uuid() }),
]);

const CLOSED: Record<'solo' | 'locked', string> = {
  solo: 'Suggestions are for planning with other people — change this line from Change instead.',
  locked: 'This trip is locked in, so suggestions are closed — the organiser changes lines now.',
};

const notReady = () => {
  console.error(`[suggestions] the tables are not there — run ${SUGGESTIONS_SQL}`);
  return NextResponse.json({ code: 'not_migrated', error: "Suggestions aren't switched on yet." }, { status: 503 });
};

export async function GET(_req: Request, { params }: { params: { planId: string; itemId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const got = await readLine(ctx, params.itemId);
  if ('fail' in got) return got.fail;
  const lc = got.line;
  const closed = suggestionsClosed(lc);
  // Nothing to show on a trip for one or once it is locked: the screen has
  // no suggestions to render, so none are sent.
  if (closed) return NextResponse.json({ available: true, closed, suggestions: [], canApply: false });
  const read = await readSuggestions(ctx, lc.members, params.itemId);
  if (read.error) {
    console.error('[suggestions] could not read this line\'s suggestions', { plan: params.planId, item: params.itemId });
    return NextResponse.json({ error: "Couldn't read the suggestions just now." }, { status: 500 });
  }
  return NextResponse.json({ available: read.available, closed: null, canApply: lc.organiser, suggestions: read.suggestions });
}

export async function POST(req: NextRequest, { params }: { params: { planId: string; itemId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;

  const got = await readLine(ctx, params.itemId);
  if ('fail' in got) return got.fail;
  const lc = got.line;
  const closed = suggestionsClosed(lc);
  if (closed) return NextResponse.json({ code: closed, error: CLOSED[closed] }, { status: 409 });
  if (BOOKING_TYPES.has(String(lc.item.type))) {
    return NextResponse.json({ code: 'use_options', error: 'Hotels and flights are changed from their options, not suggested here.' }, { status: 409 });
  }
  const { db } = ctx;
  const me = ctx.user.id;

  if (body.action === 'suggest') {
    const places = await menuFor(db, lc.plan);
    const free = !!body.title;
    const place = candidateFor(lc, places, body.to, { anyType: free });
    if (!place) {
      return NextResponse.json({ code: 'not_offered', error: "That place isn't one we can put on this line — reopen Change to see what is." }, { status: 409 });
    }
    const title = free ? titleNaming(body.title, place) : null;
    // A snapshot for the card. candidate_ref is the identity; this is what
    // the menu said about it when it was suggested, every word from the row.
    const candidate = {
      name: place.name, kind: place.kind, street: place.street ?? null, url: place.url ?? null,
      why: whyLine(place, null, lc.nightOut ? 'your evening' : 'the day'),
      ...(free ? { free: true, title, cost_cents: slotCostCents(body.cost) } : {}),
    };
    const { data: made, error } = await db.from('itinerary_item_suggestions').insert({
      plan_id: lc.plan.id, item_id: params.itemId, suggested_by: me,
      candidate_ref: body.to, candidate, note: body.note || null,
    }).select('id').maybeSingle();
    if (error && suggestionsMissing(error)) return notReady();
    if (error && error.code !== '23505') {
      console.error('[suggestions] could not store it', { plan: lc.plan.id, item: params.itemId, code: error.code });
      return NextResponse.json({ error: "Couldn't save that suggestion just now." }, { status: 500 });
    }
    let id = made?.id ? String(made.id) : null;
    let joined = false;
    if (!id) {
      // Already suggested by somebody — the unique index said so. Theirs is
      // the suggestion; this person's tap is a 👍 on it.
      const { data: open, error: findErr } = await db.from('itinerary_item_suggestions')
        .select('id').eq('item_id', params.itemId).eq('candidate_ref', body.to).eq('status', 'open').maybeSingle();
      if (findErr || !open) {
        console.error('[suggestions] a duplicate with nothing to join', { item: params.itemId, code: findErr?.code });
        return NextResponse.json({ error: "Couldn't save that suggestion just now." }, { status: 500 });
      }
      id = String(open.id);
      joined = true;
      const { error: vErr } = await db.from('itinerary_item_suggestion_votes')
        .upsert({ suggestion_id: id, user_id: me }, { onConflict: 'suggestion_id,user_id', ignoreDuplicates: true });
      if (vErr) {
        console.error('[suggestions] could not add the vote to the existing one', { suggestion: id, code: vErr.code });
        return NextResponse.json({ error: "Couldn't save that just now." }, { status: 500 });
      }
    }
    const read = await readSuggestions(ctx, lc.members, params.itemId);
    return NextResponse.json({ suggestionId: id, joined, suggestions: read.suggestions }, { status: joined ? 200 : 201 });
  }

  // Everything else acts on one open suggestion for this line.
  const { data: s, error: sErr } = await db.from('itinerary_item_suggestions')
    .select('id, item_id, suggested_by, candidate_ref, candidate, status').eq('id', body.suggestionId).maybeSingle();
  if (sErr && suggestionsMissing(sErr)) return notReady();
  if (sErr) {
    console.error('[suggestions] could not read it', { suggestion: body.suggestionId, code: sErr.code });
    return NextResponse.json({ error: "Couldn't read that suggestion just now." }, { status: 500 });
  }
  if (!s || s.item_id !== params.itemId) return NextResponse.json({ error: 'That suggestion is not on this line.' }, { status: 404 });
  if (s.status !== 'open') return NextResponse.json({ code: 'decided', error: 'That suggestion has already been dealt with.' }, { status: 409 });

  if (body.action === 'vote' || body.action === 'unvote') {
    const { error } = body.action === 'vote'
      ? await db.from('itinerary_item_suggestion_votes')
        .upsert({ suggestion_id: s.id, user_id: me }, { onConflict: 'suggestion_id,user_id', ignoreDuplicates: true })
      : await db.from('itinerary_item_suggestion_votes').delete().eq('suggestion_id', s.id).eq('user_id', me);
    if (error) {
      console.error('[suggestions] could not record the vote', { suggestion: s.id, action: body.action, code: error.code });
      return NextResponse.json({ error: "Couldn't save that just now." }, { status: 500 });
    }
    const read = await readSuggestions(ctx, lc.members, params.itemId);
    return NextResponse.json({ suggestions: read.suggestions });
  }

  const decide = async (status: 'applied' | 'withdrawn' | 'dismissed') => {
    const { data, error } = await db.from('itinerary_item_suggestions')
      .update({ status, decided_by: me, decided_at: new Date().toISOString() })
      .eq('id', s.id).eq('status', 'open').select('id').maybeSingle();
    if (error) console.error('[suggestions] could not mark it', { suggestion: s.id, status, code: error.code });
    return { ok: !error, won: !!data };
  };

  if (body.action === 'withdraw') {
    if (s.suggested_by !== me) return NextResponse.json({ error: 'Only whoever suggested it can take it back.' }, { status: 403 });
    const d = await decide('withdrawn');
    if (!d.ok) {
      console.error('[suggestions] could not withdraw it', { suggestion: s.id });
      return NextResponse.json({ error: "Couldn't take that back just now." }, { status: 500 });
    }
    const read = await readSuggestions(ctx, lc.members, params.itemId);
    return NextResponse.json({ suggestions: read.suggestions });
  }

  // apply and dismiss: the organiser's.
  if (!lc.organiser) {
    return NextResponse.json({ code: 'organiser_only', error: `${lc.organiserName || 'The organiser'} decides on suggestions.` }, { status: 403 });
  }
  if (body.action === 'dismiss') {
    const d = await decide('dismissed');
    if (!d.ok) {
      console.error('[suggestions] could not dismiss it', { suggestion: s.id });
      return NextResponse.json({ error: "Couldn't do that just now." }, { status: 500 });
    }
    const read = await readSuggestions(ctx, lc.members, params.itemId);
    return NextResponse.json({ suggestions: read.suggestions });
  }

  // apply. Resolved against the menu as it is now: a place that has since
  // shut that day, or left the map, is not put on the plan on the strength
  // of a suggestion made last week.
  const places = await menuFor(db, lc.plan);
  const snap = (s.candidate && typeof s.candidate === 'object' ? s.candidate : {}) as { free?: unknown; title?: unknown; cost_cents?: unknown };
  const place = candidateFor(lc, places, s.candidate_ref, { anyType: snap.free === true });
  if (!place) {
    return NextResponse.json({
      code: 'not_offered',
      error: "That place can't go on this line any more — it may not be open then, or it is already on the plan. Nothing was changed.",
    }, { status: 409 });
  }
  const swapped = await swapLine(ctx, lc, places, place, 'suggestion', {
    suggestionId: String(s.id), title: typeof snap.title === 'string' ? snap.title : null,
    costCents: typeof snap.cost_cents === 'number' ? snap.cost_cents : null,
  });
  if (!swapped.ok) return swapped;
  // The line has changed; the suggestion is marked after it, so a failure
  // here leaves an applied place under an open card rather than a card
  // saying "applied" over a line that never changed.
  const d = await decide('applied');
  if (!d.ok) console.error('[suggestions] the line was swapped and the suggestion is still open', { suggestion: s.id });
  const body2 = await swapped.json();
  const read = await readSuggestions(ctx, lc.members, params.itemId);
  return NextResponse.json({ ...body2, suggestions: read.suggestions });
}
