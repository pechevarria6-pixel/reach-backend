// ─── reserve.ts, fed from the database ──────────────────────────────────
// What GET /api/plans/[planId]/reservations, POST /api/bookings/[id]/reserve
// and approval's "Book it" all need to reserve a table: the line's own night
// and time, the venue as we hold it near the trip, the person booking, and
// the dependencies wired to Supabase, the registry and the calling gate.
// Read once here so the three cannot disagree about a table.
import type { SupabaseClient } from '@supabase/supabase-js';
import { heldVenueByRef } from '@/lib/discovery/held-venue';
import { locatePlan } from '@/lib/discovery/geocode';
import { pushSender } from '@/lib/push';
import { tableProviderFor, tableProviderNamed } from '@/lib/booking/registry';
import { report } from '@/lib/report';
import { usableParty } from '@/lib/booking/reservations';
import { partySize as countParty } from '@/lib/participation';
import { tableVenueFacts } from '@/lib/reservations/table-venue';
import { lineWhen } from '@/lib/line-when';
import { twilioLookup } from '@/lib/reservations/policy';
import { providerFor } from '@/lib/reservations/providers';
import { supabaseStore } from '@/lib/reservations/store';
import { supabaseTableStore } from '@/lib/reservations/reserve-store';
import { callCheck, type ReserveDeps, type Requester, type TableFacts, type TableRow } from '@/lib/reservations/reserve';
import type { PlaceInput } from '@/lib/reservations/call';

/** Every column reserve reads. `*` so confirmation_number arrives once its migration has run. */
export const TABLE_ROW = '*';

export type Line = {
  id: string; type: string; title: string | null; scheduled_time: string | null;
  venue_name?: string | null; venue_phone?: string | null; venue_website?: string | null;
  /** The discovery_venues row the line cites (sql/line-venue-ref-2026-11-04.sql); absent before that migration. */
  venue_ref?: string | null;
};
/** `*`, so venue_ref arrives once its migration has run and nothing breaks before. */
export const LINE_COLUMNS = '*';
type Plan = Record<string, any>;

/** Where the trip is, once per request, for finding the venue near it. */
export async function placeOf(plan: Plan): Promise<{ at: { lat: number; lng: number; countryCode: string | null } | null; country: string | null }> {
  const lat = Number(plan.destination_lat), lng = Number(plan.destination_lng);
  const at = plan.destination_lat != null && plan.destination_lng != null && Number.isFinite(lat) && Number.isFinite(lng)
    ? { lat, lng, countryCode: null as string | null }
    : await locatePlan(plan).catch(() => null);
  const country = at?.countryCode || (/^[A-Z]{2}$/i.test(String(plan.destination_country || '')) ? String(plan.destination_country) : null);
  return { at: at ? { lat: at.lat, lng: at.lng, countryCode: at.countryCode ?? null } : null, country };
}

