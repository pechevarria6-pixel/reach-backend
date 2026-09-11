import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata, Viewport } from 'next';
import { BRAND, THEME_COLOR } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Reach — Plan experiences together',
  description: 'Turn conversations into commitments and commitments into real-world experiences.',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // maximumScale was 1, which blocks pinch-zoom entirely. People who need
  // to magnify text could not.
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: THEME_COLOR,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet" />
          <meta name="mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
          <meta name="apple-mobile-web-app-title" content="Reach" />
        </head>
        <body style={{ margin: 0, background: BRAND.page }}>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
