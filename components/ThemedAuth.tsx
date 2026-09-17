'use client';
import { SignIn, SignUp, ClerkLoaded, ClerkLoading } from '@clerk/nextjs';
import { useEffect, useState } from 'react';
import { clerkAppearance } from '@/lib/clerk-appearance';

// Everything on these two screens used to come from Clerk's script and
// nothing else: the server sent `<main>` with a background colour and no
// content. So a blocked, filtered or simply slow clerk.alcanzar.io left a
// solid blank screen — no wordmark, no message, no way to tell whether the
// page was loading, broken, or the whole product. It stayed that way for ever
// because nothing was watching.
//
// The page now carries its own content. A wordmark and a line of text render
// server-side, Clerk's widget replaces them once it loads, and if it has not
// loaded in ten seconds the screen says so and offers a reload — because a
// script blocker is the likeliest cause and the person can act on that.

// The shell stamps a stored theme onto <html> before first paint, and leaves
// the attribute off for the light default. Clerk draws its widget only in the
// browser, after this has run, so the widget never appears in the wrong
// palette first.
function useShellTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  }, []);
  return theme;
}

const PATIENCE_MS = 10_000;

const FALLBACK_CSS = `
  .auth-fb{color:#241C10}
  .auth-fb .auth-fb-dim{color:#63553C}
  :root[data-theme="dark"] .auth-fb{color:#F5EDD8}
  :root[data-theme="dark"] .auth-fb .auth-fb-dim{color:#9A8A6A}
  @keyframes auth-fb-spin{to{transform:rotate(360deg)}}
`;

function Waiting({ what }: { what: string }) {
  // Rendered on the server too, so it is on screen before any script runs.
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setStuck(true), PATIENCE_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{ textAlign: 'center', padding: 24, maxWidth: 360 }}>
      {/* Both themes in one stylesheet: the fallback cannot reach the app's
          tokens, and it has to be readable before React hydrates.

          dangerouslySetInnerHTML, not a child string: the server escapes the
          quotes in [data-theme="dark"] to &quot; inside the style text while
          the browser writes them raw, and that mismatch failed hydration.
          React then replaced the document — throwing away the data-theme
          attribute the pre-paint script had set, which is the very thing
          these screens were being fixed for. */}
      <style dangerouslySetInnerHTML={{ __html: FALLBACK_CSS }} />
      <div className="auth-fb">
        <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 30, marginBottom: 14 }}>reach</div>
        {stuck ? (
          <>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
              We couldn&apos;t load the {what} form
            </div>
            <div className="auth-fb-dim" style={{ fontSize: 13.5, lineHeight: 1.6, marginBottom: 18 }}>
              Something is blocking it — usually an ad or script blocker, a VPN, or a
              network that filters requests to clerk.alcanzar.io. Allow that address
              and reload, or try another browser or connection.
            </div>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: 'linear-gradient(135deg, #C49A38, #D4A843)', color: '#2A1D06',
                border: 'none', borderRadius: 16, padding: '13px 26px',
                fontSize: 14.5, fontWeight: 600, cursor: 'pointer', minHeight: 48,
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
              }}
            >
              Reload
            </button>
          </>
        ) : (
          <div className="auth-fb-wait">
            <div
              aria-hidden
              style={{
                width: 28, height: 28, margin: '0 auto 14px',
                border: '3px solid #D4A843', borderTopColor: 'transparent', borderRadius: '50%',
                animation: 'auth-fb-spin .8s linear infinite',
              }}
            />
            <div className="auth-fb-dim" style={{ fontSize: 13.5 }}>Loading the {what} form…</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Frame({ what, children }: { what: string; children: React.ReactNode }) {
  // The first client render has to match the server's exactly. ClerkLoading /
  // ClerkLoaded do not: the server always renders the waiting state, while a
  // browser with Clerk already cached renders the widget on its first pass.
  // That mismatch made React re-render the root <html> — which threw away the
  // data-theme attribute the pre-paint script had just set, so a dark-theme
  // visitor got a light sign-in page and the console filled with hydration
  // errors. Rendering the waiting state until after mount keeps the two
  // passes identical, and the swap then happens as an ordinary update.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <>
        <Waiting what={what} />
        <NoScriptNote />
      </>
    );
  }

  return (
    <>
      <ClerkLoading>
        <Waiting what={what} />
      </ClerkLoading>
      <ClerkLoaded>{children}</ClerkLoaded>
      <NoScriptNote />
    </>
  );
}

function NoScriptNote() {
  return (
    <noscript>
      {/* With no script the spinner would spin for ever beside a message
          saying it never will. */}
      <style dangerouslySetInnerHTML={{ __html: '.auth-fb-wait{display:none}' }} />
      <div style={{ textAlign: 'center', padding: 24, color: '#9A8A6A', fontSize: 13.5, lineHeight: 1.6 }}>
        Signing in to Reach needs JavaScript. Please turn it on for this site and reload.
      </div>
    </noscript>
  );
}

export function ThemedSignIn() {
  const theme = useShellTheme();
  return (
    <Frame what="sign-in">
      <SignIn appearance={clerkAppearance[theme]} />
    </Frame>
  );
}

export function ThemedSignUp() {
  const theme = useShellTheme();
  return (
    <Frame what="sign-up">
      <SignUp appearance={clerkAppearance[theme]} />
    </Frame>
  );
}
