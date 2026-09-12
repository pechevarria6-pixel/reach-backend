import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms — Reach',
  description: 'What Reach does, what it does not do with your money, and what you agree to by using it.',
};

// The money section must stay true to the product principle Reach is built on:
// funds move through Stripe and Reach never custodies a balance. If the code
// ever changes that, this page changes in the same commit.
export default function TermsPage() {
  return (
    <main>
      <h1>Terms</h1>
      <p className="lg-meta">Last updated 12 September 2026 · Reach (alcanzar.io)</p>

      <p>
        Reach helps a group agree on a trip and pay their shares. By creating an account you agree
        to what follows. If you do not, please do not use the app.
      </p>

      <h2>What Reach is</h2>
      <p>
        Reach is planning and coordination software. It helps a group choose a trip, vote on
        options, split the cost, collect each person&rsquo;s share and, where a partner supports it,
        place a booking. Reach is not a travel agency, a tour operator or a bank.
      </p>

      <h2>Money</h2>
      <p>
        <strong>Reach never holds your money.</strong> Payments are processed by Stripe and move
        between you and the party being paid. Reach does not custody balances, does not act as an
        escrow, and cannot spend your funds. A group&rsquo;s &ldquo;wallet&rdquo; figure is a record
        of what members have contributed toward a plan, not an account Reach controls.
      </p>
      <p>
        Nothing is booked until a plan is funded and the organiser approves it. That order is
        deliberate and does not change.
      </p>
      <p>
        Your card details are entered directly into Stripe&rsquo;s payment form and are never seen or
        stored by Reach.
      </p>

      <h2>Bookings, prices and availability</h2>
      <p>
        Prices, availability and itineraries shown in Reach come from third-party providers or are
        estimates for planning. They can change between the moment you see them and the moment a
        booking is attempted. A booking is only confirmed when the provider confirms it.
      </p>
      <p>
        Where Reach shows an estimated breakdown of a trip&rsquo;s cost, it is an estimate for
        planning and not a quote.
      </p>

      <h2>Cancellations and refunds</h2>
      <p>
        Refunds follow the rules of whoever took the payment. Where a booking is made with an
        airline, hotel, restaurant or event provider, that provider&rsquo;s cancellation policy
        applies and Reach cannot override it. Where a contribution has been collected but nothing
        has been booked, it can be refunded through Stripe.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>Give accurate information, and keep your sign-in secure.</li>
        <li>Only invite people to a group who want to be there.</li>
        <li>Do not use Reach to break the law, or to attempt to access other people&rsquo;s data.</li>
        <li>Do not attempt to disrupt or overload the service.</li>
      </ul>
      <p>
        An organiser of a group can add and remove members and can delete the group, which deletes
        its plans for everyone. Be deliberate about who you make an organiser.
      </p>

      <h2>Ending it</h2>
      <p>
        You can delete your account at any time from Profile, then Privacy. We may suspend an
        account that is being used to harm other people or the service. Obligations already
        incurred, such as a booking already placed, survive the account closing.
      </p>

      <h2>What we do not promise</h2>
      <p>
        Reach is provided as it is. We do not promise that it will be uninterrupted, that every
        provider integration will be available, or that third-party information will be accurate.
        To the extent the law allows, Reach is not liable for indirect or consequential loss, and
        our total liability is limited to the fees you have paid to Reach.
      </p>

      <h2>Changes</h2>
      <p>
        These terms may change as the product does. Material changes will be announced in the app
        before they take effect, and the date at the top of this page will move.
      </p>

      <h2>Contact</h2>
      <p>
        <a href="mailto:hello@alcanzar.io" style={{ color: 'var(--lg-acc)' }}>hello@alcanzar.io</a>
      </p>

      <div className="lg-note">
        Reach is an independent product built by a solo founder. This page is written in plain
        language to describe how the service actually works, and it has not been reviewed by a
        lawyer. It is not a substitute for legal advice for your own situation.
      </div>
    </main>
  );
}
