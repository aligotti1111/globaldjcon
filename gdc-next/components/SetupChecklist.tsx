'use client';

// SetupChecklist — a horizontal onboarding strip shown under the header for a
// SUBSCRIBED DJ who hasn't finished setting up their booking page. It walks them
// through the Booking Settings tabs in order; each step gets a ✓ when done.
//
// Two kinds of steps:
//   · 'data'   — done is derived from real data (always accurate, no storage):
//                mobile Packages (≥1 package), Payments (≥1 usable method or
//                Stripe card ready), club Equipment & Rates (a selection made).
//   · 'viewed' — done once the DJ has OPENED that tab. Recorded in localStorage
//                by BookingSettingsClient (key gdc_setup_viewed_<userId>), which
//                dispatches a 'gdc-setup-progress' event we listen for.
//
// The whole strip disappears the moment every step is checked. It only shows for
// a DJ owner with booking access (subscribed/comp) — never hosts, teammates, or
// not-yet-subscribed accounts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { createClient } from '@/lib/supabase/client';
import { canBook, type AccessFields } from '@/lib/access';
import { parseBookingSettings, packageTiers, type MobilePackage } from '@/app/(main)/[slug]/bookingSettings';
import { usableMethods, type PaymentMethod } from '@/lib/paymentMethods';

type StepId = 'settings' | 'packages' | 'contracts' | 'payments' | 'planners' | 'rates' | 'rider' | 'guests';

interface StepDef { id: StepId; label: string; kind: 'data' | 'viewed' }

const MOBILE_STEPS: StepDef[] = [
  { id: 'settings', label: 'Settings', kind: 'viewed' },
  { id: 'packages', label: 'Packages', kind: 'data' },
  { id: 'contracts', label: 'Contracts', kind: 'viewed' },
  { id: 'payments', label: 'Payments', kind: 'data' },
  { id: 'planners', label: 'Planner & Playlist', kind: 'viewed' },
];

const CLUB_STEPS: StepDef[] = [
  { id: 'settings', label: 'Settings', kind: 'viewed' },
  { id: 'rates', label: 'Equipment & Rates', kind: 'data' },
  { id: 'contracts', label: 'Contracts', kind: 'viewed' },
  { id: 'rider', label: 'DJ Rider', kind: 'viewed' },
  { id: 'guests', label: 'Guest List', kind: 'viewed' },
  { id: 'payments', label: 'Payments', kind: 'data' },
];

const viewedKey = (userId: string) => `gdc_setup_viewed_${userId}`;

