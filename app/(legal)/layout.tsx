import type { Metadata } from 'next';
import Link from 'next/link';
import { SHELL, SURFACE } from '@/lib/brand';

export const metadata: Metadata = { robots: { index: true, follow: true } };

// These pages render outside the app component, so they cannot reach its
// tokens. They carry a small themed set of their own, following the same
// data-theme attribute the shell stamps before paint.
const css = `
:root{--lg-bg:${SURFACE.light};--lg-page:${SHELL.light};--lg-ink:#241C10;--lg-mut:#63553A;--lg-line:#E5DCCA;--lg-acc:#8A6512;}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--lg-bg:${SURFACE.dark};--lg-page:${SHELL.dark};--lg-ink:#F3EBD9;--lg-mut:#AC9C7E;--lg-line:#332B1B;--lg-acc:#DDB259;}}
:root[data-theme="dark"]{--lg-bg:${SURFACE.dark};--lg-page:${SHELL.dark};--lg-ink:#F3EBD9;--lg-mut:#AC9C7E;--lg-line:#332B1B;--lg-acc:#DDB259;}
.lg-body{background:var(--lg-bg);color:var(--lg-ink);min-height:100dvh;margin:0;
  font-family:var(--font-body);line-height:1.65;}
.lg-wrap{max-width:720px;margin:0 auto;padding-block:48px 80px;padding-left:20px;padding-right:20px;}
.lg-wrap h1{font-family:var(--font-display);font-weight:400;font-size:clamp(32px,6vw,46px);line-height:1.1;margin:0 0 8px;}
.lg-wrap h2{font-family:var(--font-display);font-weight:400;font-size:24px;margin:36px 0 10px;line-height:1.2;}
.lg-wrap p,.lg-wrap li{color:var(--lg-mut);font-size:15.5px;margin:0 0 12px;max-width:66ch;}
.lg-wrap ul{padding-left:20px;margin:0 0 12px;}
.lg-wrap strong{color:var(--lg-ink);font-weight:600;}
.lg-meta{font-size:13px;color:var(--lg-mut);border-bottom:1px solid var(--lg-line);padding-bottom:20px;margin-bottom:8px;}
.lg-nav{display:flex;gap:18px;font-size:14px;border-top:1px solid var(--lg-line);margin-top:44px;padding-top:20px;flex-wrap:wrap;}
.lg-nav a{color:var(--lg-acc);text-decoration:none;font-weight:500;}
.lg-nav a:hover{text-decoration:underline;}
.lg-nav a:focus-visible{outline:2px solid var(--lg-acc);outline-offset:3px;border-radius:3px;}
.lg-note{background:color-mix(in srgb,var(--lg-acc) 10%,transparent);border:1px solid var(--lg-line);
  border-radius:12px;padding:14px 16px;font-size:14px;margin:24px 0;}
`;

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lg-body">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="lg-wrap">
        {children}
        <nav className="lg-nav">
          <Link href="/">Back to Reach</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <a href="mailto:hello@alcanzar.io">hello@alcanzar.io</a>
        </nav>
      </div>
    </div>
  );
}
