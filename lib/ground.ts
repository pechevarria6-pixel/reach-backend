// ─── The drive from the airport ──────────────────────────────────────────
// A flight into the nearest airport is half an answer. The other half is a
// car, and Reach puts it on the plan rather than leaving somebody to work
// out at baggage claim that Moab is 110 miles away.
//
// Kayak's car search, opened at the airport and the trip's own dates. The
// shape was requested before this was written — /cars/GJT/2026-11-02/
// 2026-11-09 answers 200 and titles itself "Grand Junction (GJT), 11/2 –
// 11/9" — so it is a search for this trip, not a homepage. Expedia (429) and
// Enterprise (403) could not be checked and are not offered.

export function carRentalUrl(iata: string, pickUp: string, dropOff: string): string | null {
  if (!/^[A-Z]{3}$/.test(iata) || !/^\d{4}-\d{2}-\d{2}$/.test(pickUp) || !/^\d{4}-\d{2}-\d{2}$/.test(dropOff)) return null;
  if (dropOff < pickUp) return null;
  return `https://www.kayak.com/cars/${iata}/${pickUp}/${dropOff}`;
}

/** The line that goes on the plan: what, from where, and how far. */
export function rentalLine(gateway: { iata: string; name: string; miles: number }, town: string, pickUp: string, dropOff: string) {
  const url = carRentalUrl(gateway.iata, pickUp, dropOff);
  if (!url) return null;
  return {
    type: 'transport',
    scheduled_time: 'Before you go',
    title: `Rental car from ${gateway.name} (${gateway.iata})`,
    // Straight-line miles, said as such. The road is longer, and nobody has
    // asked a map for the drive time.
    subtitle: `${town} is about ${gateway.miles} miles away as the crow flies — the drive is longer.`,
    booking_mode: 'ahead',
    venue_website: url,
    venue_name: 'Kayak',
    cost_cents: 0,
    payment_note: null,
    is_confirmed: false,
  };
}
