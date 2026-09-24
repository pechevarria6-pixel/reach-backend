import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import { toDateOrNull, nightsBetween } from '@/lib/dates';
import { z } from 'zod';
import { track } from '@/lib/track';
import { destinationPhoto, credit } from '@/lib/discovery/destination-photo';
import { placesFor } from '@/lib/discovery/real-places';
import { within } from '@/lib/deadline';
import { UNDECIDED } from '@/lib/group-answers';
import { waitingTripIn, staleWaitingIn, WAITING_STATUSES } from '@/lib/trip-vote';
import { dayWhere } from '@/lib/calendar';

const CreatePlanSchema = z.object({
  group_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  type: z.enum(['trip', 'restaurant', 'concert', 'weekend']),
  start_date: z.string().nullish(),
  // Where this actually is, in the two parts a hotel provider can search on.
  destination_city: z.string().trim().max(120).nullish(),
  destination_country: z.string().trim().length(2).nullish(),
  end_date: z.string().nullish(),
  budget_cents: z.number().min(0),
  accommodation: z.string().nullish(),
  vibe: z.string().nullish(),
  destination_style: z.string().nullish(),
  dealbreakers: z.array(z.string()).nullish(),
  vote_options: z.array(z.string()).nullish(),
  enable_voting: z.boolean().nullish(),
  // What the organiser wrote when asked what this trip is about. Kept with
  // the plan rather than only on the person, because it is the answer for
  // this trip — and because it is what the readiness gate counts.
  goal_blurb: z.string().trim().max(500).nullish(),
  // What the organiser answered on the trip quiz to get here. Loose on
  // purpose: the quiz's questions are a product decision that changes, and a
  // schema pinned to today's would reject tomorrow's answers.
  trip_answers: z.record(z.unknown()).nullish(),
  // The lines the model wrote about what this option does for whom. Shown on
  // the card they chose from, and worth keeping on the screen they return to.
  why_chosen: z.array(z.string()).nullish(),
  // A trip somebody is taking alone waits for nobody.
  solo_mode: z.boolean().nullish(),
});

