// ─── Which platform, if any, Reach books this restaurant on ──────────────
import type { TableProvider } from './types.ts';

/**
 * The first provider that is switched on, holds an id for this restaurant
 * from the links given, and may book that id now. Null otherwise — and null
 * is the hand-off, never a provider tried "anyway".
 */
export function pickTable(
  providers: readonly TableProvider[],
  urls: readonly (string | null | undefined)[],
  env: NodeJS.ProcessEnv = process.env,
): { provider: TableProvider; venueId: string } | null {
  for (const p of providers) {
    if (!p.enabled(env)) continue;
    const venueId = p.venueIdFrom(urls);
    if (venueId && p.allows(venueId, env)) return { provider: p, venueId };
  }
  return null;
}
