'use client';

// SetupChecklist — onboarding for a subscribed DJ owner, with two states:
//
//   • FIRST-TIME (setup not finished yet): the full step-by-step checklist,
//     shown CENTERED under the header, so a brand-new subscriber is walked
//     through Settings → Packages → Contracts → Payments → Planner (mobile) or
//     the club equivalent. Steps complete from real data (packages/equipment/
//     payments) or from having opened the tab (settings/contracts/rider/etc.).
//
//   • DONE / RETURNING (setup finished once): a small "Review booking settings"
//     pill in the corner (portaled into the homepage search row). Once the
//     checklist first reaches all-complete we persist users.setup_reviewed=true,
//     so after that — including a cancel → resubscribe — they only ever get the
//     light pill, never the full checklist again.
//
// Only the ACCOUNT OWNER with booking access (subscribed/comped) sees any of it.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
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

export function readViewedSteps(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(viewedKey(userId));
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch { return new Set(); }
}

export function markStepViewed(userId: string, stepId: string) {
  try {
    const set = readViewedSteps(userId);
    if (set.has(stepId)) return;
    set.add(stepId);
    localStorage.setItem(viewedKey(userId), JSON.stringify([...set]));
    window.dispatchEvent(new Event('gdc-setup-progress'));
  } catch { /* non-fatal */ }
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
  setup_reviewed: boolean | null;
}