// POST /api/plans — create a new plan
export async function POST(req: NextRequest) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  // safeParse, not parse: a throw here surfaces as an opaque 500 and the
  // client cannot tell bad input from a server fault.
  const parsed = CreatePlanSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const body = parsed.data;
  const supabase = ctx.db;

  const user = ctx.user;

  // Verify user is a group member
  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', body.group_id).eq('user_id', user.id).single();
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Built once and inserted twice if need be. why_chosen and solo_mode arrive
  // in migrations, and PostgREST fails the WHOLE insert on a column it does
  // not know — so a migration that had not been run yet would stop anybody
  // creating a trip at all, to keep a line of explanatory text. The trip
  // matters more than the sentence about it.
  // A picture of the place, from Wikimedia Commons, with the photographer
  // and licence beside it. Given a short deadline of its own: a trip card
  // without a photograph is the card as it has always looked, and nobody
  // should wait on an encyclopaedia to save a plan. Null is a fine answer.
  //
  // A group trip still waiting for its destination has no place to picture:
  // its title is "Where next?" or the organiser's sentence, and a photograph
  // looked up from either would be of somewhere nobody is going. It gets its
  // picture when an option is picked (PATCH /api/plans/[planId]).
  const undecided = body.destination_style === UNDECIDED;
  const photo = undecided ? null : await within(
    destinationPhoto([body.destination_city, body.destination_country].filter(Boolean).join(', ') || body.title || ''),
    3000, 'the destination photo',
  ).catch(() => null);

  // Tell the venue sweep this town is wanted, now rather than when somebody
  // asks for the itinerary. The itinerary is what names places, and it is
  // requested later — often much later — so registering the destination the
  // moment a plan exists is the difference between a first trip to a new
  // city naming real places and naming none.
  //
  // Only the registering happens here. The map itself is read by
  // /api/discovery/sweep on a schedule, because Overpass takes tens of
  // seconds when it answers at all and nobody is going to wait for it while
  // saving a plan. Next 14 has no after-response hook to hide that in.
  if (body.destination_city) {
    void within(
      placesFor(supabase, { city: body.destination_city, country: body.destination_country ?? null }),
      3000, 'registering the destination',
    ).catch(() => null);
  }

  const { count: headCount, error: headErr } = await supabase
    .from('group_members').select('user_id', { count: 'exact', head: true }).eq('group_id', body.group_id);
  if (headErr) console.error('[plans] could not count the group — not marking it solo', { code: headErr.code });
  const soloGroup = !headErr && (headCount ?? 0) <= 1;

  // ── One group trip waiting on its destination at a time ─────────────
  // A second "Plan a trip together" while one is still gathering answers or
  // being voted on asked everybody the same questions twice and split the
  // group across two trips, neither of which could ever be found. The
  // caller is given the one that exists instead, and the client opens it.
  // sql/trip-options-2026-09-23.sql adds the index that makes this hold for
  // two requests at the same instant; this is the answer somebody reads.
  //
  // Per kind — a trip being decided does not block a night out — and only
  // while the waiting one is still on by its dates. One whose dates have
  // passed is closed here, because the index cannot read dates and would
  // otherwise refuse this plan over one nobody can go on any more.
  if (undecided) {
    const waiting = await waitingTrip(supabase, body.group_id, body.type);
    if (waiting.live && !soloGroup) return alreadyWaiting(waiting.live);
    if (waiting.stale.length) await closeStale(supabase, body.group_id, waiting.stale);
  }

  const row: Record<string, unknown> = {
    group_id: body.group_id,
    title: body.title,
    type: body.type,
    status: body.enable_voting ? 'voting' : 'planning',
    start_date: toDateOrNull(body.start_date),
    destination_city: body.destination_city || null,
    destination_country: body.destination_country ? body.destination_country.toUpperCase() : null,
    end_date: toDateOrNull(body.end_date),
    budget_cents: body.budget_cents,
    accommodation: body.accommodation || null,
    vibe: body.vibe || null,
    destination_style: body.destination_style || null,
    dealbreakers: body.dealbreakers || [],
    vote_options: body.vote_options || [],
    // The caller's flag, but only for a group that really is one person —
    // the trip generator used to skip the wait for a group saved as solo.
    solo_mode: body.solo_mode === true && soloGroup,
    why_chosen: body.why_chosen?.length ? body.why_chosen : null,
    // Never the picture without the credit: a photograph is somebody's work.
    ...(photo ? { image_url: photo.url, image_credit: credit(photo), image_source: photo.source } : {}),
    created_by: user.id,
  };

  const first = await supabase.from('plans').insert(row).select().single();
  // "Could not find the 'x' column" — drop the ones a migration adds and go
  // again, rather than losing the plan.
  // Dropped one at a time, for as many as this database is missing.
  //
  // This retried exactly once, which was enough while one migration was
  // pending at a time. Three columns arrived together with the destination
  // photograph, so the second unknown one would have failed plan creation
  // outright — the thing the retry exists to prevent. Bounded, so a genuine
  // error cannot become a loop.
  const UNKNOWN = /could not find the '([a-z_]+)' column|column "?([a-z_]+)"? .*does not exist/i;
  let attempt = first;
  for (let i = 0; i < 6 && attempt.error; i++) {
    const missing = UNKNOWN.exec(attempt.error.message || '');
    if (!missing) break;
    const name = missing[1] || missing[2];
    if (!(name in row)) break;
    console.error('[plans POST] retrying without a column this database does not have yet', { column: name });
    delete row[name];
    attempt = await supabase.from('plans').insert(row).select().single();
  }
  const { data: plan, error } = attempt;

  // Lost the race to another request making the same group trip: the
  // unique index refused this one. Theirs is the trip.
  if (error?.code === '23505' && undecided) {
    const existing = await waitingTrip(supabase, body.group_id, body.type);
    if (existing.live) return alreadyWaiting(existing.live);
  }

  if (error || !plan) {
    console.error('[plans POST] insert failed', error);
    return NextResponse.json({ error: error?.message || 'Failed to create plan' }, { status: 500 });
  }

  // The organiser has now said what this trip is for, which is exactly what
  // the readiness gate is waiting to hear. Recording it here is what makes
  // readiness about this trip rather than about a quiz somebody did once.
  if (body.goal_blurb || body.trip_answers) {
    const { error: prefError } = await supabase.from('plan_preferences').upsert({
      plan_id: plan.id,
      user_id: user.id,
      summary_text: body.goal_blurb || null,
      answers: body.trip_answers ?? null,
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'plan_id,user_id' });
    // Never fatal. A plan that exists without its blurb recorded is a working
    // plan; failing the creation over it would lose the trip instead.
    if (prefError) {
      console.error('[plans POST] could not record the goal', { plan: plan.id, code: prefError.code });
    }
  }

  // An audit trail that loses entries silently is how nine plans once

  // vanished with nothing to read afterwards. Never fails the request; it

  // does have to leave a mark.

  const { error: audit } = await supabase.from('audit_logs').insert({ user_id: user.id, action: 'plan_created', resource: 'plans', resource_id: plan.id, success: true });
  if (audit) console.error('[audit] could not record plan_created', { code: audit.code });

  // The top of the funnel, and until now the only event with no call site at
  // all: `track` was imported into this file and never called. Fourteen plans
  // in the table, three of them created after the events table went live, and
  // not one `plan_created` row to show for them — so every number downstream
  // of "somebody started a trip" had no denominator.
  //
  // The audit log above is a different thing for a different reader: it
  // records who did what, for when something has to be answered for. This
  // records that it happened at all.
  void track(supabase, 'plan_created', {
    userId: user.id,
    groupId: String(body.group_id),
    planId: String(plan.id),
    props: {
      kind: String(body.type ?? 'trip'),
      solo: body.solo_mode === true,
      voting: body.enable_voting === true,
      // Where people actually plan to go. Not personal data — a destination —
      // and it is the first question anybody asks of this table.
      city: String(body.destination_city ?? ''),
      country: String(body.destination_country ?? '').toUpperCase(),
      nights: nightsBetween(body.start_date, body.end_date),
      budget_cents: Number(body.budget_cents || 0),
    },
  });

  return NextResponse.json({ plan }, { status: 201 });
}

