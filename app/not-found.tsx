import type { Metadata } from 'next';
import Link from 'next/link';
import { SHELL, SURFACE } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Not found — Reach',
  robots: { index: false, follow: false },
};

// ─── The one screen nobody designed ─────────────────────────────────────
// Every mistyped URL, every stale bookmark, every invitation link that has
// been replaced landed on Next's built-in 404: black Helvetica on white,
// the words "This page could not be found", and no way out. Not the app's
// colours, not the app's voice, and — the part that matters — no link
// anywhere. A dead end is the one thing a navigation graph may not contain.
//
// Rendered outside the app shell, like the legal pages, so it carries its
// own small set of tokens following the same data-theme attribute the shell
// stamps before paint. An explicit background on the body, because a page
// that inherits transparent is a page that flashes white in dark mode.
const css = `
:root{--nf-bg:${SURFACE.light};--nf-ink:#241C10;--nf-mut:#63553A;--nf-line:#E5DCCA;--nf-acc:#8A6512;--nf-card:${SHELL.light};}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--nf-bg:${SURFACE.dark};--nf-ink:#F3EBD9;--nf-mut:#AC9C7E;--nf-line:#332B1B;--nf-acc:#DDB259;--nf-card:${SHELL.dark};}}
:root[data-theme="dark"]{--nf-bg:${SURFACE.dark};--nf-ink:#F3EBD9;--nf-mut:#AC9C7E;--nf-line:#332B1B;--nf-acc:#DDB259;--nf-card:${SHELL.dark};}
.nf-body{background:var(--nf-bg);color:var(--nf-ink);min-height:100dvh;margin:0;
  display:flex;align-items:center;justify-content:center;
  font-family:var(--font-body);line-height:1.6;padding:24px 16px;}
.nf-card{max-width:420px;width:100%;text-align:center;}
.nf-card h1{font-family:var(--font-display);font-weight:400;font-size:clamp(28px,7vw,38px);
  line-height:1.15;margin:0 0 12px;}
.nf-card p{color:var(--nf-mut);font-size:15.5px;margin:0 0 24px;}
.nf-go{display:inline-block;background:var(--nf-acc);color:${SURFACE.light};
  text-decoration:none;font-weight:600;font-size:15px;
  padding:13px 26px;border-radius:999px;}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .nf-go{color:${SHELL.dark};}}
:root[data-theme="dark"] .nf-go{color:${SHELL.dark};}
.nf-go:focus-visible{outline:2px solid var(--nf-acc);outline-offset:3px;}
.nf-alt{display:flex;gap:18px;justify-content:center;font-size:14px;
  border-top:1px solid var(--nf-line);margin-top:32px;padding-top:20px;flex-wrap:wrap;}
.nf-alt a{color:var(--nf-acc);text-decoration:none;font-weight:500;}
.nf-alt a:hover{text-decoration:underline;}
.nf-alt a:focus-visible{outline:2px solid var(--nf-acc);outline-offset:3px;border-radius:3px;}
`;

export default function NotFound() {
  return (
    <div className="nf-body">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="nf-card">
        <h1>That page isn&rsquo;t here</h1>
        {/* Human words and a next step, which is the bar every other error
            state in this app is held to. It does not guess why they arrived
            — a wrong address and an expired invitation look identical from
            here, and telling somebody the wrong reason is worse than not
            saying. */}
        <p>
          The link may be out of date, or the address may have a typo in it.
          Your trips are all still where you left them.
        </p>
        <Link href="/" className="nf-go">Take me back</Link>
        <nav className="nf-alt">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </div>
    </div>
  );
}
