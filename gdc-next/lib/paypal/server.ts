// Server-only PayPal REST client (Commerce Platform / multiparty).
//
// SERVER-ONLY. Never import into a Client Component — it reads the secret.
// Uses plain fetch against PayPal's REST API rather than an SDK, mirroring the
// lightweight pattern used elsewhere (no heavy dependency, works on the edge/
// node runtime the app already targets).
//
// Env vars (set in Netlify — sandbox first, then live):
//   PAYPAL_ENV            'sandbox' | 'live'   (defaults to 'sandbox')
//   PAYPAL_CLIENT_ID      REST app client id
//   PAYPAL_SECRET         REST app secret
//   PAYPAL_BN_CODE        partner attribution / BN code (Commerce Platform)
//   PAYPAL_WEBHOOK_ID     id of the webhook registered in the PayPal dashboard
//   PAYPAL_MERCHANT_ID    the PLATFORM's own PayPal merchant id (partner)
//
// Nothing here throws at import/build time — a missing key only surfaces when a
// request actually calls PayPal, so the site builds fine before Phase 0 is done.

const LIVE_BASE = 'https://api-m.paypal.com';
const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';

export function paypalBaseUrl(): string {
  return (process.env.PAYPAL_ENV || 'sandbox').toLowerCase() === 'live' ? LIVE_BASE : SANDBOX_BASE;
}

// Whether PayPal is configured enough to attempt a call. Callers use this to
// hide the feature / skip gracefully instead of throwing when creds are absent.
export function paypalConfigured(): boolean {
  return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET);
}

// The BN code identifies our platform on partner-attributed calls. Attach it as
// the PayPal-Partner-Attribution-Id header on order/onboarding requests.
export function paypalBnCode(): string | undefined {
  return process.env.PAYPAL_BN_CODE || undefined;
}

// ── Access token (client-credentials), cached in-memory across warm invokes ──
let _token: { value: string; expiresAt: number } | null = null;

export async function getPaypalAccessToken(): Promise<string> {
  // Reuse while it has >60s of life left.
  if (_token && _token.expiresAt - Date.now() > 60_000) return _token.value;

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;
  if (!clientId || !secret) throw new Error('PayPal credentials are not set');

  const basic = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const res = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PayPal token request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  _token = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in || 32000) * 1000,
  };
  return _token.value;
}

// Generic authenticated PayPal REST call. Returns { ok, status, data } — never
// throws on a non-2xx (so callers decide how to handle it); only throws if the
// network call itself fails or creds are missing.
export async function paypalFetch<T = unknown>(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    // Act on a connected seller's behalf (multiparty). PayPal reads this from
    // the PayPal-Auth-Assertion header; pass the seller's merchant id.
    onBehalfOf?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<{ ok: boolean; status: number; data: T }> {
  const token = await getPaypalAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(init.headers || {}),
  };
  const bn = paypalBnCode();
  if (bn) headers['PayPal-Partner-Attribution-Id'] = bn;
  if (init.onBehalfOf) headers['PayPal-Auth-Assertion'] = buildAuthAssertion(init.onBehalfOf);

  const res = await fetch(`${paypalBaseUrl()}${path}`, {
    method: init.method || 'GET',
    headers,
    body: init.body != null ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let data: T;
  try { data = text ? (JSON.parse(text) as T) : ({} as T); } catch { data = text as unknown as T; }
  return { ok: res.ok, status: res.status, data };
}

// PayPal-Auth-Assertion: an unsigned JWT ({alg:none}) carrying our client id +
// the seller's merchant id, so a call is attributed to the connected account.
// PayPal accepts the "none" algorithm for this specific header on Commerce
// Platform calls.
function buildAuthAssertion(merchantId: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64({ alg: 'none' });
  const payload = b64({ iss: process.env.PAYPAL_CLIENT_ID, payer_id: merchantId });
  return `${header}.${payload}.`;
}
