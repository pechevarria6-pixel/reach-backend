// Canonical provider ids the advisory engine understands. This lives outside
// the route file because Next.js only permits route-handler exports there.
export const KNOWN_PROVIDERS = [
  'united', 'american', 'delta', 'alaska', 'jetblue', 'southwest',
  'chase_travel', 'amex_travel', 'citi_travel', 'capitalone_travel',
  'ticketmaster', 'axs', 'seatgeek', 'dice', 'eventbrite',
  'opentable', 'resy', 'tock',
] as const;

export type KnownProvider = (typeof KNOWN_PROVIDERS)[number];
