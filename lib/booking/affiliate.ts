// ─── Expedia Group affiliate tag on Vrbo / Expedia links (directive L1) ──
// Reach earns on a stay booked through a Vrbo or Expedia link only when the
// link carries the affiliate ID (REACH-BUSINESS-MODEL-2026-11-08.md §4B L1).
// The member pays the same either way.
//
// TODO(owner, L1): join the Expedia Group Affiliate Program
// (partner.expediagroup.com), then set in Vercel:
//   EXPEDIA_AFFILIATE_ID     — the ID the programme issues
//   EXPEDIA_AFFILIATE_PARAM  — the query parameter its link docs name for it
// The parameter is configuration, not a guess written here: the programme's
// link format is confirmed from its own documentation when the ID is issued.
// Until BOTH are set, links go out exactly as they are today — never with an
// invented tag.

const EXPEDIA_GROUP_HOST = /(^|\.)(vrbo\.com|expedia\.[a-z.]+|hotels\.com)$/i;

/** The configured tag, or null when the programme is not joined yet. */
export function expediaAffiliate(env: Record<string, string | undefined> = process.env): { param: string; id: string } | null {
  const id = String(env.EXPEDIA_AFFILIATE_ID ?? '').trim();
  const param = String(env.EXPEDIA_AFFILIATE_PARAM ?? '').trim();
  if (!id || !param || !/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(param)) return null;
  return { param, id };
}

/** The same link with the affiliate tag, for Expedia Group hosts only. */
export function withExpediaAffiliate(url: string, env: Record<string, string | undefined> = process.env): string {
  const tag = expediaAffiliate(env);
  if (!tag) return url;
  try {
    const u = new URL(url);
    if (!EXPEDIA_GROUP_HOST.test(u.hostname)) return url;
    u.searchParams.set(tag.param, tag.id);
    return u.toString();
  } catch {
    return url;
  }
}
