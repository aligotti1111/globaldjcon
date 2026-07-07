'use client';

// DiscountUsage — shows the DJ who has redeemed their sales / promo codes and
// when. Reads the DJ's own bookings (RLS scopes to them) that were stamped
// with a discount at booking time. Self-contained: fetches on mount.
//
// Mounted under DiscountsSection in both booking-settings tabs.

import { useEffect, useState } from 'react';
import styles from './updateDjProfile.module.css';
import { createClient } from '@/lib/supabase/client';

interface Redemption {
  requester_name: string | null;
  event_date: string | null;
  created_at: string | null;
  discount_code: string | null;
  discount_label: string | null;
  discount_amount: number | null;
  original_rate: number | null;
  quoted_rate: number | null;
  currency: string | null;
}

function money(n: number | null | undefined, cur: string | null): string {
  if (n == null) return '';
  const sym = cur === 'GBP' ? '£' : cur === 'EUR' ? '€' : cur === 'CAD' ? 'CA$' : '$';
  return `${sym}${Number(n).toLocaleString()}`;
}

function fmtDate(s: string | null): string {
  if (!s) return '';
  const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

export default function DiscountUsage() {
  const [rows, setRows] = useState<Redemption[] | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (mounted) setRows([]); return; }
      const { data } = await supabase
        .from('bookings')
        .select('requester_name, event_date, created_at, discount_code, discount_label, discount_amount, original_rate, quoted_rate, currency')
        .eq('dj_id', user.id)
        .not('discount_amount', 'is', null)
        .order('created_at', { ascending: false });
      if (mounted) setRows((data as unknown as Redemption[]) || []);
    })();
    return () => { mounted = false; };
  }, []);

  // Don't render the section at all until we know there's something to show.
  if (rows == null || rows.length === 0) return null;

  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>Discount Usage</div>
      </div>
      <div className={`${styles.sectionBody} ${styles.settingsBody}`}>
        <div className={styles.settingHint} style={{ marginBottom: '.85rem' }}>
          Who booked with a sale or promo code, and how much they saved.
        </div>
        {rows.map((r, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '.5rem 1rem',
              padding: '.7rem .9rem',
              marginBottom: '.6rem',
              border: '1px solid var(--border, rgba(255,255,255,.12))',
              borderRadius: 8,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ color: 'var(--white,#fff)', fontWeight: 600 }}>
                {r.requester_name || 'Someone'}
              </span>
              <span style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.8rem' }}>
                Booked {fmtDate(r.created_at)}
                {r.event_date ? ` · Event ${fmtDate(r.event_date)}` : ''}
              </span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span
                style={{
                  display: 'inline-block',
                  background: 'rgba(0,224,164,.12)',
                  color: 'var(--neon,#00e0a4)',
                  fontSize: '.72rem',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 999,
                  marginBottom: 3,
                }}
              >
                {r.discount_label || r.discount_code || 'Discount'}
              </span>
              <div style={{ color: 'var(--white,#fff)', fontSize: '.82rem' }}>
                saved {money(r.discount_amount, r.currency)}
                {r.original_rate != null ? ` (was ${money(r.original_rate, r.currency)})` : ''}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
