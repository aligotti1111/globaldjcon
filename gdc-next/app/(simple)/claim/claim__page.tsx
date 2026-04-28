'use client';

// /claim — public form where someone whose listing was created by an admin
// (placeholder email + no password) can request access. They fill in their
// real name + email + the listing's business name + a verification message
// (link to website, social, etc.). Admin reviews via /admin → Pending Claims.
//
// On approve, the admin panel:
//   1. Swaps the auth.users email to the claimant's real email
//   2. Marks public.users.claimed = true
//   3. Generates a one-time password_setup_tokens row + 24h expiry
//   4. Emails them a link to /set-password?token=<token> (DEFERRED until
//      the send-email API route exists)
//
// Faithful port of vanilla claim.html.

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import styles from './claim.module.css';

// Default export wraps the inner component in Suspense. Next.js 15 requires
// useSearchParams() to be inside a Suspense boundary, otherwise the page
// can't be statically generated and build fails.
export default function ClaimPage() {
  return (
    <Suspense fallback={null}>
      <ClaimPageInner />
    </Suspense>
  );
}

function ClaimPageInner() {
  const searchParams = useSearchParams();

  // Pre-fill from URL params: ?name=Foo&slug=bar (set by the "Claim this
  // profile" link on a DJ's public page)
  const [yourName, setYourName] = useState('');
  const [yourEmail, setYourEmail] = useState('');
  const [bizName, setBizName] = useState('');
  const [verifyMsg, setVerifyMsg] = useState('');
  const [slug, setSlug] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill name + slug from URL on mount
  useEffect(() => {
    const nameParam = searchParams.get('name');
    const slugParam = searchParams.get('slug');
    if (nameParam) setBizName(nameParam);
    if (slugParam) setSlug(slugParam);
  }, [searchParams]);

  async function submit() {
    setError(null);
    const trimmedName = yourName.trim();
    const trimmedEmail = yourEmail.trim().toLowerCase();
    const trimmedBiz = bizName.trim();
    if (!trimmedName || !trimmedEmail || !trimmedBiz) {
      setError('Please fill in your name, email, and the business name.');
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();

      // Step 1: resolve target user ID from slug if provided. Optional —
      // claims without a target_user_id can still be created (admin will
      // see a warning when trying to approve).
      let targetUserId: string | null = null;
      if (slug) {
        const { data: rows } = await supabase
          .from('users')
          .select('id')
          .eq('slug', slug)
          .limit(1);
        if (rows && rows[0]) targetUserId = (rows[0] as { id: string }).id;
      }

      // Step 2: insert into profile_claims. RLS policy on this table allows
      // public inserts (it's a contact form). Admin-only on read/update.
      const { error: insErr } = await supabase
        .from('profile_claims')
        .insert([{
          claimant_name: trimmedName,
          claimant_email: trimmedEmail,
          target_user_id: targetUserId,
          target_slug: slug || '',
          target_biz_name: trimmedBiz,
          verify_msg: verifyMsg.trim() || null,
        }] as unknown as never);

      if (insErr) throw insErr;

      // Step 3: notification email to admin + receipt email to claimant
      // — DEFERRED until send-email API route exists.

      setDone({ email: trimmedEmail });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.navLogo}>Global DJ Connect</Link>
          <Link href="/login" className={styles.btnOutline}>Sign In</Link>
        </div>
      </header>

      <div className={styles.pageWrap}>
        <div className={styles.eyebrow}>Profile Ownership</div>
        <h1>Claim Your Profile</h1>
        <p className={styles.subtitle}>
          Your business was listed on Global DJ Connect. Fill out this form
          and we&apos;ll verify your identity and give you full access to
          manage your listing. Your request will be sent to{' '}
          <a href="mailto:info@globaldjconnect.com" className={styles.inlineLink}>
            info@globaldjconnect.com
          </a>
          , and a copy will be emailed to you for your records.
        </p>

        {/* Profile reference — only shown when claim was opened from a
            specific listing (so user knows which one they're claiming) */}
        {bizName && slug && (
          <div className={styles.profileRef}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
            <p>
              Requesting access to: <strong>{bizName}</strong>
            </p>
          </div>
        )}

        {error && <div className={`${styles.alert} ${styles.alertError}`}>{error}</div>}

        {done ? (
          <div className={`${styles.alert} ${styles.alertSuccess}`}>
            ✓ Request sent! We&apos;ll review your claim and reach out to{' '}
            <strong>{done.email}</strong> within 1–2 business days.
          </div>
        ) : (
          <>
            <div className={styles.formGroup}>
              <label>Your Name</label>
              <input
                type="text"
                placeholder="Your full name"
                value={yourName}
                onChange={(e) => setYourName(e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label>Your Email</label>
              <input
                type="email"
                placeholder="The email you want to log in with"
                value={yourEmail}
                onChange={(e) => setYourEmail(e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label>Business / DJ Name on the Listing</label>
              <input
                type="text"
                placeholder="Exactly as it appears on the profile"
                value={bizName}
                onChange={(e) => setBizName(e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label>How can we verify it&apos;s you?</label>
              <textarea
                placeholder="e.g. link to your website, social media, phone number we can call..."
                value={verifyMsg}
                onChange={(e) => setVerifyMsg(e.target.value)}
              />
            </div>

            <button
              type="button"
              className={styles.submitBtn}
              onClick={submit}
              disabled={submitting}
            >
              {submitting ? 'Sending…' : 'Send Claim Request'}
            </button>

            <p className={styles.note}>
              We typically respond within 1–2 business days. Once verified,
              you&apos;ll receive a link to set your password and finish
              activating your account.
            </p>
          </>
        )}
      </div>
    </>
  );
}
