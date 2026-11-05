// ─── Table watches, fed from the database ───────────────────────────────
// What the watch routes and the scheduled check need about one restaurant:
// the same facts the booking path reads (lib/reservations/reserve-server.ts
// tableFacts — the venue row the line cites, never a name), and press one
// through reserveTable itself, so a watch holds a table exactly the way the
// Book it button does and nothing else.
import type { SupabaseClient } from '@supabase/supabase-js';
import { heldVenueByRef, venueRefOf } from '@/lib/discovery/held-venue';
import { tableProviderFor } from '@/lib/booking/registry';
import { midClaim } from '@/lib/booking/claim';
import { tableStateOf } from '@/lib/booking/tables/flow';
import { usableParty } from '@/lib/booking/reservations';
import { tableVenueFacts } from '@/lib/reservations/table-venue';
import { reserveTable, type TableFacts, type TableRow } from '@/lib/reservations/reserve';
import { TABLE_ROW, lineOf, planOf, requesterOf, reserveDeps, tableFacts, type Line } from '@/lib/reservations/reserve-server';
import type { PlaceInput } from '@/lib/reservations/call';
import { specOf, type LoadedTable, type TableWatchDeps } from './tables';
import type { WatchRow } from './types';

const NOWHERE = { at: null, country: null };

/** One restaurant someone might watch: from a plan's booking row, or a venue row on its own. */
export interface WatchTarget {
  facts: TableFacts;
  /** The discovery_venues row it cites, or null when it cites none. */
  venueRef: string | null;
  lng: number | null;
  plan: Record<string, any> | null;
  booking: (TableRow & { itinerary_item_id?: string | null }) | null;
  line: Line | null;
  venue: PlaceInput['venue'];
}

export async function bookingTarget(db: SupabaseClient, plan: Record<string, any>, booking: TableRow & { itinerary_item_id?: string | null }): Promise<WatchTarget> {
  const line = await lineOf(db, booking.itinerary_item_id);
  // tableFacts no longer finds the venue by place, so the trip is not
  // geocoded for it: a scheduled check would otherwise ask the geocoder every time.
  const { facts, venue } = await tableFacts(db, plan, booking, line, NOWHERE);
  const venueRef = venue ? venueRefOf(line?.venue_ref) : null;
  return { facts, venueRef, lng: venue?.lng ?? null, plan, booking, line, venue };
}

export async function venueTarget(db: SupabaseClient, ref: unknown, party: number): Promise<WatchTarget | null> {
  const { venue, error } = await heldVenueByRef(db, ref);
  if (error) console.error('[watch] could not read the venue', { code: error.code });
  if (!venue) return null;
  const v = tableVenueFacts({ venue, line: null, stored: null, restaurant: venue.name, city: null, date: null, time: null, partySize: usableParty(party) });
  return {
    facts: {
      bookingId: null, itemId: null, restaurant: venue.name || 'The restaurant', city: null, platform: v.platform,
      date: null, time: null, partySize: usableParty(party), phone: v.phone, reserveUrl: v.reserveUrl, solo: true, urls: v.urls,
    },
    venueRef: venue.id, lng: venue.lng ?? null, plan: null, booking: null, line: null,
    venue: { name: venue.name, phone: venue.phone, opening_hours: venue.opening_hours ?? null, lng: venue.lng ?? null, reserveUrl: v.reserveUrl },
  };
}

export async function readBooking(db: SupabaseClient, id: string): Promise<{ row: (TableRow & { itinerary_item_id?: string | null }) | null; error: boolean }> {
  const { data, error } = await db.from('bookings').select(TABLE_ROW).eq('id', id).maybeSingle();
  if (error) console.error('[watch] could not read the booking', { id, code: error.code });
  return { row: (data as (TableRow & { itinerary_item_id?: string | null }) | null) ?? null, error: !!error };
}

async function readPlan(db: SupabaseClient, id: string): Promise<{ plan: Record<string, any> | null; error: boolean }> {
  const { data, error } = await db.from('plans').select('*').eq('id', id).maybeSingle();
  if (error) console.error('[watch] could not read the plan', { id, code: error.code });
  return { plan: (data as Record<string, any> | null) ?? null, error: !!error };
}

/** How a booking row stands, as a watch needs to know it. */
export function bookingState(b: TableRow & { confirmation_number?: string | null }): NonNullable<LoadedTable['booking']> {
  return {
    status: b.status,
    confirmed: b.status === 'confirmed',
    theirs: !!String(b.confirmation_number ?? '').trim(),
    busy: b.status === 'booking' || midClaim(b),
    holdId: tableStateOf(b as never)?.hold?.holdId ?? null,
  };
}

/** The scheduled check's reads and press one, on the service-role client. */
export function tableWatchDeps(db: SupabaseClient): TableWatchDeps {
  return {
    instantFor: urls => tableProviderFor(urls),

    async load(row: WatchRow) {
      if (row.booking_id) {
        const { row: b, error } = await readBooking(db, row.booking_id);
        if (error) return null;
        if (!b) return { gone: true };
        const { plan, error: planError } = await readPlan(db, b.plan_id);
        if (planError) return null;
        if (!plan) return { gone: true };
        const t = await bookingTarget(db, plan, b);
        // The line now cites another venue, or none: this watch was for the one it cited.
        if (t.venueRef !== row.target_ref) return { gone: true };
        return { restaurant: t.facts.restaurant, urls: t.facts.urls, reserveUrl: t.facts.reserveUrl, lng: t.lng, booking: bookingState(b) };
      }
      const t = await venueTarget(db, row.target_ref, specOf(row).party);
      if (!t) return { gone: true };
      return { restaurant: t.facts.restaurant, urls: t.facts.urls, reserveUrl: t.facts.reserveUrl, lng: t.lng, booking: null };
    },

    async hold(row, slot) {
      // Read fresh: the row's version is what every write below is conditional on.
      const { row: b } = await readBooking(db, row.booking_id!);
      const { plan } = b ? await readPlan(db, b.plan_id) : { plan: null };
      if (!b || !plan) return { ok: false, code: 'changed', status: 409, error: 'The table changed.', alternatives: [] };
      const t = await bookingTarget(db, plan, b);
      const requester = await requesterOf(db, row.user_id);
      return reserveTable(
        {
          // The party the watch was set for; the hold books that many.
          booking: b, facts: { ...t.facts, partySize: specOf(row).party }, plan: planOf(plan), requester, venue: t.venue, line: t.line,
          chosen: { path: 'instant', date: slot.date, time: slot.time, watch: true },
        },
        reserveDeps(db),
      );
    },
  };
}
