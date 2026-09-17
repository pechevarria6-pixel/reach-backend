import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata, Viewport } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import { SHELL, SURFACE, THEME_KEY } from '@/lib/brand';
import '@/styles/theme.css';

// Fraunces for display — the reference screens' headings are a high-contrast
// serif and Fraunces is the closest of the free families, with Playfair
// Display as the fallback in theme.css. Inter for everything else. Loaded
// through next/font so the files are served from our own origin: the old
// stylesheet link cost a round trip to Google before the first paint.
const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-fraunces',
  // The display sizes only. Loading the whole variable range costs weight
  // nobody sees.
  weight: ['400', '600', '700'],
});
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Reach — Plan experiences together',
  description: 'Turn conversations into commitments and commitments into real-world experiences.',
  manifest: '/manifest.json',
  // Built from the logo by scripts/make_icons.py. Declared here so the head
  // carries them: an installed app with no apple-touch-icon gets a screenshot
  // of the page as its home-screen tile.
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '16x16 32x32 48x48' },
      { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // maximumScale was 1, which blocks pinch-zoom entirely. People who need
  // to magnify text could not.
  maximumScale: 5,
  viewportFit: 'cover',
  // The browser chrome follows the system preference. The in-app toggle can
  // disagree with it, which is acceptable: this only tints the address bar.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: SURFACE.light },
    { media: '(prefers-color-scheme: dark)', color: SURFACE.dark },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
        <head>

          <meta name="mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
          <meta name="apple-mobile-web-app-title" content="Reach" />
          {/* The shell paints before React mounts, so the surround needs its
              own copy of the two page colours. Without this the app opens on
              the light default and then snaps to dark a frame later for
              anyone who chose dark. */}
          <style dangerouslySetInnerHTML={{ __html:
            `:root{--shell-page:${SHELL.light};}` +
            `:root[data-theme="dark"]{--shell-page:${SHELL.dark};}` }} />
          {/* Runs before first paint: reads the stored choice and stamps it on
              <html> so the correct palette is already in place. Wrapped in
              try/catch because storage throws in private windows. */}
          <script dangerouslySetInnerHTML={{ __html:
            `(function(){try{var t=localStorage.getItem('${THEME_KEY}');` +
            `if(t==='dark'||t==='light')document.documentElement` +
            `.setAttribute('data-theme',t);}catch(e){}})();` }} />
        </head>
        <body style={{ margin: 0, background: 'var(--shell-page)' }}>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
