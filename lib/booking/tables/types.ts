// ─── A table Reach books itself, on a platform that lets it ──────────────
// Two platforms let a partner book a table without the diner leaving the
// app: Yelp Reservations (Partner API) and OpenTable's Consumer API v2.
// Both are contracts Reach does not hold yet, so each provider is switched
// off until its credentials are set — absent is off, never "try anyway".
//
// The flow is the same on both, and it is what the screen walks through:
//
//   openings → hold (≈5 minutes) → the person reads the policy and terms
//   and says yes → reserve → a reservation id from the platform
//
// "Confirmed" is only ever the platform's reservation id. A hold is not a
// booking, and a slot that needs a card is handed to the platform's own page
// rather than booked: Reach does not take a restaurant's deposit.
import type { BookingItemResult, BookingProvider, CancelResult } from '../types.ts';

export type TablePlatform = 'yelp' | 'opentable';
export const TABLE_PLATFORMS: readonly TablePlatform[] = ['opentable', 'yelp'];
export const PLATFORM_LABEL: Record<TablePlatform, string> = { yelp: 'Yelp', opentable: 'OpenTable' };

/** One time a table can be had. */
export interface TableSlot {
  /** YYYY-MM-DD, the restaurant's own day. */
  date: string;
  /** HH:MM, 24-hour, the restaurant's own clock. */
  time: string;
  /**
   * The restaurant wants a card, a deposit or a prepayment for this one.
   * Reach does not book it: `handoffUrl` is the platform's own page for it.
   */
  needsCard: boolean;
  handoffUrl: string | null;
  /** What the platform says about this slot's money, verbatim where it gives words. */
  cardNote?: string | null;
}

/** A slot held for the person while they read the terms. Not a booking. */
export interface TableHold {
  platform: TablePlatform;
  venueId: string;
  /** Yelp's hold_id, OpenTable's reservation_token. */
  holdId: string;
  date: string;
  time: string;
  covers: number;
  /** When the platform lets it go. Both say five minutes. */
  expiresAt: string;
  /** The restaurant's cancellation policy in its own words, or null when the platform gave none. */
  cancellationPolicy: string | null;
  /** Anything else the restaurant asks the diner to know: grace periods, table times. */
  policies: string[];
  /** The platform's own terms the person must accept on screen, or null when it asks for none. */
  terms: TableTerms | null;
  /**
   * A fee the platform passes on, exactly as it gave it. Null when there is
   * none — never a guess at one.
   */
  fee: TableFee | null;
  /** Can be changed in place later (OpenTable), or only cancelled and booked again (Yelp). */
  editable: boolean;
  /** The last moment it can be cancelled, ISO, when the platform says. */
  cancelBy: string | null;
  /** Notes from the restaurant. */
  notes: string | null;
  /** The platform's own page for this slot, where somebody can finish it if Reach cannot. */
  handoffUrl: string | null;
}

export interface TableTerms {
  /** The sentence to show beside the button, word for word. */
  text: string;
  links: { label: string; url: string }[];
  /** What the screen sends back to say it was shown and accepted. */
  version: string;
}

export interface TableFee {
  /** Exactly as the platform requires it be shown, e.g. "OpenTable Service Fee (2%)". */
  label: string;
  amountCents: number;
  taxCents: number;
  currency: string;
}

/** Whoever the table is under. */
export interface TableGuest {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** ISO 3166-1 alpha-2 for the phone, when known. */
  phoneCountry?: string | null;
  notes?: string | null;
}

/**
 * A refusal the screen can act on. `handoff` is where to go next when the
 * platform said no — always the platform's own page or the restaurant's.
 */
export interface TableRefusal {
  ok: false;
  code: TableErrorCode;
  error: string;
  handoffUrl?: string | null;
}

