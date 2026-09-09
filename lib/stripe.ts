import Stripe from 'stripe';

// Server-side Stripe client — secret key never sent to browser
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-04-10',
  typescript: true,
});

// Test card numbers for development
export const TEST_CARDS = {
  success: '4242 4242 4242 4242',       // Always succeeds
  requires3DS: '4000 0025 0000 3155',   // Triggers MFA/3D Secure
  declined: '4000 0000 0000 9995',      // Always declined
  insufficientFunds: '4000 0000 0000 9995',
};

// Format amount from dollars to cents (Stripe uses cents)
export const toCents = (dollars: number) => Math.round(dollars * 100);

// Format cents back to dollars for display
export const toDollars = (cents: number) => (cents / 100).toFixed(2);
