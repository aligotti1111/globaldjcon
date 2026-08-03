// Netlify Scheduled Function — pings the booking-reminders API route once an
// hour. The route self-gates to the 8 AM Eastern hour (DST-aware), so the
// actual email only goes out once a day at 8 AM ET. Keeping the schedule
// hourly + gating inside the app avoids a hardcoded UTC offset that would
// drift by an hour when daylight saving changes.
//
// Requires two env vars in Netlify:
//   URL          — provided automatically by Netlify (the site's base URL)
//   CRON_SECRET  — the shared secret the route checks (set this yourself)

export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://globaldjconnect.com';
  const secret = process.env.CRON_SECRET || '';
  try {
    const res = await fetch(`${base}/api/cron/booking-reminders`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}` },
    });
    const text = await res.text();
    console.log('[booking-reminders]', res.status, text.slice(0, 500));
  } catch (err) {
    console.error('[booking-reminders] failed', err);
  }
  return new Response('ok');
};

export const config = { schedule: '0 * * * *' };
