// ─── A number somebody can actually ring ─────────────────────────────────
// The booking screen puts a "Call to reserve" button on any phone we hold.
// Bella Monica's was stored as "3121103" — seven digits, no area code — so the
// button would have dialled nobody. A number is kept only when it is
// dialable as written: E.164 (+ and 8–15 digits), or a North American number
// with its area code, stored as +1XXXXXXXXXX. Anything else is null, which
// the screen already handles by not offering a call.
export function dialable(raw: unknown, country?: string | null): string | null {
  const s = String(raw ?? '').split(/[;,]/)[0].trim();   // OSM allows "a;b"
  if (!s) return null;
  const digits = s.replace(/[^\d]/g, '');
  if (s.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  const nanp = !country || ['US', 'CA', 'PR'].includes(country.toUpperCase());
  if (nanp) {
    const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    // Area and exchange codes never start with 0 or 1.
    return /^[2-9]\d{2}[2-9]\d{6}$/.test(ten) ? `+1${ten}` : null;
  }
  return null;
}

// ─── Which country a number is in ─────────────────────────────────────────
// ITU-T E.164 country calling codes, for the countries whose files meet at a
// border. Used for one thing only: a venue in the strip where two
// countries' Geofabrik files overlap, whose number is written in full
// (+49…, 0049…), says which side it is on — geofabrik.ts countriesAt. A
// number written without its country code says nothing, and neither does a
// code two of the candidate countries share (+1 is the US and Canada, +7
// Russia and Kazakhstan, +972 is used on both sides of the Green Line):
// the longest matching code must belong to one side only, or the number is
// no evidence at all.
//
// North America's +1 is split by area code where the island has its own.
const CALLING_CODES: Readonly<Record<string, readonly string[]>> = {
  AD: ['376'], AE: ['971'], AF: ['93'], AL: ['355'], AM: ['374'], AO: ['244'], AR: ['54'], AT: ['43'], AU: ['61'],
  AW: ['297'], AX: ['35818'], AZ: ['994'], BA: ['387'], BD: ['880'], BE: ['32'], BF: ['226'], BG: ['359'], BH: ['973'],
  BI: ['257'], BJ: ['229'], BN: ['673'], BO: ['591'], BR: ['55'], BT: ['975'], BW: ['267'], BY: ['375'], BZ: ['501'],
  CA: ['1'], CD: ['243'], CF: ['236'], CG: ['242'], CH: ['41'], CI: ['225'], CL: ['56'], CM: ['237'], CN: ['86'],
  CO: ['57'], CR: ['506'], CU: ['53'], CV: ['238'], CW: ['5999'], CY: ['357'], CZ: ['420'], DE: ['49'], DJ: ['253'],
  DK: ['45'], DZ: ['213'], EC: ['593'], EE: ['372'], EG: ['20'], EH: ['212'], ER: ['291'], ES: ['34'], ET: ['251'],
  FI: ['358'], FJ: ['679'], FO: ['298'], FR: ['33'], GA: ['241'], GB: ['44'], GE: ['995'], GF: ['594'], GH: ['233'],
  GI: ['350'], GL: ['299'], GM: ['220'], GN: ['224'], GP: ['590'], GQ: ['240'], GR: ['30'], GT: ['502'], GW: ['245'],
  GY: ['592'], HK: ['852'], HN: ['504'], HR: ['385'], HT: ['509'], HU: ['36'], ID: ['62'], IE: ['353'], IL: ['972'],
  IN: ['91'], IQ: ['964'], IR: ['98'], IS: ['354'], IT: ['39'], JO: ['962'], JP: ['81'], KE: ['254'], KG: ['996'],
  KH: ['855'], KP: ['850'], KR: ['82'], KW: ['965'], KZ: ['76', '77'], LA: ['856'], LB: ['961'], LI: ['423'],
  LK: ['94'], LR: ['231'], LS: ['266'], LT: ['370'], LU: ['352'], LV: ['371'], LY: ['218'], MA: ['212'], MC: ['377'],
  MD: ['373'], ME: ['382'], MK: ['389'], ML: ['223'], MM: ['95'], MN: ['976'], MO: ['853'], MQ: ['596'], MR: ['222'],
  MT: ['356'], MW: ['265'], MX: ['52'], MY: ['60'], MZ: ['258'], NA: ['264'], NE: ['227'], NG: ['234'], NI: ['505'],
  NL: ['31'], NO: ['47'], NP: ['977'], NZ: ['64'], OM: ['968'], PA: ['507'], PE: ['51'], PG: ['675'], PH: ['63'],
  PK: ['92'], PL: ['48'], PS: ['970'], PT: ['351'], PY: ['595'], QA: ['974'], RO: ['40'], RS: ['381'], RU: ['7'],
  RW: ['250'], SA: ['966'], SD: ['249'], SE: ['46'], SG: ['65'], SI: ['386'], SK: ['421'], SL: ['232'], SM: ['378'],
  SN: ['221'], SO: ['252'], SR: ['597'], SS: ['211'], SV: ['503'], SX: ['1721'], SY: ['963'], SZ: ['268'], TD: ['235'],
  TG: ['228'], TH: ['66'], TJ: ['992'], TL: ['670'], TM: ['993'], TN: ['216'], TR: ['90'], TW: ['886'], TZ: ['255'],
  UA: ['380'], UG: ['256'], US: ['1'], UY: ['598'], UZ: ['998'], VE: ['58'], VN: ['84'], XK: ['383'], YE: ['967'],
  ZA: ['27'], ZM: ['260'], ZW: ['263'],
  // +1 with an area code of its own.
  AG: ['1268'], AI: ['1264'], AS: ['1684'], BB: ['1246'], BM: ['1441'], BS: ['1242'], DM: ['1767'],
  DO: ['1809', '1829', '1849'], GD: ['1473'], GU: ['1671'], JM: ['1876', '1658'], KN: ['1869'], KY: ['1345'],
  LC: ['1758'], MP: ['1670'], MS: ['1664'], PR: ['1787', '1939'], TC: ['1649'], TT: ['1868'], VC: ['1784'],
  VG: ['1284'], VI: ['1340'],
};

/**
 * Of `among`, the countries a number written in full is dialled into:
 * those holding the longest calling code the number starts with. Empty when
 * the number is not written in international form or matches none of them.
 */
export function callingCountries(raw: unknown, among: Iterable<string>): string[] {
  const s = String(raw ?? '').split(/[;,]/)[0].trim();
  const intl = s.startsWith('+') ? s.slice(1) : s.startsWith('00') ? s.slice(2) : null;
  if (intl === null) return [];
  const digits = intl.replace(/[^\d]/g, '');
  if (digits.length < 8) return [];
  let best = 0;
  let out: string[] = [];
  for (const c of among) {
    const len = Math.max(0, ...(CALLING_CODES[c] ?? []).filter(code => digits.startsWith(code)).map(code => code.length));
    if (!len) continue;
    if (len > best) { best = len; out = [c]; } else if (len === best) out.push(c);
  }
  return out;
}