export type TableErrorCode =
  | 'disabled'           // no credentials, or the business is not one Reach may test against
  | 'no_venue_id'        // we hold no id for this restaurant on this platform
  | 'not_on_platform'    // the platform says this restaurant does not take bookings through it
  | 'party_size'         // outside what the platform or restaurant takes
  | 'bad_request'        // a date or time the platform will not read
  | 'slot_gone'          // somebody else got it
  | 'hold_expired'       // the five minutes ran out
  | 'needs_card'         // a card, deposit or prepayment: handed to the platform
  | 'duplicate'          // the diner already has a table that day on this platform
  | 'no_change'          // Yelp cannot change a booking
  | 'cancel_too_late'    // past the restaurant's cutoff, or the time has gone
  | 'already_cancelled'
  | 'rate_limited'
  | 'auth'               // our credentials were refused
  | 'platform_down';     // a 5xx before anything was sent to book

export type Openings = { ok: true; slots: TableSlot[]; minParty?: number | null; maxParty?: number | null } | TableRefusal;
export type HoldResult = { ok: true; hold: TableHold } | TableRefusal;
export type StatusResult =
  | {
      ok: true; active: boolean; date: string | null; time: string | null; covers: number | null; fee: TableFee | null;
      /**
       * Whether the platform still wants a card on its own page before the
       * table is booked: true or false only when its answer says so, null
       * when it does not — and null never moves a row either way.
       */
      owesCard: boolean | null;
      /** The platform says this reservation is cancelled — by the diner, the restaurant, or itself for an unpaid card. */
      cancelled: boolean;
      /** Where the card is added, when the platform gave the page. */
      cardUrl?: string | null;
      raw?: unknown;
    }
  | TableRefusal;

export interface OpeningsAsk { date: string; time: string; covers: number }

/**
 * A platform that books tables. It is also a BookingProvider, so it sits in
 * the registry beside the others and can be asked to quote, book and cancel
 * the same way — but the steps above are what the screen drives.
 */
export interface TableProvider extends BookingProvider {
  vertical: 'restaurant';
  platform: TablePlatform;
  /** Credentials present, and anything else switching it on. */
  enabled(env?: NodeJS.ProcessEnv): boolean;
  /** Whether this one business may be booked now (Yelp tests only against its own test businesses). */
  allows(venueId: string, env?: NodeJS.ProcessEnv): boolean;
  /** The platform's id for a restaurant, only from links we hold for it. */
  venueIdFrom(urls: readonly (string | null | undefined)[]): string | null;
  /** Can a booking be moved in place, or only cancelled and booked again. */
  canModify: boolean;
  openings(venueId: string, ask: OpeningsAsk): Promise<Openings>;
  hold(venueId: string, ask: OpeningsAsk & { uniqueId: string }): Promise<HoldResult>;
  /** Let a hold go. Nothing to undo if it has lapsed. */
  release(hold: TableHold): Promise<void>;
  /**
   * Book the held slot. Returns `confirmed` only with the platform's
   * reservation id; a 2xx without one, a 5xx or no answer throws OutcomeUnknown.
   */
  reserve(hold: TableHold, guest: TableGuest, opts: { reference: string }): Promise<BookingItemResult | TableRefusal>;
  /** Move a booking to the held slot, where the platform allows it. */
  modify?(ref: string, hold: TableHold, guest: TableGuest): Promise<BookingItemResult | TableRefusal>;
  status(ref: string, opts: { covers: number }): Promise<StatusResult>;
  cancel(ref: string, opts?: { confirm?: boolean }): Promise<CancelResult>;
}

export const isRefusal = (x: unknown): x is TableRefusal =>
  !!x && typeof x === 'object' && (x as { ok?: unknown }).ok === false && typeof (x as { code?: unknown }).code === 'string';

/** HH:MM from anything a platform sends: "19:30", "19:30:00", "2026-11-06T19:30". */
export function clockOf(s: unknown): string | null {
  const m = /(?:T|^)(\d{2}):(\d{2})/.exec(String(s ?? ''));
  return m ? `${m[1]}:${m[2]}` : null;
}

/** YYYY-MM-DD from "2026-11-06" or "2026-11-06T19:30". */
export function dayOf(s: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(s ?? ''));
  return m ? m[1] : null;
}

export const HOLD_MINUTES = 5;