// "Today" for a server that keeps UTC: the earliest calendar day anywhere.
// A night out in New York is still tonight at 9pm there, when the UTC date
// has already turned over, so a plan only counts as over once it is over
// everywhere — the error this can make is keeping a finished plan waiting a
// few hours longer, never closing one somebody is still on.
function earliestToday(): string {
  return dayWhere(-180);
}

async function waitingTrip(
  db: import('@supabase/supabase-js').SupabaseClient, groupId: string, type: string,
): Promise<{ live: string | null; stale: string[] }> {
  const { data, error } = await db.from('plans')
    .select('id, type, destination_style, status, start_date, end_date, created_at')
    .eq('group_id', groupId).eq('destination_style', UNDECIDED).eq('type', type)
    .in('status', [...WAITING_STATUSES]);
  if (error) {
    // Not a reason to refuse somebody their trip: the index, once it is
    // there, is what holds the line.
    console.error('[plans POST] could not check for a group trip already waiting', { groupId, code: error.code });
    return { live: null, stale: [] };
  }
  const plans = (data ?? []).map(r => ({
    id: String(r.id), type: r.type, destination_style: r.destination_style, status: r.status,
    start_date: r.start_date, end_date: r.end_date, created_at: r.created_at,
  }));
  const today = earliestToday();
  return { live: waitingTripIn(plans, { type, today }), stale: staleWaitingIn(plans, { type, today }) };
}

// A plan still marked waiting whose dates have been and gone. Nobody can go
// on it, and it no longer shows on Home; it is closed so the one-waiting
// index lets the group start the next. Only while it is still undecided and
// waiting — a pick landing at the same moment wins.
async function closeStale(db: import('@supabase/supabase-js').SupabaseClient, groupId: string, ids: string[]) {
  const { error } = await db.from('plans')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .in('id', ids).eq('group_id', groupId).eq('destination_style', UNDECIDED)
    .in('status', [...WAITING_STATUSES]);
  if (error) console.error('[plans POST] could not close a waiting plan whose dates have passed', { groupId, ids, code: error.code });
  else console.log('[plans POST] closed waiting plans whose dates have passed', { groupId, ids });
}

function alreadyWaiting(planId: string) {
  return NextResponse.json({
    error: 'This group already has a trip waiting on everyone — here it is.',
    code: 'already_waiting',
    planId,
  }, { status: 409 });
}
