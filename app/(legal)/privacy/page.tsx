import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy — Reach',
  description: 'What Reach collects, why, who it is shared with, and how to get it back or delete it.',
};

// Every statement here is checked against the code: the tables in sql/, the
// routes under app/api, and lib/encryption.ts. Keep it that way — a privacy
// policy that drifts from the implementation is worse than none.
export default function PrivacyPage() {
  return (
    <main>
      <h1>Privacy</h1>
      <p className="lg-meta">Last updated 12 September 2026 · Reach (alcanzar.io)</p>

      <p>
        Reach helps a group plan and pay for a trip together. This page describes exactly what
        the app stores, who else sees it, and how to get it back or delete it.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Your account.</strong> Name, email address and profile picture, from however you signed in — email, Apple or Google. Sign-in is handled by Clerk; Reach never sees your password.</li>
        <li><strong>What you plan.</strong> Groups you belong to, plans, dates, budgets, votes, itineraries and invitations you send.</li>
        <li><strong>Travel documents, if you add them.</strong> Passport number, TSA PreCheck (KTN) and Global Entry number, along with loyalty programme membership numbers. These are optional and the app works without them.</li>
        <li><strong>Payments.</strong> Amounts, status and dates. Card numbers are handled entirely by Stripe and never reach Reach&rsquo;s servers or database.</li>
        <li><strong>Approximate location, only if you allow it.</strong> Used to show nearby events and prefill a departure city. It is requested by your browser and you can refuse; the app degrades to generic suggestions.</li>
      </ul>

      <h2>How travel documents are stored</h2>
      <p>
        Document and membership numbers are encrypted with AES-256-GCM before they are written to
        the database, under a key held only on the server. When the app shows them back to you it
        sends the last four characters and nothing more. They are never shown to other members of
        your groups.
      </p>

      <h2>Who else receives your data</h2>
      <p>These are the only third parties involved, and each receives only what its job requires:</p>
      <ul>
        <li><strong>Clerk</strong> — authentication and session management.</li>
        <li><strong>Supabase</strong> — the database the app runs on.</li>
        <li><strong>Stripe</strong> — payment processing. Stripe receives your email and the amounts; Reach receives back only the outcome.</li>
        <li><strong>Anthropic</strong> — trip suggestions. The prompt carries your destination, dates, budget and stated preferences. It does not carry your name, email, documents or payment details.</li>
        <li><strong>Vercel</strong> — hosting.</li>
        <li><strong>Booking and discovery partners</strong> — only when you choose to book or search through one, and only the details that reservation needs.</li>
      </ul>
      <p>Reach does not sell your data, and does not share it for advertising.</p>

      <h2>Choices you control</h2>
      <p>Under Profile, then Privacy, you can turn each of these on or off at any time:</p>
      <ul>
        <li>Personalised recommendations, which use your trips and votes.</li>
        <li>Usage analytics, which are anonymous counts of which screens get used.</li>
        <li>Product emails.</li>
        <li>Sharing with booking partners.</li>
      </ul>

      <h2>Getting your data, and deleting it</h2>
      <p>
        <strong>Export.</strong> Profile, then Privacy, then &ldquo;Download everything Reach holds&rdquo;
        returns a JSON file with your account, groups, payments, votes, loyalty programmes and
        activity log. Encrypted document numbers are excluded from the export for security.
      </p>
      <p>
        <strong>Deletion.</strong> The same screen schedules account deletion. Your Stripe customer
        record is removed immediately; everything else is deleted after 30 days, and you can
        contact us before then to stop it. Records of payments already taken are retained where
        tax and accounting law requires it.
      </p>

      <h2>How long things are kept</h2>
      <p>
        Account and planning data is kept while your account is open, and removed 30 days after you
        ask for deletion. Activity logs are kept for security and support. Payment records are kept
        as long as the law requires.
      </p>

      <h2>Children</h2>
      <p>
        Reach is not intended for anyone under 13, and accounts are not knowingly created for them.
        If you believe a child has an account, write to us and it will be removed.
      </p>

      <h2>Contact</h2>
      <p>
        Questions, or a request about your data: <a href="mailto:hello@alcanzar.io" style={{ color: 'var(--lg-acc)' }}>hello@alcanzar.io</a>.
      </p>

      <div className="lg-note">
        Reach is an independent product built by a solo founder. This page describes the software
        as it actually behaves rather than restating a template, and it has not been reviewed by a
        lawyer. If you need a formal assurance for your own compliance, ask and we will provide it
        in writing.
      </div>
    </main>
  );
}
