'use client';

// Driving distance from the DJ's home base to a booking's venue — the same
// figure shown on the booking-request card, surfaced under the Venue Address on
// the upcoming-bookings details panel. Falls back to straight-line distance if
// the driving lookup fails, and shows nothing until (and unless) a number
// resolves, so it never clutters bookings without venue coordinates.

import { useEffect, useState } from 'react';
import { haversineMiles, lookupZipCoords, drivingMiles } from '../booking-requests/helpers';

export default function VenueDistance({
  venueLat, venueLon, djZip, djCity, djState,
}: {
  venueLat: number | null;
  venueLon: number | null;
  djZip: string | null;
  djCity: string | null;
  djState: string | null;
}) {
  const [miles, setMiles] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (venueLat == null || venueLon == null) return;
      if (!djZip && !djCity) return;
      const driving = await drivingMiles({ zip: djZip, city: djCity, state: djState }, venueLat, venueLon);
      if (cancelled) return;
      if (driving != null) { setMiles(driving); return; }
      const c = await lookupZipCoords({ zip: djZip, city: djCity, state: djState });
      if (cancelled || !c) return;
      setMiles(haversineMiles(c.lat, c.lon, venueLat, venueLon));
    })();
    return () => { cancelled = true; };
  }, [venueLat, venueLon, djZip, djCity, djState]);

  if (miles == null) return null;
  const color = miles < 5 ? 'var(--neon,#00f5c4)' : miles < 15 ? 'var(--amber,#f5e642)' : '#ff6b6b';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, fontSize: '.78rem', fontFamily: "'Space Mono', ui-monospace, monospace" }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg>
      <span style={{ color }}>{miles.toFixed(1)} mi to venue from your zipcode</span>
    </div>
  );
}