export default function SetupChecklist() {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const [row, setRow] = useState<Row | null>(null);
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [reviewedLocal, setReviewedLocal] = useState(false); // flips to pill immediately
  const markedRef = useRef(false);
  // Connector style differs by viewport: tight arrows on mobile, the original
  // plain line with wider spacing on desktop.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const actingRole = (user as { actingRole?: string } | null)?.actingRole ?? 'owner';
  const isDjOwner = !!user && user.role === 'dj' && actingRole === 'owner';
  const userId = user?.id ?? null;

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from('users')
        .select('dj_type, booking_settings, payment_methods, stripe_connect_ready, sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, comp_source, setup_reviewed')
        .eq('id', userId)
        .maybeSingle();
      setRow((data as unknown as Row) ?? null);
    } catch { setRow(null); }
  }, [userId]);

  useEffect(() => { if (isDjOwner) load(); }, [isDjOwner, pathname, load]);

  useEffect(() => {
    if (!userId) return;
    const sync = () => {
      setViewed(readViewedSteps(userId));
      // Also re-pull the row so DATA steps (packages / payments / equipment)
      // flip to done right after the DJ saves them on the same page, instead of
      // waiting for a full reload.
      if (isDjOwner) load();
    };
    sync();
    window.addEventListener('gdc-setup-progress', sync);
    window.addEventListener('focus', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('gdc-setup-progress', sync);
      window.removeEventListener('focus', sync);
      window.removeEventListener('storage', sync);
    };
  }, [userId, pathname, isDjOwner, load]);

  // Homepage search-row slot for the compact "Review booking settings" pill.
  useEffect(() => {
    if (!isDjOwner) { setSlot(null); return; }
    let raf = 0; let tries = 0;
    const find = () => {
      const el = typeof document !== 'undefined' ? document.getElementById('gdc-setup-slot') : null;
      if (el) { setSlot(el); return; }
      if (tries++ < 20) raf = requestAnimationFrame(find); else setSlot(null);
    };
    find();
    return () => cancelAnimationFrame(raf);
  }, [isDjOwner, pathname]);

  const model = useMemo(() => {
    if (!row) return null;
    const djType = row.dj_type;
    if (djType !== 'mobile' && djType !== 'club') return null;
    if (!canBook(row as unknown as AccessFields)) return null;

    const bs = (parseBookingSettings(row.booking_settings) || {}) as Record<string, unknown>;
    const packs = (bs.mob_packages as Record<string, MobilePackage[]> | undefined) || {};
    const hasPackage = Object.values(packs).some(
      (arr) => Array.isArray(arr) && arr.some(
        (pkg) => !!pkg && !!(pkg.title && String(pkg.title).trim()) &&
          (pkg.reqAll === true || packageTiers(pkg).length > 0),
      ),
    );
    const hasEquip = !!bs.equip_full || !!bs.equip_decks || !!bs.equip_none;
    const hasPayment = usableMethods(row.payment_methods || []).length > 0 || row.stripe_connect_ready === true;
    const dataDone: Record<string, boolean> = { packages: hasPackage, rates: hasEquip, payments: hasPayment };

    const steps = (djType === 'club' ? CLUB_STEPS : MOBILE_STEPS).map((s) => ({
      ...s,
      done: s.kind === 'data' ? !!dataDone[s.id] : viewed.has(s.id),
    }));
    return { steps, doneCount: steps.filter((s) => s.done).length };
  }, [row, viewed]);

  const allComplete = !!model && model.doneCount >= model.steps.length;
  // Persist the "finished setup" flag the first time everything is complete, so
  // the account permanently graduates to the light pill (survives resubscribe).
  useEffect(() => {
    if (!isDjOwner || !row || row.setup_reviewed || markedRef.current) return;
    if (allComplete) {
      markedRef.current = true;
      setReviewedLocal(true);
      void fetch('/api/dj/setup-reviewed', { method: 'POST' }).catch(() => {});
    }
  }, [isDjOwner, row, allComplete]);

  // On mobile, while the FIRST-TIME stepper is showing in the search row, hide
  // the search box and give the whole row to the checklist. Toggles a class on
  // the search-row wrapper; the CSS (page.tsx) only acts on it at mobile widths.
  useEffect(() => {
    const wrap = slot?.parentElement || null;
    if (!wrap) return;
    const reviewed = !!row?.setup_reviewed || reviewedLocal;
    const showStepper = isDjOwner && !!model && !reviewed;
    wrap.classList.toggle('gdc-checklist-active', showStepper);
    return () => { wrap.classList.remove('gdc-checklist-active'); };
  }, [slot, row, reviewedLocal, model, isDjOwner]);

  if (loading || !isDjOwner || !model) return null;

  const isReviewed = !!row?.setup_reviewed || reviewedLocal;
  const NEON = 'var(--neon,#00e0a4)';

  // Once setup is complete (or on any later resubscribe), show NOTHING. There is
  // no "Review booking settings" prompt — the checklist only ever appears while
  // the FIRST-TIME setup is still incomplete.
  if (isReviewed) return null;

  // ── FIRST-TIME (setup not finished) → full step-by-step checklist ──
  // Renders INLINE in the homepage search row (the #gdc-setup-slot).
  let content: JSX.Element;
  {
    const currentIdx = model.steps.findIndex((s) => !s.done);
    const CIRCLE = 22; // px — connectors align to its vertical center
    content = (
      // margin:0 auto centers the whole thing; label sits BELOW the steps.
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 'min-content', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', minWidth: 'min-content', gap: isMobile ? 2 : 6 }}>
        {model.steps.map((s, i) => {
          const isCurrent = i === currentIdx;
          const circleStyle: CSSProperties = s.done
            ? { background: NEON, border: `1.5px solid ${NEON}`, color: '#04121a' }
            : isCurrent
              ? { background: 'transparent', border: `1.5px solid ${NEON}`, color: NEON }
              : { background: 'transparent', border: '1.5px solid rgba(255,255,255,.3)', color: 'var(--muted,#8a8aa0)' };
          const labelColor = s.done ? NEON : isCurrent ? 'var(--white,#fff)' : 'var(--muted,#8a8aa0)';
          return (
            <Fragment key={s.id}>
              {i > 0 && (
                /* Arrow connector (line + head) on both; mobile is tighter. */
                <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', flex: '0 0 auto', marginBottom: CIRCLE / 2, color: model.steps[i - 1].done ? NEON : 'rgba(255,255,255,.3)' }}>
                  <svg width={isMobile ? 16 : 22} height={isMobile ? 13 : 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isMobile ? 2.4 : 2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h15M13 6l6 6-6 6" /></svg>
                </span>
              )}
              <Link
                href={`/booking-settings?section=${s.id}`}
                title={`Go to ${s.label}`}
                style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', flex: '0 0 auto', textDecoration: 'none', gap: 4, whiteSpace: 'nowrap', cursor: 'pointer', padding: '2px 4px', borderRadius: 8 }}
              >
                {/* label OVER the bubble */}
                <span style={{ fontFamily: 'var(--body)', fontSize: '.56rem', lineHeight: 1, color: labelColor, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', textDecoration: 'underline', textUnderlineOffset: '3px' }}>{s.label}</span>
                <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: CIRCLE, height: CIRCLE, borderRadius: '50%', flexShrink: 0, fontFamily: 'var(--body)', fontSize: '.64rem', fontWeight: 800, ...circleStyle }}>
                  {s.done ? '✓' : i + 1}
                </span>
              </Link>
            </Fragment>
          );
        })}
        </div>
        <span style={{ fontFamily: 'var(--body)', fontSize: '.66rem', fontWeight: 700, color: 'var(--white,#fff)', whiteSpace: 'nowrap' }}>
          Complete steps to activate booking engine
        </span>
      </div>
    );
  }

  if (slot) return createPortal(content, slot);
  // Fallback (non-homepage pages have no slot): a slim strip.
  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,.1)', background: 'rgba(0,0,0,.35)', padding: '.4rem .75rem' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', justifyContent: 'center', overflowX: 'auto' }}>{content}</div>
    </div>
  );
}
