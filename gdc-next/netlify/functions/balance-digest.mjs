// Netlify Scheduled Function — pings the balance-digest API route once an hour.
// The route self-gates to the 8 AM Eastern hour on MONDAY (DST-aware), so the
// unpaid-balance email only goes out once a week, Monday morning. Keeping the
// schedule hourly + gating inside the app avoids a hardcoded UTC offset that
// would drift by an hour across daylight saving.
//
// Requires two env vars in Netlify:
//   URL          — provided automatically by Netlify (the site's base URL)
//   CRON_SECRET  — the shared secret the route checks (set this yourself)

export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://globaldjconnect.com';
  const secret = process.env.CRON_SECRET || '';
  try {
    const res = await fetch(`${base}/api/cron/balance-digest`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}` },
    });
    const text = await res.text();
    console.log('[balance-digest]', res.status, text.slice(0, 500));
  } catch (err) {
    console.error('[balance-digest] failed', err);
  }
  return new Response('ok');
};

export const config = { schedule: '0 * * * *' };
