'use client';

// DiscountsOnlyClient — the manager/admin teammate view of Booking Settings.
//
// A teammate can't manage the rest of Booking Settings (owner-only), but they
// CAN create discounts & promo codes. This renders JUST the Discounts box and
// saves through /api/dj/discounts, which writes to the OWNER's account with the
// service-role client (a teammate can't update the owner's users row directly).
//
// Owners never see this — they get the full BookingSettingsClient with all tabs.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { parseBookingSettings } from '@/app/(main)/[slug]/bookingSettings';
import type { PromoCode, Sale, DiscountExclusion } from '@/app/(main)/[slug]/bookingSettings';
import DiscountsSection from '../update-dj-profile/DiscountsSection';
import styles from '../update-dj-profile/updateDjProfile.module.css';

interface Props {
  bookingSettings: string | null;
}

// Minimal symbol map — DiscountsSection only uses it to prefix amounts.
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', CAD: '$', AUD: '$', NZD: '$', MXN: '$',
  EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', INR: '₹',
};

export default function DiscountsOnlyClient({ bookingSettings }: Props) {
  const parsed = parseBookingSettings(bookingSettings) || {};
  const currencySymbol = CURRENCY_SYMBOLS[(parsed as { rate_currency?: string }).rate_currency || 'USD'] || '$';

  const [promoCodes, setPromoCodes] = useState<PromoCode[]>(parsed.promo_codes || []);
  const [sale, setSale] = useState<Sale>(parsed.sale || {});
  const [saleHistory, setSaleHistory] = useState<Sale[]>(parsed.sale_history || []);
  const [exclusions, setExclusions] = useState<DiscountExclusion[]>(parsed.exclusions || []);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced save of the current discount state to the owner's account.
  const persist = useCallback((body: Record<string, unknown>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setStatus('saving');
      try {
        const res = await fetch('/api/dj/discounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('save failed');
        setStatus('saved');
        if (idleTimer.current) clearTimeout(idleTimer.current);
        idleTimer.current = setTimeout(() => setStatus('idle'), 4000);
      } catch {
        setStatus('error');
      }
    }, 600);
  }, []);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (idleTimer.current) clearTimeout(idleTimer.current);
  }, []);

  function onChange(patch: { promo_codes?: PromoCode[]; sale?: Sale; sale_history?: Sale[]; exclusions?: DiscountExclusion[] }) {
    // Fold the patch into local state, then persist the merged discount subset.
    const next = {
      promo_codes: patch.promo_codes ?? promoCodes,
      sale: patch.sale ?? sale,
      sale_history: patch.sale_history ?? saleHistory,
      exclusions: patch.exclusions ?? exclusions,
    };
    if (patch.promo_codes) setPromoCodes(patch.promo_codes);
    if (patch.sale) setSale(patch.sale);
    if (patch.sale_history) setSaleHistory(patch.sale_history);
    if (patch.exclusions) setExclusions(patch.exclusions);
    persist(next);
  }

  return (
    <div className={`${styles.container} gdcNiceSettings`} style={{ maxWidth: 1100, width: '100%', marginLeft: 'auto', marginRight: 'auto' }}>
      <div className={styles.headerRow}>
        <Link href="/upcoming-bookings" className={styles.backLink}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </Link>
        {status !== 'idle' && (
          <span
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '.6rem',
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              color: status === 'error' ? '#ff5f5f' : status === 'saved' ? 'var(--neon)' : 'var(--muted)',
            }}
          >
            {status === 'saving' ? 'Saving…' : status === 'saved' ? '✓ Saved' : '✗ Save failed'}
          </span>
        )}
      </div>

      <div className={styles.header}>
        <h1>Discounts &amp; Promo Codes</h1>
        <p>Create and manage sales and promo codes for this account.</p>
      </div>

      <div className={styles.card}>
        <DiscountsSection
          promoCodes={promoCodes}
          sale={sale}
          saleHistory={saleHistory}
          exclusions={exclusions}
          currencySymbol={currencySymbol}
          onChange={onChange}
        />
      </div>
    </div>
  );
}
