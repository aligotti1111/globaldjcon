// Server-only Stripe client.
//
// SERVER-ONLY. Never import this into a Client Component — it reads the secret
// key. The key lives in the STRIPE_SECRET_KEY environment variable (set in
// Netlify), never in the codebase.
//
// Lazily instantiated so a missing key only throws when Stripe is actually
// used (a request hits checkout/webhook), not at module load / build time.

import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not set');
  }
  // No apiVersion pinned — uses the account's default API version, which
  // matches how the Stripe dashboard behaves.
  _stripe = new Stripe(key);
  return _stripe;
}
