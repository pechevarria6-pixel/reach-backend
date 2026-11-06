import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

// ─── The front door ──────────────────────────────────────────────────────
// alcanzar.io used to redirect anyone signed out straight to a Clerk box that
// said "Welcome back!" — to people who had never been here, with not one word
// about what Reach is (new-user walk, 2026-11-06). This page says what it
// does, in what it actually does today, and offers the two ways in.
//
// Every line below is something the app does now. No booking promise: the
// plan shows where to book, and Reach books only what it can (see CLAUDE.md,
// "Never claim a capability that isn't real").

const STEPS: Array<{ icon: string; title: string; body: string }> = [
  {
    icon: '👥',
    title: 'Start a group',
    body: 'Invite friends with a link. They can join from any phone, no app to download.',
  },
  {
    icon: '✍️',
    title: 'Everyone says what they like',
    body: 'A short quiz: what you enjoy, what you would rather skip, and what you want to spend.',
  },
  {
    icon: '🗺️',
    title: 'Reach finds the options',
    body: 'Trips and nights out built from real places we have checked, matched to the whole group.',
  },
  {
    icon: '🗳️',
    title: 'Vote, then go',
    body: 'Pick together. The plan, the day by day, the costs and where to book all live in one place.',
  },
];

const CSS = `
.lp{--pg:#DFE5E0;--bg:#EBEFEC;--s2:#E4EAE6;--bd:#D8DED4;--ac:#EC6032;--acd:#D24E24;--on:#2A1D06;--link:#2B583B;--t1:#142119;--t2:#576E61;--t3:#6B7F72;--mark:#B8912A;--glow:rgba(236,96,50,.14);
  min-height:100dvh;background:var(--pg);color:var(--t1);font-family:var(--font-body);-webkit-font-smoothing:antialiased}
:root[data-theme="dark"] .lp{--pg:#1F080F;--bg:#2C0E18;--s2:#3F1619;--bd:#5A2430;--ac:#C3A342;--acd:#A8892F;--on:#2A1D06;--link:#C3A342;--t1:#FEF7D9;--t2:#CFC182;--t3:#B89A6A;--mark:#C3A342;--glow:rgba(195,163,66,.16)}
.lp *{box-sizing:border-box}
.lp-in{max-width:960px;margin:0 auto;padding:0 16px}
.lp-top{display:flex;align-items:center;justify-content:space-between;padding:18px 0}
.lp-brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--t1)}
.lp-brand img{height:22px;width:auto}
.lp-brand span{font-family:var(--font-display);font-size:24px;font-weight:600;letter-spacing:-.01em}
.lp-signin{color:var(--link);font-weight:600;font-size:15px;text-decoration:none;padding:10px 4px}
.lp-hero{padding:40px 0 28px;text-align:center;position:relative}
.lp-hero:before{content:"";position:absolute;inset:-40px 0 auto;height:320px;background:radial-gradient(closest-side,var(--glow),transparent);pointer-events:none}
.lp-hands{width:min(300px,78%);height:auto;margin:0 auto 22px;display:block;position:relative}
.lp h1{font-family:var(--font-display);font-weight:600;font-size:clamp(34px,8.5vw,58px);line-height:1.05;letter-spacing:-.02em;margin:0 auto 16px;max-width:15ch;position:relative}
.lp-lede{font-size:clamp(16px,4.2vw,19px);line-height:1.55;color:var(--t2);max-width:34em;margin:0 auto 28px;position:relative}
.lp-ctas{display:flex;flex-direction:column;gap:12px;align-items:center;position:relative}
.lp-go{display:inline-flex;align-items:center;justify-content:center;min-height:52px;padding:0 28px;border-radius:999px;background:linear-gradient(135deg,var(--acd),var(--ac));color:var(--on);font-weight:700;font-size:16px;text-decoration:none;box-shadow:0 10px 30px var(--glow);width:100%;max-width:340px}
.lp-go:focus-visible,.lp-signin:focus-visible,.lp-ghost:focus-visible{outline:3px solid var(--link);outline-offset:3px}
.lp-ghost{color:var(--t2);font-size:14.5px;text-decoration:none}
.lp-ghost b{color:var(--link)}
.lp-kinds{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin:28px auto 0;position:relative}
.lp-kinds span{font-size:13.5px;color:var(--t2);background:var(--bg);border:1px solid var(--bd);border-radius:999px;padding:7px 14px}
.lp-how{padding:36px 0 8px}
.lp-eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:12px;font-weight:700;color:var(--t3);text-align:center;margin:0 0 18px}
.lp-steps{list-style:none;margin:0;padding:0;display:grid;gap:12px;grid-template-columns:1fr}
@media (min-width:720px){.lp-steps{grid-template-columns:1fr 1fr}}
.lp-step{background:var(--bg);border:1px solid var(--bd);border-radius:20px;padding:18px;display:flex;gap:14px;align-items:flex-start}
.lp-num{flex:0 0 auto;width:44px;height:44px;border-radius:14px;background:var(--s2);border:1px solid var(--bd);display:flex;align-items:center;justify-content:center;font-size:22px}
.lp-step h3{margin:2px 0 4px;font-size:16.5px;font-weight:700}
.lp-step p{margin:0;font-size:14.5px;line-height:1.5;color:var(--t2)}
.lp-solo{margin:20px 0 0;text-align:center;font-size:14.5px;color:var(--t2);line-height:1.5}
.lp-end{padding:36px 0 28px;text-align:center}
.lp-end h2{font-family:var(--font-display);font-weight:600;font-size:clamp(26px,6.5vw,38px);margin:0 0 18px;letter-spacing:-.01em}
.lp-foot{border-top:1px solid var(--bd);padding:20px 0 calc(20px + env(safe-area-inset-bottom));display:flex;flex-wrap:wrap;gap:8px 18px;justify-content:center;font-size:13px;color:var(--t3)}
.lp-foot a{color:var(--t2);text-decoration:none}
`;

