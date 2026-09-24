// ─── The world's most visited places, as towns the map load reads around ─
// The owner asked for trips to the top visited places in the world,
// including the Seven Wonders. The map load only knows a place once a seed
// sits on it, and seeds used to come only from what somebody had already
// planned. This is the list that puts the rest of the world on the map
// before anybody asks.
//
// Two kinds of entry:
//
//   Cities, from Euromonitor International, "Top 100 City Destinations:
//   2019 Edition" (international arrivals in 2018), the most recent edition
//   whose whole ranking is public — later editions publish only a top ten.
//   The fifty highest ranked, in the source's order, no more and no fewer,
//   and `rank` is the source's rank, never ours. The table was read from
//   the transcription at en.wikipedia.org/wiki/List_of_cities_by_
//   international_visitors (2016/2018 section), which cites the Euromonitor
//   white paper, on 2026-09-24.
//
//   Wonders: the New 7 Wonders of the World (New7Wonders Foundation, 2007)
//   and the Great Pyramid of Giza, the one ancient wonder still standing.
//   A wonder is a site, not a town, so the seed is the town people actually
//   sleep in, and `site` names what it is there for. Where the site is
//   further from that town than the itinerary menu reads (twenty-five
//   miles, real-places.ts), the town right beside it is seeded as well:
//   Machu Picchu is fifty miles from Cusco by rail and a bus ride from
//   Aguas Calientes, and the Great Wall at Mutianyu is forty miles from
//   central Beijing.
//
// Coordinates are town centres, each checked on 2026-09-24 against the
// coordinates English Wikipedia's article carries for the place (Nominatim
// was refusing requests that day). All agree to within three miles except
// three deliberate choices: Mumbai is the old city by CST, where visitors
// stay, not the geographic centre ten miles north; Tokyo is Tokyo Station,
// four miles from the Metropolitan Government in Shinjuku; Riyadh is the
// modern centre, six miles from the old one. Which Geofabrik file each is
// read from is not typed here: scripts/ingest/world-regions.mjs works it out
// from Geofabrik's own index and writes world-regions.generated.ts.

export interface WorldDestination {
  /** The town, as the seed and the menu name it. */
  name: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  lat: number;
  lng: number;
  /** What people come for, when that is a site outside the town. */
  site?: string;
  /** Euromonitor Top 100 City Destinations 2019 rank (2018 arrivals), when it is one. */
  rank?: number;
}

