// Netlify Scheduled Function — pings the auto-decline API route once an hour.
// The route declines any pending booking request past its deadline (10 days,
// or midnight entering the event day, in the DJ's timezone). Hourly so a
// deadline that falls at any hour is acted on promptly.
//
// Requires in Netlify:
//   URL          — provided automatically by Netlify (the site's base URL)
//   CRON_SECRET  — the shared secret the route checks (set this yourself)

export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://globaldjconnect.com';
  const secret = process.env.CRON_SECRET || '';
  try {
    const res = await fetch(`${base}/api/cron/auto-decline`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}` },
    });
    const text = await res.text();
    console.log('[auto-decline]', res.status, text.slice(0, 500));
  } catch (err) {
    console.error('[auto-decline] failed', err);
  }
  return new Response('ok');
};

export const config = { schedule: '0 * * * *' };