/** Shared reader so BookingSettingsClient and this strip agree on the store. */
export function readViewedSteps(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(viewedKey(userId));
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

/** Record a tab as viewed and notify any open strip in the same tab. */
export function markStepViewed(userId: string, stepId: string) {
  try {
    const set = readViewedSteps(userId);
    if (set.has(stepId)) return;
    set.add(stepId);
    localStorage.setItem(viewedKey(userId), JSON.stringify([...set]));
    window.dispatchEvent(new Event('gdc-setup-progress'));
  } catch { /* localStorage may be unavailable — non-fatal */ }
}

interface Row {
  dj_type: 'mobile' | 'club' | null;
  booking_settings: string | null;
  payment_methods: PaymentMethod[] | null;
  stripe_connect_ready: boolean | null;
  sub_tier: number | null;
  sub_status: string | null;
  sub_period_end: string | null;
  comp_tier: number | null;
  comp_expires_at: string | null;
  comp_source: string | null;
}

export default function SetupChecklist() {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const [row, setRow] = useState<Row | null>(null);
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  // Completion behavior: once the DJ checks the LAST step, keep the strip
  // visible (fully checked) while they're still on the page it completed on, and
  // only hide after they navigate away — instead of vanishing under them.
  const shownIncomplete = useRef(false);       // did we ever render it incomplete this mount?
  const [completedPath, setCompletedPath] = useState<string | null>(null);
  const dismissed = useRef(false);             // hidden for good this mount (post-completion nav)

  // Only DJ owners (not hosts, admins, or teammates) get the setup strip.
  const isDjOwner = !!user && user.role === 'dj' && !(user as { isMember?: boolean }).isMember;
  const userId = user?.id ?? null;

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from('users')
        .select('dj_type, booking_settings, payment_methods, stripe_connect_ready, sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, comp_source')
        .eq('id', userId)
        .maybeSingle();
      setRow((data as unknown as Row) ?? null);
    } catch {
      setRow(null);
    }
  }, [userId]);

  // Refetch the data-derived signals on mount and whenever they navigate (so a
  // package/payment added on Booking Settings reflects when they come back).
  useEffect(() => { if (isDjOwner) load(); }, [isDjOwner, pathname, load]);

  // Read viewed steps on mount + whenever a tab is opened (same-tab event) or
  // the window regains focus / another tab writes.
  useEffect(() => {
    if (!userId) return;
    const sync = () => setViewed(readViewedSteps(userId));
    sync();
    window.addEventListener('gdc-setup-progress', sync);
    window.addEventListener('focus', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('gdc-setup-progress', sync);
      window.removeEventListener('focus', sync);
      window.removeEventListener('storage', sync);
    };
  }, [userId, pathname]);

  const model = useMemo(() => {
    if (!row) return null;
    const djType = row.dj_type;
    if (djType !== 'mobile' && djType !== 'club') return null;

    // Only subscribed / comped DJs get the checklist.
    if (!canBook(row as unknown as AccessFields)) return null;

    const bs = (parseBookingSettings(row.booking_settings) || {}) as Record<string, unknown>;

    // Data signal: has at least one bookable package (mobile).
    const packs = (bs.mob_packages as Record<string, MobilePackage[]> | undefined) || {};
    const hasPackage = Object.values(packs).some(
      (arr) => Array.isArray(arr) && arr.some(
        (pkg) => !!pkg && !!(pkg.title && String(pkg.title).trim()) &&
          (pkg.reqAll === true || packageTiers(pkg).length > 0),
      ),
    );

    // Data signal: an equipment selection exists (club).
    const hasEquip = !!bs.equip_full || !!bs.equip_decks || !!bs.equip_none;

    // Data signal: a usable payment method, or Stripe card is ready.
    const hasPayment = usableMethods(row.payment_methods || []).length > 0 || row.stripe_connect_ready === true;

    const dataDone: Record<string, boolean> = {
      packages: hasPackage,
      rates: hasEquip,
      payments: hasPayment,
    };

    const steps = (djType === 'club' ? CLUB_STEPS : MOBILE_STEPS).map((s) => ({
      ...s,
      done: s.kind === 'data' ? !!dataDone[s.id] : viewed.has(s.id),
    }));

    return { steps, doneCount: steps.filter((s) => s.done).length };
  }, [row, viewed]);

  // Track completion so the strip lingers (checked) on the page it completed on,
  // then hides after the DJ navigates away.
  useEffect(() => {
    if (!model) return;
    const complete = model.doneCount >= model.steps.length;
    if (!complete) {
      shownIncomplete.current = true;
      if (completedPath !== null) setCompletedPath(null);
      return;
    }
    // complete:
    if (shownIncomplete.current && completedPath === null) {
      setCompletedPath(pathname);              // pin the page it completed on
    } else if (completedPath !== null && pathname !== completedPath) {
      dismissed.current = true;                // they left → gone for good
    }
  }, [model, pathname, completedPath]);

  if (loading || !isDjOwner || !model || dismissed.current) return null;

  const complete = model.doneCount >= model.steps.length;
  if (complete) {
    // Already complete when this page first loaded (finished in a past session)
    // → never show. Only linger when they just completed it live.
    if (!shownIncomplete.current) return null;
    // Completed live: keep showing (all checked) until they leave the page it
    // completed on; after that, hide for good.
    if (completedPath !== null && pathname !== completedPath) return null;
  }

  return (
    <div
      style={{
        borderBottom: '1px solid rgba(255,255,255,.1)',
        background: 'rgba(0,0,0,.35)',
        padding: '.55rem 1rem',
      }}
    >
      <div
        style={{
          maxWidth: 1180, margin: '0 auto', display: 'flex', alignItems: 'center',
          gap: '.9rem', flexWrap: 'wrap', justifyContent: 'center',
        }}
      >
        <span
          style={{
            fontFamily: "'Space Mono', monospace", fontSize: '.6rem', letterSpacing: '.08em',
            textTransform: 'uppercase', color: 'var(--muted,#8a8aa0)', whiteSpace: 'nowrap',
          }}
        >
          Finish setup · {model.doneCount}/{model.steps.length}
        </span>
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          {model.steps.map((s) => (
            <Link
              key={s.id}
              href={`/booking-settings?section=${s.id}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '.4rem', textDecoration: 'none',
                border: `1px solid ${s.done ? 'var(--neon,#00e0a4)' : 'rgba(255,255,255,.18)'}`,
                background: s.done ? 'rgba(0,224,164,.12)' : 'transparent',
                color: s.done ? 'var(--neon,#00e0a4)' : 'var(--white,#fff)',
                borderRadius: 999, padding: '.3rem .7rem', fontSize: '.78rem', fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              <span
                aria-hidden
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 15, height: 15, borderRadius: '50%', flexShrink: 0,
                  border: `1.5px solid ${s.done ? 'var(--neon,#00e0a4)' : 'rgba(255,255,255,.35)'}`,
                  background: s.done ? 'var(--neon,#00e0a4)' : 'transparent',
                  color: '#04121a', fontSize: '.6rem', fontWeight: 800,
                }}
              >
                {s.done ? '✓' : ''}
              </span>
              {s.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
