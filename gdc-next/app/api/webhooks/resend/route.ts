// POST /api/webhooks/resend
//
// Records email OPENS. Resend fires "email.opened" when the recipient's mail
// client loads the tracking pixel; we tagged each send with the booking id and
// stage, so we can stamp bookings.email_opens[stage] with the FIRST open time.
//
// Reliability note (why the UI says "Likely opened", not "Read"): pixel opens
// are a soft signal. Apple Mail Privacy Protection pre-loads the pixel, so it
// can report an open the recipient never made; image-blocking setups do the
// opposite. Treat it as a hint.
//
// Signature: Resend signs with Svix. Set RESEND_WEBHOOK_SECRET (whsec_...).

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { readEmailTags } from '@/lib/emailTracking';

export const runtime = 'nodejs';

// Svix signature check. signedContent = `${id}.${timestamp}.${body}`; the
// secret is base64 after the whsec_ prefix; the header carries one or more
// space-separated `v1,<base64sig>` entries.
function verifySignature(secret: string, headers: Headers, body: string): boolean {
  const id = headers.get('svix-id');
  const ts = headers.get('svix-timestamp');
  const sigHeader = headers.get('svix-signature');
  if (!id || !ts || !sigHeader) return false;
  let secretBytes: Buffer;
  try { secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64'); } catch { return false; }
  const signed = `${id}.${ts}.${body}`;
  const expected = crypto.createHmac('sha256', secretBytes).update(signed).digest('base64');
  const expBuf = Buffer.from(expected);
  return sigHeader.split(' ').some((part) => {
    const v = part.split(',')[1];
    if (!v) return false;
    const vBuf = Buffer.from(v);
    return vBuf.length === expBuf.length && crypto.timingSafeEqual(vBuf, expBuf);
  });
}

const KNOWN_STAGES = new Set(['contract', 'deposit', 'balance', 'planner', 'guestlist', 'rider']);

export async function POST(req: Request) {
  const raw = await req.text();

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret && !verifySignature(secret, req.headers, raw)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let evt: { type?: string; created_at?: string; data?: { created_at?: string; tags?: unknown } };
  try { evt = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }

  if (evt?.type !== 'email.opened') return NextResponse.json({ ok: true });

  const { bookingId, stage } = readEmailTags(evt?.data?.tags);
  if (!bookingId || !stage || !KNOWN_STAGES.has(stage)) return NextResponse.json({ ok: true });

  // Open time is the TOP-LEVEL created_at (event time); data.created_at is when
  // the email was created, not opened.
  const openedAt = evt?.created_at || evt?.data?.created_at || new Date().toISOString();

  const admin = createAdminClient();
  const { data } = await admin.from('bookings').select('email_opens').eq('id', bookingId).maybeSingle();
  const cur = ((data as { email_opens?: Record<string, string> | null } | null)?.email_opens) || {};
  if (cur[stage]) return NextResponse.json({ ok: true }); // keep the FIRST open

  await admin
    .from('bookings')
    .update({ email_opens: { ...cur, [stage]: openedAt } } as unknown as never)
    .eq('id', bookingId);

  return NextResponse.json({ ok: true });
}
