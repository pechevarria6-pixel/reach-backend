// ─── reserve.ts, fed from the database ──────────────────────────────────
// What GET /api/plans/[planId]/reservations, POST /api/bookings/[id]/reserve
// and approval's "Book it" all need to reserve a table: the line's own night
// and time, the venue as we hold it near the trip, the person booking, and
// the dependencies wired to Supabase, the registry and the calling gate.
// Read once here so the three cannot disagree about a table.
import type { SupabaseClient } from '@supabase/supabase-js';
import { heldVenueNear } from '@/lib/discovery/held-venue';
import { locatePlan } from '@/lib/discovery/geocode';
import { pushSender } from '@/lib/push';
import { tableProvider } from '@/lib/booking/registry';
import { reservationUrl, usableStoredUrl, usableParty, type Platform } from '@/lib/booking/reservations';
import { lineWhen } from '@/lib/line-when';
import { twilioLookup } from '@/lib/reservations/policy';
import { providerFor } from '@/lib/reservations/providers';
import { supabaseStore } from '@/lib/reservations/store';
import { supabaseTableStore } from '@/lib/reservations/reserve-store';
import { callCheck, type ReserveDeps, type Requester, type TableFacts, type TableRow } from '@/lib/reservations/reserve';
import type { PlaceInput } from '@/lib/reservations/call';

/** Every column reserve reads. `*` so confirmation_number arrives once its migration has run. */
export const TABLE_ROW = '*';

export type Line = { id: string; type: string; title: string | null; scheduled_time: string | null; venue_name?: string | null; venue_phone?: string | null };
type Plan = Record<string, any>;

const PLATFORMS = new Set(['resy', 'opentable', 'tock', 'sevenrooms', 'yelp', 'thefork']);

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
  where: Awaited<ReturnType<typeof placeOf>>,
): Promise<{ facts: TableFacts; venue: PlaceInput['venue'] }> {
  const payload = (row?.request_payload ?? {}) as { party?: unknown; restaurant?: Record<string, unknown> };
  const r = (payload.restaurant ?? {}) as { name?: string; city?: string; date?: string; time?: string | null; partySize?: number; platform?: string; externalUrl?: string; phone?: string | null };
  const name = String(r.name || line?.venue_name || line?.title || '').trim() || 'The restaurant';
  const { venue, error } = await heldVenueNear(db, name, where.at, { country: where.country });
  if (error) console.error('[reserve] could not read the venue', { name, code: error.code });

  // The line's own night, worked out from the plan's dates as they are now:
  // a quote stored before the dates moved carries the old night.
  const when = line ? lineWhen(line.scheduled_time, { startDate: plan.start_date, endDate: plan.end_date }) : null;
  const date = when ? when.date : (/^\d{4}-\d{2}-\d{2}$/.test(String(r.date ?? '')) ? String(r.date) : null);
  const time = when ? when.clock : (r.time ?? null);
  const stated = String(r.platform ?? '');
  const held = String(venue?.reservation_platform ?? '');
  const platform = (PLATFORMS.has(stated) ? stated : PLATFORMS.has(held) ? held : 'none') as Platform;
  const partySize = usableParty(Number(payload.party ?? r.partySize));
  const known = venue?.reservation_url ?? r.externalUrl ?? null;
  const reserveUrl = reservationUrl(platform, { name, city: r.city ?? null, date, time, partySize, knownUrl: known })
    ?? usableStoredUrl('none', known) ?? row?.redirect_url ?? null;

  return {
    facts: {
      bookingId: row?.id ?? null, itemId: line?.id ?? (row as { itinerary_item_id?: string | null } | null)?.itinerary_item_id ?? null,
      restaurant: name, city: r.city ?? null, platform, date, time, partySize,
      phone: venue?.phone ?? r.phone ?? line?.venue_phone ?? null,
      reserveUrl, solo: plan.solo_mode === true,
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
    instantFor: platform => tableProvider(platform),
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
    .select('id, type, title, scheduled_time, venue_name, venue_phone').eq('id', itemId).maybeSingle();
  if (error) console.error('[reserve] could not read the line', { itemId, code: error.code });
  return (data as Line | null) ?? null;
}

/** What the request body may choose. Anything else in it is ignored. */
export function chosenFrom(body: Record<string, unknown>) {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const path = str(body.path);
  return {
    path: path === 'instant' || path === 'call' || path === 'handoff' ? path : undefined,
    time: str(body.time), date: str(body.date), acceptTerms: str(body.acceptTerms),
    notBookedElsewhere: body.notBookedElsewhere === true,
  } as const;
}
