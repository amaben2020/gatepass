import Stripe from 'stripe';

// Test mode key (sk_test_...). Requests made with it never move real money.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_not_configured');
export const stripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);
