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
