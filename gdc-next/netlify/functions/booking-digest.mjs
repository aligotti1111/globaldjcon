// Netlify Scheduled Function — pings the booking-digest API route once an hour.
// The route self-gates to 8 AM Eastern and only sends the weekly digest on a
// Monday / the monthly on the 1st, so keeping the schedule hourly + gating
// inside the app avoids a hardcoded UTC offset that daylight saving would drift.
//
// Requires two env vars in Netlify:
//   URL          — provided automatically by Netlify (the site's base URL)
//   CRON_SECRET  — the shared secret the route checks (set this yourself)

export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://globaldjconnect.com';
  const secret = process.env.CRON_SECRET || '';
  try {
    const res = await fetch(`${base}/api/cron/booking-digest`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}` },
    });
    const text = await res.text();
    console.log('[booking-digest]', res.status, text.slice(0, 500));
  } catch (err) {
    console.error('[booking-digest] failed', err);
  }
  return new Response('ok');
};

export const config = { schedule: '0 * * * *' };
