// API route: POST /api/signup-send-verification
// Ports /netlify/functions/signup-send-verification.js to a Next.js route.
//
// Generates a one-time email-verification token, stores it in
// public.email_verification_tokens, and sends the user a verification link
// via Resend. The link points at /api/verify-email?token=... which flips
// public.users.email_verified = true.
//
// Auth note: this is intentionally NOT behind auth — it's called immediately
// after signUp from the browser (when the user has a session but maybe not
// a usable one yet) AND from the resend button on the success screen (where
// there's no session). We rely on the token system being self-validating.
//
// Body: { user_id?, email, role, slug? }
//   user_id is optional. When omitted (resend case), we look it up by email
//   via the admin auth API.

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { randomBytes } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { getLiveFreeSale } from '@/lib/siteSale';

const TOKEN_TTL_HOURS = 24;
const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const REPLY_TO = 'info@globaldjconnect.com';
const LOGO_URL = 'https://hwqvzuusquruhwguqole.supabase.co/storage/v1/object/public/assets/gdj-logo-email.png';

interface SendVerificationBody {
  user_id?: string;
  email: string;
  role: 'dj' | 'host' | 'venue';
  slug?: string | null;
  // Optional booking intent — set when the signup originated from a
  // "Sign in to book" gate (embed or profile calendar). When both are
  // present, the confirmation email includes a "Continue booking" link.
  bookingDjSlug?: string | null;
  bookingDate?: string | null;
  // When true, this signup is heading straight to a PAID checkout, so DON'T
  // grant the live free-month sale comp — the DJ is buying a plan and a free
  // trial shouldn't stack (nor should a Pro-tier free sale free-month a Premium
  // Pro purchase). Only ever SKIPS a grant, so it's safe to take from the client.
  skipFreeGrant?: boolean;
}

