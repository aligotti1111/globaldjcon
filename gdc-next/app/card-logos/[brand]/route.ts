// Serves the card-brand logos (Visa / Mastercard / Amex / Discover) as PNGs
// from the base64 in lib/cardLogos. Lets invoice emails link them as normal
// remote images (which Gmail and other webmail render by default) without
// committing binary files to the repo.
//
// URL: /card-logos/visa.png  (the ".png" is optional — stripped below)
import { NextResponse } from 'next/server';
import { CARD_LOGOS } from '@/lib/cardLogos';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ brand: string }> },
) {
  const { brand } = await params;
  const key = brand.replace(/\.png$/i, '').toLowerCase();
  const b64 = CARD_LOGOS[key];
  if (!b64) return new NextResponse('Not found', { status: 404 });
  const bytes = Buffer.from(b64, 'base64');
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      // Immutable — the marks never change; let email clients and CDNs cache hard.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