/** The facts for one table, and the venue as the calling assistant needs it. */
export async function tableFacts(
  db: SupabaseClient, plan: Plan, row: TableRow | null, line: Line | null,
  // Where the trip is. No longer used to find the venue — a name near the
  // trip is how a chain's other branch got in — and kept so the callers'
  // shape does not move.
  _where: Awaited<ReturnType<typeof placeOf>>,
): Promise<{ facts: TableFacts; venue: PlaceInput['venue'] }> {
  const payload = (row?.request_payload ?? {}) as { party?: unknown; restaurant?: Record<string, unknown> };
  const r = (payload.restaurant ?? {}) as { name?: string; city?: string; date?: string; time?: string | null; partySize?: number; phone?: string | null };
  const name = String(r.name || line?.venue_name || line?.title || '').trim() || 'The restaurant';
  // The exact row the line cites — never a row found by its name near the
  // trip, which a chain's other branch also is (lib/reservations/table-venue.ts).
  const { venue, error } = await heldVenueByRef(db, line?.venue_ref);
  if (error) console.error('[reserve] could not read the venue', { ref: line?.venue_ref ?? null, code: error.code });

  // The line's own night, worked out from the plan's dates as they are now:
  // a quote stored before the dates moved carries the old night.
  const when = line ? lineWhen(line.scheduled_time, { startDate: plan.start_date, endDate: plan.end_date }) : null;
  const date = when ? when.date : (/^\d{4}-\d{2}-\d{2}$/.test(String(r.date ?? '')) ? String(r.date) : null);
  const time = when ? when.clock : (r.time ?? null);
  // The party the quote was made for; with no quote yet, who is on the trip.
  // It fell back to two, so a table on a trip for one was asked for two.
  const asked = Number(payload.party ?? r.partySize);
  const partySize = usableParty(Number.isFinite(asked) && asked >= 1 ? asked
    : await countParty(db, plan as { group_id?: unknown; solo_mode?: boolean | null }).catch(() => NaN));
  const v = tableVenueFacts({ venue, line, stored: r, restaurant: name, city: r.city ?? null, date, time, partySize });
  const platform = v.platform;
  const reserveUrl = v.reserveUrl;

  return {
    facts: {
      bookingId: row?.id ?? null, itemId: line?.id ?? (row as { itinerary_item_id?: string | null } | null)?.itinerary_item_id ?? null,
      restaurant: name, city: r.city ?? null, platform, date, time, partySize,
      phone: v.phone,
      website: v.website,
      reserveUrl, solo: plan.solo_mode === true,
      // Only the cited row's link: the one place a platform id may come from.
      urls: v.urls,
    },
    venue: venue ? { name, phone: venue.phone, opening_hours: venue.opening_hours ?? null, lng: venue.lng ?? null, reserveUrl } : null,
  };
}

export async function requesterOf(db: SupabaseClient, userId: string): Promise<Requester> {
  const { data, error } = await db.from('users').select('first_name, last_name, name, email, phone').eq('id', userId).maybeSingle();
  if (error) console.error('[reserve] could not read who is booking', { code: error.code });
  const u = (data ?? {}) as { first_name?: string | null; last_name?: string | null; name?: string | null; email?: string | null; phone?: string | null };
  const parts = String(u.name ?? '').trim().split(/\s+/).filter(Boolean);
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    id: userId,
    firstName: s(u.first_name) ?? (parts[0] || null),
    lastName: s(u.last_name) ?? (parts.length > 1 ? parts.slice(1).join(' ') : null),
    email: s(u.email), phone: s(u.phone),
  };
}

export function reserveDeps(db: SupabaseClient): ReserveDeps {
  const lookup = twilioLookup(process.env);
  return {
    instantFor: urls => tableProviderFor(urls),
    bookedOn: provider => tableProviderNamed(provider),
    report: (message, extra) => report(new Error(message), { where: 'reservations/reserve', extra }),
    callCheck: phone => callCheck(process.env, phone, lookup),
    store: supabaseTableStore(db, pushSender()),
    call: {
      env: process.env,
      store: supabaseStore(db, pushSender()),
      lookup,
      provider: g => providerFor(g.provider!, process.env),
    },
  };
}

export function planOf(plan: Plan) {
  return {
    id: String(plan.id), group_id: plan.group_id ?? null, solo: plan.solo_mode === true,
    start_date: plan.start_date ?? null, end_date: plan.end_date ?? null,
  };
}

/** The itinerary line a booking was made from, if it still exists. */
export async function lineOf(db: SupabaseClient, itemId: string | null | undefined): Promise<Line | null> {
  if (!itemId) return null;
  const { data, error } = await db.from('itinerary_items')
    .select(LINE_COLUMNS).eq('id', itemId).maybeSingle();
  if (error) console.error('[reserve] could not read the line', { itemId, code: error.code });
  return (data as Line | null) ?? null;
}

/** What the request body may choose. Anything else in it is ignored. */
export function chosenFrom(body: Record<string, unknown>) {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const path = str(body.path);
  const accept = body.accept && typeof body.accept === 'object' ? body.accept as { terms?: unknown; policy?: unknown } : null;
  return {
    path: path === 'instant' || path === 'call' || path === 'handoff' ? path : undefined,
    time: str(body.time), date: str(body.date),
    holdId: str(body.holdId),
    accept: accept ? { terms: str(accept.terms) ?? null, policy: accept.policy === true } : null,
    notes: str(body.notes),
    change: body.change === true,
    notBookedElsewhere: body.notBookedElsewhere === true,
  } as const;
}