export default function RootPage() {
  const { userId } = auth();
  if (userId) redirect('/home');

  return (
    <main className="lp">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="lp-in">
        <header className="lp-top">
          <Link href="/" className="lp-brand" aria-label="Reach">
            <span>Reach</span>
          </Link>
          <Link href="/sign-in" className="lp-signin">Sign in</Link>
        </header>

        <section className="lp-hero">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="" className="lp-hands" width={512} height={145} />
          <h1>Plans with your people, actually made.</h1>
          <p className="lp-lede">
            Reach plans trips and nights out for your group. Everyone says what they are into,
            Reach finds options that suit all of you, and the plan comes together in one place
            instead of a group chat.
          </p>
          <div className="lp-ctas">
            <Link href="/sign-up" className="lp-go">Get started</Link>
            <Link href="/sign-in" className="lp-ghost">Already have an account? <b>Sign in</b></Link>
          </div>
          <div className="lp-kinds" aria-label="What you can plan">
            <span>🍽️ A night out</span>
            <span>🏖️ A weekend away</span>
            <span>✈️ A proper trip</span>
          </div>
        </section>

        <section className="lp-how" aria-labelledby="lp-how-title">
          <p className="lp-eyebrow" id="lp-how-title">How it works</p>
          <ol className="lp-steps">
            {STEPS.map(s => (
              <li key={s.title} className="lp-step">
                <span className="lp-num" aria-hidden="true">{s.icon}</span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="lp-solo">Going on your own? Reach plans for one just as well.</p>
        </section>

        <section className="lp-end">
          <h2>Where to next?</h2>
          <div className="lp-ctas">
            <Link href="/sign-up" className="lp-go">Create your account</Link>
          </div>
        </section>

        <footer className="lp-foot">
          <span>© {new Date().getFullYear()} Alcanzar Group, Inc.</span>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </footer>
      </div>
    </main>
  );
}
