// ─── Checking an itinerary against the world ────────────────────────────
// A generated itinerary names real places and says things about them. The
// naming is usually right and the saying was never checked, which is the
// wrong way round: a wrong restaurant is a disappointing evening, and a
// wrong "cash only" is somebody at a till who cannot pay.
//
// So this reads every item, asks the map and Wikivoyage what they know, and
// writes back only what a source actually says. What nothing says stays
// empty, and empty renders as nothing rather than as reassurance.
//
// Run after generation and on demand. Not inside generation: Overpass takes
// seconds when it is well and 504s when it is not, and an itinerary somebody
// is waiting for must not be held hostage to a donated server's afternoon.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { checkAll, tally } from '@/lib/discovery/verify';
import { attributedNote } from '@/lib/discovery/wikivoyage';
import { locatePlan } from '@/lib/discovery/geocode';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Enough for a fortnight, and a bound on what one request can cost. */
const MAX_ITEMS = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ planId: string }> },
) {
  const { planId } = await params;
  const ctx = await requirePlanMember(planId);
  if (isFail(ctx)) return ctx.error;
  const db = ctx.db;

  const { data: plan, error: planErr } = await db
    .from('plans')
    .select('id, title, destination_city, destination_country')
    .eq('id', planId)
    .maybeSingle();

  if (planErr) {
    console.error('[verify] could not read the plan', { planId, code: planErr.code });
    return NextResponse.json({ error: 'Could not read this trip' }, { status: 500 });
  }
  if (!plan) return NextResponse.json({ error: 'No such trip' }, { status: 404 });

  // `plans` holds a town's name and no coordinate, so the town is located
  // first. Without a point there is no box to search, and a box over the
  // wrong town would confirm the wrong venues — which is worse than not
  // checking at all, because it would report that we had.
  const where = await locatePlan(plan);
  if (!where) {
    return NextResponse.json(
      { error: 'We could not place this trip on the map, so there is nothing we can check against yet.' },
      { status: 409 },
    );
  }

  const { data: items, error: itemsErr } = await db
    .from('itinerary_items')
    .select('id, title, subtitle')
    .eq('plan_id', planId)
    .order('created_at', { ascending: true })
    .limit(MAX_ITEMS);

  if (itemsErr) {
    // A missing column means the migration has not been run. Said plainly,
    // because "column does not exist" tells the owner nothing about what to do.
    if (/verified_|venue_|schema cache/i.test(itemsErr.message || '')) {
      console.error('[verify] the verification columns are not there yet', { planId, code: itemsErr.code });
      return NextResponse.json(
        { error: 'This needs sql/itinerary-verification-2026-09-20.sql in Supabase.' },
        { status: 503 },
      );
    }
    console.error('[verify] could not read the itinerary', { planId, code: itemsErr.code });
    return NextResponse.json({ error: 'Could not read this itinerary' }, { status: 500 });
  }

  const rows = items ?? [];
  if (!rows.length) return NextResponse.json({ checked: 0, ...tally([]) });

  // The map's own name for the town, because it is what Wikivoyage titles
  // its page with and what the search box is centred on.
  const place = { name: where.name, lat: where.lat, lng: where.lng };
  // The title is what names the venue; the subtitle often repeats it with the
  // detail. Both are read, because "Milt's" appears in one or the other.
  const said = rows.map(r => [r.title, r.subtitle].filter(Boolean).join(' · '));

  const checked = await checkAll(said, place);
  const now = new Date().toISOString();

  let stored = 0;
  for (let i = 0; i < rows.length; i++) {
    const c = checked[i];
    const confirmed = c.verification.status === 'confirmed' ? c.verification.facts : null;

    const { error: wrote } = await db
      .from('itinerary_items')
      .update({
        verified_at: now,
        verified_status: c.verification.status,
        verified_source: confirmed ? confirmed.source : null,
        venue_name: confirmed?.name ?? null,
        venue_phone: confirmed?.phone ?? null,
        venue_website: confirmed?.website ?? null,
        venue_note: c.advice ? attributedNote(c.advice) : null,
        venue_note_credit: c.advice?.credit.url ?? null,
        // Only ever what a source records. Null is the common answer and the
        // correct one: of Moab's four confirmed venues, not one carries
        // payment data anywhere we can read.
        payment_note: c.payment,
      })
      .eq('id', rows[i].id);

    // Checked and not stored is not checked. Counted separately rather than
    // reported as a success, which is the failure this codebase keeps finding
    // in its own routes.
    if (wrote) {
      console.error('[verify] could not store what we checked', { item: rows[i].id, code: wrote.code });
      continue;
    }
    stored += 1;
  }

  return NextResponse.json({
    checked: rows.length,
    stored,
    ...tally(checked),
    // Said out loud in the response because it is the point of the whole
    // exercise: confirming a venue exists is not confirming how it takes
    // money, and the two must never be reported as one number.
    note: 'payment is filled in only where a source records it — empty means nobody has checked, never that cards are fine',
  });
}
