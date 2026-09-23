// Netlify scheduled function — runs once a day and triggers the comp-expiry
// cron route on the site. Thin on purpose: all logic lives in the Next API
// route (app/api/cron/comp-expiry), which is also manually testable. This just
// calls it on a schedule with the shared secret so no one else can invoke it.
//
// Netlify picks this up automatically from netlify/functions (base = gdc-next).
// "@daily" runs at 00:00 UTC.

export default async () => {
  const secret = process.env.CRON_SECRET || '';
  try {
    const res = await fetch('https://globaldjconnect.com/api/cron/comp-expiry', {
      method: 'POST',
      headers: { 'x-cron-secret': secret },
    });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};

export const config = { schedule: '@daily' };
