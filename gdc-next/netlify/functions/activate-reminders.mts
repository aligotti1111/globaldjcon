// Netlify scheduled function — runs once a day and triggers the
// activate-reminders cron route on the site. Kept thin on purpose: all the
// logic lives in the Next API route (app/api/cron/activate-reminders), which
// is also manually testable. This just calls it on a schedule with the shared
// secret so no one else can invoke it.
//
// Netlify picks this up automatically from netlify/functions (base = gdc-next).
// The `config.schedule` uses cron/keyword syntax; "@daily" runs at 00:00 UTC.

export default async () => {
  const secret = process.env.CRON_SECRET || '';
  try {
    const res = await fetch('https://globaldjconnect.com/api/cron/activate-reminders', {
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