/** Euromonitor's top fifty, in its order. */
const TOP_CITIES: WorldDestination[] = [
  { rank: 1, name: 'Hong Kong', country: 'HK', lat: 22.2793, lng: 114.1628 },
  { rank: 2, name: 'Bangkok', country: 'TH', lat: 13.7525, lng: 100.4935 },
  { rank: 3, name: 'London', country: 'GB', lat: 51.5073, lng: -0.1277 },
  { rank: 4, name: 'Macau', country: 'MO', lat: 22.1987, lng: 113.5439 },
  { rank: 5, name: 'Singapore', country: 'SG', lat: 1.2903, lng: 103.8520 },
  { rank: 6, name: 'Paris', country: 'FR', lat: 48.8566, lng: 2.3522 },
  { rank: 7, name: 'Dubai', country: 'AE', lat: 25.2048, lng: 55.2708 },
  { rank: 8, name: 'New York', country: 'US', lat: 40.7128, lng: -74.0060 },
  { rank: 9, name: 'Kuala Lumpur', country: 'MY', lat: 3.1390, lng: 101.6869 },
  { rank: 10, name: 'Istanbul', country: 'TR', lat: 41.0082, lng: 28.9784 },
  { rank: 11, name: 'Delhi', country: 'IN', lat: 28.6139, lng: 77.2090 },
  { rank: 12, name: 'Antalya', country: 'TR', lat: 36.8969, lng: 30.7133 },
  { rank: 13, name: 'Shenzhen', country: 'CN', lat: 22.5431, lng: 114.0579 },
  { rank: 14, name: 'Mumbai', country: 'IN', lat: 18.9388, lng: 72.8354 },
  { rank: 15, name: 'Phuket', country: 'TH', lat: 7.8804, lng: 98.3923 },
  { rank: 16, name: 'Rome', country: 'IT', lat: 41.8933, lng: 12.4829, site: 'Colosseum' },
  { rank: 17, name: 'Tokyo', country: 'JP', lat: 35.6812, lng: 139.7671 },
  { rank: 18, name: 'Pattaya', country: 'TH', lat: 12.9236, lng: 100.8825 },
  { rank: 19, name: 'Taipei', country: 'TW', lat: 25.0375, lng: 121.5637 },
  { rank: 20, name: 'Mecca', country: 'SA', lat: 21.4225, lng: 39.8262 },
  { rank: 21, name: 'Guangzhou', country: 'CN', lat: 23.1291, lng: 113.2644 },
  { rank: 22, name: 'Prague', country: 'CZ', lat: 50.0875, lng: 14.4214 },
  { rank: 23, name: 'Medina', country: 'SA', lat: 24.4672, lng: 39.6112 },
  { rank: 24, name: 'Seoul', country: 'KR', lat: 37.5665, lng: 126.9780 },
  { rank: 25, name: 'Amsterdam', country: 'NL', lat: 52.3728, lng: 4.8936 },
  { rank: 26, name: 'Agra', country: 'IN', lat: 27.1767, lng: 78.0081, site: 'Taj Mahal' },
  { rank: 27, name: 'Miami', country: 'US', lat: 25.7743, lng: -80.1937 },
  { rank: 28, name: 'Osaka', country: 'JP', lat: 34.6937, lng: 135.5023 },
  { rank: 29, name: 'Los Angeles', country: 'US', lat: 34.0537, lng: -118.2428 },
  { rank: 30, name: 'Shanghai', country: 'CN', lat: 31.2304, lng: 121.4737 },
  { rank: 31, name: 'Ho Chi Minh City', country: 'VN', lat: 10.7769, lng: 106.7009 },
  // Euromonitor names the city; Bali is what people mean by it.
  { rank: 32, name: 'Denpasar', country: 'ID', lat: -8.6500, lng: 115.2167 },
  { rank: 33, name: 'Barcelona', country: 'ES', lat: 41.3874, lng: 2.1686 },
  { rank: 34, name: 'Las Vegas', country: 'US', lat: 36.1699, lng: -115.1398 },
  { rank: 35, name: 'Milan', country: 'IT', lat: 45.4642, lng: 9.1900 },
  { rank: 36, name: 'Chennai', country: 'IN', lat: 13.0827, lng: 80.2707 },
  { rank: 37, name: 'Vienna', country: 'AT', lat: 48.2082, lng: 16.3738 },
  { rank: 38, name: 'Johor Bahru', country: 'MY', lat: 1.4927, lng: 103.7414 },
  { rank: 39, name: 'Jaipur', country: 'IN', lat: 26.9124, lng: 75.7873 },
  { rank: 40, name: 'Cancún', country: 'MX', lat: 21.1619, lng: -86.8515 },
  { rank: 41, name: 'Berlin', country: 'DE', lat: 52.5200, lng: 13.4050 },
  { rank: 42, name: 'Cairo', country: 'EG', lat: 30.0444, lng: 31.2357 },
  { rank: 43, name: 'Athens', country: 'GR', lat: 37.9838, lng: 23.7275 },
  { rank: 44, name: 'Orlando', country: 'US', lat: 28.5384, lng: -81.3789 },
  { rank: 45, name: 'Moscow', country: 'RU', lat: 55.7558, lng: 37.6173 },
  { rank: 46, name: 'Venice', country: 'IT', lat: 45.4408, lng: 12.3155 },
  { rank: 47, name: 'Madrid', country: 'ES', lat: 40.4168, lng: -3.7038 },
  { rank: 48, name: 'Ha Long', country: 'VN', lat: 20.9517, lng: 107.0800 },
  { rank: 49, name: 'Riyadh', country: 'SA', lat: 24.7136, lng: 46.6753 },
  { rank: 50, name: 'Dublin', country: 'IE', lat: 53.3498, lng: -6.2603 },
];

