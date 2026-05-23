// /api/distance — server-side driving-distance lookup via the Google
// Distance Matrix API.
//
// Why a server route: the Google Maps API key must never reach the
// browser (an exposed key can be stolen and run up a bill). The key
// lives in the GOOGLE_MAPS_API_KEY environment variable, read only here
// on the server. The booking cards / forms call this route instead of
// Google directly.
//
// Request:  POST { origin: string, destLat: number, destLon: number }
//   origin   — free-text DJ home base, e.g. "Staten Island, NY 10307"
//   destLat  — venue latitude
//   destLon  — venue longitude
// Response: { miles: number } on success, or { error } with a status.
//
// Google returns DRIVING distance (road network), which is what a DJ's
// travel range actually means — not straight-line.

import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Distance lookup is not configured.' },
      { status: 500 },
    );
  }

  let body: { origin?: string; destLat?: number; destLon?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const origin = (body.origin || '').trim();
  const destLat = body.destLat;
  const destLon = body.destLon;
  if (!origin || typeof destLat !== 'number' || typeof destLon !== 'number') {
    return NextResponse.json(
      { error: 'Missing origin or destination coordinates' },
      { status: 400 },
    );
  }

  // Destination is a precise lat,lng (captured from the venue address at
  // booking time). Origin is the DJ's free-text location — Google
  // geocodes it as part of the request. units=imperial → miles.
  const url =
    'https://maps.googleapis.com/maps/api/distancematrix/json'
    + `?origins=${encodeURIComponent(origin)}`
    + `&destinations=${encodeURIComponent(`${destLat},${destLon}`)}`
    + '&units=imperial'
    + `&key=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    // Distance Matrix nests the result: rows[0].elements[0].
    const element = data?.rows?.[0]?.elements?.[0];
    if (data?.status !== 'OK' || !element || element.status !== 'OK') {
      // No route found, bad address, quota, etc. — report gracefully so
      // the caller can fall back rather than crash.
      return NextResponse.json(
        { error: 'No route found', googleStatus: data?.status, elementStatus: element?.status },
        { status: 422 },
      );
    }

    // element.distance.value is in METERS regardless of the units param
    // (units only affects the human-readable .text). Convert to miles.
    const meters = Number(element.distance?.value);
    if (!Number.isFinite(meters)) {
      return NextResponse.json({ error: 'Malformed distance result' }, { status: 422 });
    }
    const miles = meters / 1609.344;

    return NextResponse.json({ miles });
  } catch {
    return NextResponse.json({ error: 'Distance lookup failed' }, { status: 502 });
  }
}
