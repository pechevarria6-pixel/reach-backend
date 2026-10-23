// ─── Asking this device for notifications (browser side) ─────────────────
// Only ever called from a tap: browsers refuse a permission prompt that did
// not come from one, and iPhones refuse web push entirely unless Reach has
// been added to the Home Screen. Every answer comes back as a word the
// screen can say, never a silent nothing.
export type PushState = 'on' | 'off' | 'denied' | 'unsupported' | 'install_first' | 'not_configured';

function base64ToBytes(b64: string): ArrayBuffer {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

export function isIphoneBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

export async function pushState(): Promise<PushState> {
  if (typeof window === 'undefined') return 'unsupported';
  if (isIphoneBrowser()) return 'install_first';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub ? 'on' : 'off';
}

/**
 * Puts /sw.js in place without asking for anything. The worker keeps the
 * trip wallet for when there is no signal (and nothing else), which only
 * works once it is registered — and until now it was registered only by
 * turning notifications on. No permission prompt: registering a worker
 * needs none. Safe to call on every load; the browser keeps one.
 */
export async function registerServiceWorker(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  try {
    await navigator.serviceWorker.register('/sw.js');
    return true;
  } catch {
    return false;
  }
}

/**
 * Forgets the offline wallet, for sign-out: on a shared device the next
 * person must not find somebody else's confirmation numbers in it.
 */
export async function clearOfflineWallet(): Promise<void> {
  if (typeof window === 'undefined') return;
  try { await caches.delete('reach-wallet-v1'); } catch { /* no Cache API: nothing was kept */ }
  const reg = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    ? await navigator.serviceWorker.getRegistration('/sw.js').catch(() => undefined)
    : undefined;
  reg?.active?.postMessage({ type: 'clear-wallet' });
}

export async function turnOnPush(): Promise<PushState> {
  const now = await pushState();
  if (now !== 'off') return now;
  const cfg = await fetch('/api/push').then(r => r.ok ? r.json() : null).catch(() => null);
  if (!cfg?.configured || !cfg.publicKey) return 'not_configured';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(cfg.publicKey) });
  const r = await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
  if (!r.ok) { await sub.unsubscribe().catch(() => {}); return 'off'; }
  return 'on';
}
