// ─── Phone notifications ─────────────────────────────────────────────────
// Web Push, signed with this deployment's VAPID keys. Works from the browser
// on Android and desktop; on iPhone only once Reach has been added to the
// Home Screen (iOS 16.4+), which is Apple's rule, not ours. With no keys set
// there is no sender, and the bell and the email fallback carry on.
import webpush from 'web-push';
import type { Sender } from './notify-user';

export function pushConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function publicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

let ready = false;
export function pushSender(): Sender | null {
  if (!pushConfigured()) return null;
  if (!ready) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:hello@alcanzar.io',
      process.env.VAPID_PUBLIC_KEY as string,
      process.env.VAPID_PRIVATE_KEY as string,
    );
    ready = true;
  }
  return async (sub, payload) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 60 * 60 * 24 },
      );
      return { ok: true };
    } catch (e: unknown) {
      const status = (e as { statusCode?: number }).statusCode;
      return { ok: false, gone: status === 404 || status === 410, detail: String(status ?? (e as Error).message) };
    }
  };
}