export async function POST(request: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY not set' },
      { status: 500 }
    );
  }
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'RESEND_API_KEY not set' }, { status: 500 });
  }

  let body: SendVerificationBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { email, role } = body;
  let { user_id } = body;
  // A user_id in the body means this is a FRESH signup (the browser just created
  // the account); the resend case omits it. Only a fresh DJ signup is eligible
  // for a site-wide FREE sale comp.
  const freshSignup = !!body.user_id;
  // A paid-checkout signup opts out of the free-month sale comp (see body doc).
  const skipFreeGrant = body.skipFreeGrant === true;
  if (!email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
  }

  const admin = createAdminClient();

  // If user_id wasn't provided (resend case), look it up by email
  if (!user_id) {
    try {
      // Supabase admin.listUsers can paginate; we use email filter via the
      // dedicated method when available, otherwise fall back to a small list.
      const { data, error } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      if (error) throw error;
      const match = data?.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (!match) {
        return NextResponse.json(
          { error: 'No account found for that email' },
          { status: 404 }
        );
      }
      user_id = match.id;
    } catch (e) {
      console.error('[signup-send-verification] user lookup failed', e);
      return NextResponse.json(
        { error: 'Could not look up the user. Please try again.' },
        { status: 500 }
      );
    }
  }

  // Generate token + insert into email_verification_tokens
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString();

  // Booking intent (slug + valid date) → a relative redirect path stored
  // on the token row. The verify route reads it after a successful confirm
  // to send the dedicated "continue your booking" follow-up email.
  // SECURITY: validate the date format AND that the slug maps to a real DJ
  // before storing it, so a crafted signup can't get a link to a junk or
  // arbitrary slug placed inside an email sent from our domain. The slug is
  // also URL-encoded so it can't break out of the same-origin path.
  const { bookingDjSlug, bookingDate } = body;
  const validDate = !!bookingDate && /^\d{4}-\d{2}-\d{2}$/.test(bookingDate);
  const validSlug = !!bookingDjSlug && /^[a-zA-Z0-9_-]{1,64}$/.test(bookingDjSlug);
  let slugExists = false;
  if (validSlug && validDate) {
    try {
      const { data: djRow } = await admin
        .from('users')
        .select('id')
        .eq('slug', bookingDjSlug)
        .eq('role', 'dj')
        .maybeSingle<{ id: string }>();
      slugExists = !!djRow;
    } catch {
      slugExists = false;
    }
  }
  const bookingRedirectPath = (slugExists && validSlug && validDate)
    ? `/${encodeURIComponent(bookingDjSlug!)}?date=${encodeURIComponent(bookingDate!)}&book=1`
    : null;

  try {
    const { error } = await admin
      .from('email_verification_tokens')
      .insert({
        token,
        user_id,
        email,
        expires_at: expiresAt,
        booking_redirect: bookingRedirectPath,
      } as unknown as never);
    if (error) throw error;
  } catch (e) {
    console.error('[signup-send-verification] token insert failed', e);
    return NextResponse.json(
      { error: 'Could not create verification token' },
      { status: 502 }
    );
  }

  // SITE-WIDE FREE SALE: if a free (comp) sale is live and this is a fresh DJ
  // signup with no comp yet, grant the free access here (server-side — the
  // client can't be trusted to set comp_tier). Best-effort; a failure never
  // blocks the verification email.
  if (freshSignup && role === 'dj' && user_id && !skipFreeGrant) {
    try {
      const free = await getLiveFreeSale(admin);
      if (free && free.grant_tier && free.grant_months) {
        const { data: prof } = await admin
          .from('users')
          .select('role, created_at, comp_source, comp_expires_at')
          .eq('id', user_id)
          .maybeSingle<{ role: string | null; created_at: string | null; comp_source: string | null; comp_expires_at: string | null }>();
        // Gate on the DATABASE, not the request body: this route is
        // unauthenticated and the "resend verification" button also sends a
        // user_id, so a body flag alone would let an existing DJ (or an attacker
        // POSTing any DJ's id) claim/renew the comp. Only a genuinely brand-new
        // account (created seconds ago) that has NEVER been sale-comped qualifies.
        const createdMs = prof?.created_at ? new Date(prof.created_at).getTime() : 0;
        const isBrandNew = createdMs > 0 && Date.now() - createdMs < 15 * 60 * 1000; // 15 min
        const neverSaleComped = prof?.comp_source !== 'sale';
        const hasComp = !!prof?.comp_expires_at && new Date(prof.comp_expires_at).getTime() > Date.now();
        if (prof?.role === 'dj' && isBrandNew && neverSaleComped && !hasComp) {
          const end = new Date();
          end.setUTCMonth(end.getUTCMonth() + free.grant_months);
          const { error: grantErr } = await admin
            .from('users')
            .update({
              comp_tier: free.grant_tier,
              comp_expires_at: end.toISOString(),
              comp_source: 'sale',
            } as unknown as never)
            .eq('id', user_id);
          // Only record the redemption if the grant actually landed — otherwise
          // we'd log a "used" row for access the DJ never got. Recording lets the
          // admin "who used this sale" list work for FREE sales too (these grant
          // here, not via Stripe checkout). Idempotent via the table's unique
          // (code_type, code_id, user_id).
          if (!grantErr) {
            try {
              const { error: redErr } = await (admin as unknown as { from: (t: string) => { upsert: (v: unknown, o: unknown) => Promise<{ error: { message?: string } | null }> } })
                .from('code_redemptions')
                .upsert(
                  { code_type: 'sale', code_id: free.id, user_id },
                  { onConflict: 'code_type,code_id,user_id', ignoreDuplicates: true },
                );
              if (redErr) console.warn('[signup-send-verification] redemption record failed', redErr.message);
            } catch { /* best-effort; never block signup */ }
          }
        }
      }
    } catch (e) {
      console.error('[signup-send-verification] free-sale grant failed', e);
    }
  }

  // Build the verify URL using the same origin we received the request on,
  // so verification works on staging (gdc-next-staging.netlify.app) AND
  // production (globaldjconnect.com) without env-var juggling.
  const requestUrl = new URL(request.url);
  const requestOrigin = requestUrl.origin;
  // Verify URL MUST use the request origin so the token lookup happens on
  // the same deployment that issued it (a token from staging won't exist
  // in prod's DB and vice versa).
  const verifyUrl = `${requestOrigin}/api/verify-email?token=${encodeURIComponent(token)}`;
  // Outbound user-facing links (e.g. "Continue booking" in the email) use
  // the canonical site origin when configured, so production emails never
  // leak a staging hostname into the inbox. Falls back to request origin
  // when NEXT_PUBLIC_SITE_URL isn't set (e.g. local dev).
  const publicOrigin = (process.env.NEXT_PUBLIC_SITE_URL || requestOrigin).replace(/\/$/, '');
  const roleDisplay = role === 'dj' ? 'DJ' : (role === 'venue' ? 'Venue' : 'Host');

  // Full "Continue booking" URL for the confirmation email (Stage 1).
  // Built from the same booking intent stored on the token above; this
  // is a SEPARATE link from Verify — it doesn't change the Verify button.
  const bookingUrl = bookingRedirectPath ? `${publicOrigin}${bookingRedirectPath}` : null;
  const niceDate = validDate
    ? new Date(`${bookingDate}T12:00:00`).toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      })
    : '';
  // Step labels only make sense when there are TWO steps to walk through
  // (verify + then continue booking). For a normal signup with no booking
  // intent, the email has just one button — no "Step 1" label needed.
  const verifyStepLabel = bookingUrl ? '<span class="step">Step 1</span>' : '';
  const bookingBlock = bookingUrl
    ? `<p style="margin-top:28px;">Once your email is verified, continue the booking you started:</p>
       <p style="text-align:center;"><span class="step">Step 2</span><a href="${bookingUrl}" class="btn btn2" style="color:#000000;">Continue Your Booking${niceDate ? ` · ${niceDate}` : ''}</a></p>`
    : '';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:0;background:#050507;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f0f0f8;}
    .wrap{max-width:560px;margin:0 auto;padding:40px 24px;}
    .card{background:#13131e;border:1px solid #1e1e30;border-radius:12px;padding:40px 32px;}
    h1{font-family:'Bebas Neue',sans-serif;font-size:32px;letter-spacing:.05em;color:#00f5c4;margin:0 0 16px;}
    p{font-size:15px;line-height:1.6;color:#c4c4d4;margin:0 0 16px;}
    .btn{display:inline-block;background:#00f5c4;color:#000000;padding:14px 28px;border-radius:6px;font-weight:700;text-decoration:none;letter-spacing:.04em;font-size:14px;margin:20px 0;}
    .btn2{background:#ffffff;color:#000000;border:1px solid #ffffff;}
    .step{display:block;font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.18em;color:#ffffff;text-transform:uppercase;margin:18px 0 6px;text-align:left;}
    .footer{font-size:12px;color:#6a6a80;text-align:center;margin-top:24px;}
    .logo{text-align:center;margin-bottom:24px;font-family:'Bebas Neue',Impact,sans-serif;font-size:28px;letter-spacing:.06em;color:#00f5c4;}
  </style></head><body>
    <div class="wrap">
      <div class="logo">GLOBAL DJ CONNECT</div>
      <div class="card">
        <h1>Confirm Your Email</h1>
        <p>Welcome to Global DJ Connect! You've been signed up as a ${roleDisplay}.</p>
        <p>Click the button below to verify your email and unlock messaging, booking, and all features:</p>
        <p style="text-align:center;">${verifyStepLabel}<a href="${verifyUrl}" class="btn" style="color:#000000;">Verify Email</a></p>
        <p style="font-size:13px;color:#8a8a9e;">Or paste this link into your browser:<br><span style="word-break:break-all;color:#00f5c4;">${verifyUrl}</span></p>
        ${bookingBlock}
        <p style="font-size:13px;color:#8a8a9e;margin-top:24px;">This link expires in ${TOKEN_TTL_HOURS} hours. If you didn't sign up, you can safely ignore this email.</p>
      </div>
      <div class="footer">Global DJ Connect · globaldjconnect.com</div>
    </div>
  </body></html>`;

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: FROM,
      to: [email],
      replyTo: REPLY_TO,
      subject: 'Confirm Your Email — Global DJ Connect',
      html,
    });
    if (error) throw error;
  } catch (e) {
    console.error('[signup-send-verification] Resend failed', e);
    return NextResponse.json({ error: 'Email send failed' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
