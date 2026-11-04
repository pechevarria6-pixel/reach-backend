// ─── What every table platform's answer is read with ─────────────────────
import type { TableErrorCode, TableRefusal } from './types.ts';

/** The body as JSON, or null when there is none or it is not JSON. */
export async function bodyOf(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** A read (not a booking) that never got an answer: nothing was asked for, so nothing was booked. */
export async function readFetch(url: string, init: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, init);
  } catch (e) {
    console.error('[tables] no answer', { url: url.replace(/\?.*$/, ''), error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export const refuse = (code: TableErrorCode, error: string, handoffUrl?: string | null): TableRefusal =>
  ({ ok: false, code, error, ...(handoffUrl ? { handoffUrl } : {}) });

/** The refusals any platform can give for its own reasons rather than ours. */
export function generic(status: number, platform: string): TableRefusal | null {
  if (status === 401 || status === 403) {
    return refuse('auth', `${platform} turned down Reach's credentials, so nothing was booked. Book it on ${platform} directly for now.`);
  }
  if (status === 429) return refuse('rate_limited', `${platform} asked Reach to slow down. Nothing was booked — try again in a minute.`);
  if (status >= 500) return refuse('platform_down', `${platform} isn't answering properly right now. Nothing was booked — try again shortly, or book it on ${platform} directly.`);
  return null;
}

export const plainText = (s: unknown): string | null => {
  const t = String(s ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t || null;
};