/**
 * The towns the wonders are visited from. Rome (the Colosseum) and Agra (the
 * Taj Mahal) are already in the top fifty and carry their site there.
 */
const WONDER_BASES: WorldDestination[] = [
  // Chichén Itzá sits in the municipality of Tinum. Pisté is the village at
  // its gate; Valladolid, twenty-five miles east, is where most people sleep.
  { name: 'Valladolid', country: 'MX', lat: 20.6896, lng: -88.2022, site: 'Chichén Itzá' },
  { name: 'Pisté', country: 'MX', lat: 20.6978, lng: -88.5906, site: 'Chichén Itzá' },
  { name: 'Rio de Janeiro', country: 'BR', lat: -22.9068, lng: -43.1729, site: 'Christ the Redeemer' },
  { name: 'Beijing', country: 'CN', lat: 39.9042, lng: 116.4074, site: 'Great Wall of China' },
  // Huairou's district holds Mutianyu, the restored stretch most visitors walk.
  { name: 'Huairou', country: 'CN', lat: 40.3160, lng: 116.6320, site: 'Great Wall of China (Mutianyu)' },
  { name: 'Aguas Calientes', country: 'PE', lat: -13.1547, lng: -72.5254, site: 'Machu Picchu' },
  { name: 'Cusco', country: 'PE', lat: -13.5320, lng: -71.9675, site: 'Machu Picchu' },
  { name: 'Wadi Musa', country: 'JO', lat: 30.3222, lng: 35.4792, site: 'Petra' },
  // Giza is the city; the pyramids are on the plateau at its edge.
  { name: 'Giza', country: 'EG', lat: 30.0131, lng: 31.2089, site: 'Great Pyramid of Giza' },
];

export const WORLD_DESTINATIONS: readonly WorldDestination[] = Object.freeze([...TOP_CITIES, ...WONDER_BASES]);

const fold = (s: string) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The world destination a plan's city names, if it is one: "Cusco, Peru"
 * with country PE is Cusco. The town is the part before the first comma,
 * compared with case and accents folded. A country given as a two-letter
 * code has to agree — Valladolid, ES is not Valladolid, MX — and a name
 * with no country is only taken when the list holds one town by that name.
 */
export function worldDestination(city: string | null | undefined, countryCode?: string | null): WorldDestination | null {
  const town = fold(String(city || '').split(',')[0]);
  if (!town) return null;
  const cc = String(countryCode || '').trim().toUpperCase();
  const matches = WORLD_DESTINATIONS.filter(d => fold(d.name) === town);
  if (/^[A-Z]{2}$/.test(cc)) return matches.find(d => d.country === cc) ?? null;
  return matches.length === 1 ? matches[0] : null;
}

/** The sites themselves, for checking each base town is close enough to its wonder. */
export const WONDER_SITES: Readonly<Record<string, { lat: number; lng: number }>> = Object.freeze({
  'Chichén Itzá': { lat: 20.6843, lng: -88.5678 },
  'Christ the Redeemer': { lat: -22.9519, lng: -43.2105 },
  'Colosseum': { lat: 41.8902, lng: 12.4922 },
  'Great Wall of China': { lat: 40.4319, lng: 116.5704 },
  'Great Wall of China (Mutianyu)': { lat: 40.4319, lng: 116.5704 },
  'Machu Picchu': { lat: -13.1631, lng: -72.5450 },
  'Petra': { lat: 30.3285, lng: 35.4444 },
  'Taj Mahal': { lat: 27.1751, lng: 78.0421 },
  'Great Pyramid of Giza': { lat: 29.9792, lng: 31.1342 },
});
