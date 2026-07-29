'use client';

// BookingSettingsClient — standalone host for the booking configuration that
// used to be a tab in the profile editor. It carries ONLY the booking
// plumbing (booking_settings state + debounced autosave + master-save + dirty
// tracking) and mounts the existing BookingTab / ClubBookingTab components
// unchanged. All the booking UI — including the activate toggle and the
// "settings appear once activated" behavior — lives inside those components.
//
// This deliberately mirrors the autosave / master-save logic from
// UpdateDjProfileClient so behavior is identical, just relocated.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUnsavedChanges } from '@/components/UnsavedChangesProvider';
import { type BookingSettings, parseBookingSettings } from '@/app/(main)/[slug]/bookingSettings';
import BookingTab from '../update-dj-profile/BookingTab';
import { parseCustomEventTypes } from '@/lib/constants';
import ClubBookingTab from '../update-dj-profile/ClubBookingTab';
import ContractPortal from '../update-dj-profile/ContractPortal';
import styles from '../update-dj-profile/updateDjProfile.module.css';

interface InitialProfile {
  id: string;
  dj_type: 'club' | 'mobile' | null;
  slug: string | null;
  booking_settings: string | null;
  event_types: string | null;
  mob_custom_event_types?: unknown;
  mob_specialty_types?: unknown;
}

interface Props {
  initialProfile: InitialProfile;
  hasBookingAccess: boolean;
}

export default function BookingSettingsClient({ initialProfile, hasBookingAccess }: Props) {
  const router = useRouter();
  const djType = initialProfile.dj_type;
  const isMobile = djType === 'mobile';
  type SecTab = 'settings' | 'packages' | 'discounts' | 'payments' | 'contracts' | 'rates' | 'rider' | 'guests';
  const [secTab, setSecTab] = useState<SecTab>('settings');

  // Mobile event types feed BookingTab's selectedEventTypes prop. Same default
  // as the profile editor: a brand-new mobile DJ with nothing saved gets all
  // 12 pre-selected; club DJs default to none.
  const [selectedEventTypes, setSelectedEventTypes] = useState<string[]>(() => {
    const saved = (initialProfile.event_types || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    if (saved.length > 0) return saved;
    return djType === 'mobile'
      ? ['weddings', 'corporate', 'birthday', 'anniversary', 'graduation', 'sweet16', 'quinceanera', 'mitzvah', 'reunion', 'holiday', 'school', 'community', 'other']
      : [];
  });

  const [customEventTypes, setCustomEventTypes] = useState(
    () => parseCustomEventTypes(initialProfile.mob_custom_event_types),
  );

  // Persist event-type edits made from the package builder popup straight to
  // the DJ's profile row (same columns the profile editor writes).
  async function saveEventTypes(
    nextSelected: string[],
    nextCustom: { key: string; label: string }[],
    nextSpecialty: string[],
  ) {
    setSelectedEventTypes(nextSelected);
    setCustomEventTypes(nextCustom);
    setSpecialtyTypes(nextSpecialty);
    try {
      await supabaseRef.current
        .from('users')
        .update({
          event_types: nextSelected.length > 0 ? nextSelected.join(',') : null,
          mob_custom_event_types: nextCustom.length > 0 ? nextCustom : null,
          mob_specialty_types: nextSpecialty,
        } as unknown as never)
        .eq('id', initialProfile.id);
    } catch {
      // Non-fatal; local state already updated so the rail reflects the change.
    }
  }
  const [specialtyTypes, setSpecialtyTypes] = useState<string[]>(() => {
    const raw = initialProfile.mob_specialty_types;
    let arr: unknown = raw;
    if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch { arr = null; } }
    if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string');
    return ['weddings', 'mitzvah'];
  });

  const [bookingSettings, setBookingSettings] = useState<BookingSettings>(
    parseBookingSettings(initialProfile.booking_settings) || {}
  );

  // ── Autosave booking_settings (debounced) — identical to the editor ──
  const supabaseRef = useRef(createClient());
  const initialBookingRef = useRef(bookingSettings);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autosaveStatus, setAutosaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // Snapshot of the last-persisted booking_settings. Drives the Booking
  // Settings tab's manual Save button (dirty = current !== snapshot).
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(bookingSettings));

  useEffect(() => {
    if (bookingSettings === initialBookingRef.current) return;
    // Booking Settings tab saves manually via its own button — don't autosave
    // those edits. Every other tab keeps auto-saving.
    if (secTab === 'settings' || secTab === 'rider' || secTab === 'guests') return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      setAutosaveStatus('saving');
      try {
        const { error } = await supabaseRef.current
          .from('users')
          .update({ booking_settings: JSON.stringify(bookingSettings) } as unknown as never)
          .eq('id', initialProfile.id);
        if (error) throw error;
        setSavedSnapshot(JSON.stringify(bookingSettings));
        setAutosaveStatus('saved');
        setTimeout(() => setAutosaveStatus('idle'), 5000);
      } catch {
        setAutosaveStatus('error');
      }
    }, 600);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [bookingSettings, initialProfile.id, isMobile, secTab]);

  // ── Dirty tracking + master save (drives the Save All button) ────────
  // Mobile: packages save manually. Club: rates save manually. Both report
  // dirtiness up so the bottom button enables; the toggle/calendar/equipment
  // autosave on their own.
  const [hasDirtyPackages, setHasDirtyPackages] = useState(false);
  const [hasDirtyClubRates, setHasDirtyClubRates] = useState(false);
  const [clubBookingActivationIncomplete, setClubBookingActivationIncomplete] = useState(false);
  const [masterSaveTrigger, setMasterSaveTrigger] = useState(0);
  function triggerMasterSave() {
    setMasterSaveTrigger((n) => n + 1);
  }

  const settingsDirty = JSON.stringify(bookingSettings) !== savedSnapshot;
  async function saveBookingSettingsNow() {
    setAutosaveStatus('saving');
    try {
      const snap = JSON.stringify(bookingSettings);
      const { error } = await supabaseRef.current
        .from('users')
        .update({ booking_settings: snap } as unknown as never)
        .eq('id', initialProfile.id);
      if (error) throw error;
      setSavedSnapshot(snap);
      setAutosaveStatus('saved');
      setTimeout(() => setAutosaveStatus('idle'), 4000);
    } catch {
      setAutosaveStatus('error');
    }
  }

  const isPageDirty = hasDirtyPackages || hasDirtyClubRates;
  // Warn on leave when there are draft edits OR when club booking is on but
  // no equipment is picked (booking won't be publicly live in that state).
  const needsLeaveWarn = isPageDirty || clubBookingActivationIncomplete || settingsDirty;

  const { setDirty: setGlobalDirty } = useUnsavedChanges();
  useEffect(() => {
    setGlobalDirty(needsLeaveWarn);
    return () => setGlobalDirty(false);
  }, [needsLeaveWarn, setGlobalDirty]);

  const tabs: { id: SecTab; label: string }[] = (isMobile
    ? [
        { id: 'settings', label: 'Booking Settings' },
        { id: 'packages', label: 'Packages' },
        { id: 'discounts', label: 'Discounts' },
        { id: 'payments', label: 'Payments' },
      ]
    : [
        { id: 'settings', label: 'Settings' },
        { id: 'rates', label: 'Equipment & Rates' },
        { id: 'discounts', label: 'Discounts' },
        { id: 'rider', label: 'DJ Rider' },
        { id: 'guests', label: 'Guest List' },
        { id: 'payments', label: 'Payments' },
      ]
  ) as { id: SecTab; label: string }[];
  const mobileTabs = hasBookingAccess
    ? [...tabs, { id: 'contracts' as SecTab, label: 'Contracts' }]
    : tabs;

  return (
    <div className={styles.container} style={{ maxWidth: 1100, width: '100%', marginLeft: 'auto', marginRight: 'auto' }}>
      <div className={styles.headerRow}>
        <Link href="/" className={styles.backLink}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Directory
        </Link>
        {autosaveStatus !== 'idle' && (
          <span
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '.6rem',
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              color: autosaveStatus === 'error' ? '#ff5f5f'
                : autosaveStatus === 'saved' ? 'var(--neon)'
                : 'var(--muted)',
            }}
          >
            {autosaveStatus === 'saving' ? 'Saving…'
              : autosaveStatus === 'saved' ? '✓ Auto-saved'
              : '✗ Save failed'}
          </span>
        )}
      </div>

      <div className={styles.header}>
        <h1>Booking Settings</h1>
        <p>Manage Your Bookings</p>
      </div>

      {!hasBookingAccess && (
        <div
          style={{
            margin: '0 0 1.25rem',
            padding: '1rem 1.25rem',
            borderRadius: 12,
            border: '1px solid rgba(255,176,32,.4)',
            background: 'rgba(255,176,32,.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ color: '#ffb020', fontSize: '.9rem', lineHeight: 1.5 }}>
            <strong>Booking isn&apos;t active on your account.</strong> You can set everything up
            here, but visitors won&apos;t be able to book you until you subscribe.
          </div>
          <Link
            href="/subscribe"
            style={{
              background: 'var(--neon, #00e0a4)',
              color: '#06231b',
              padding: '.6rem 1.1rem',
              borderRadius: 8,
              fontWeight: 700,
              fontSize: '.85rem',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Subscribe to activate →
          </Link>
        </div>
      )}

      {(
        <>
          <nav className={styles.secTabNav} role="tablist">
            {mobileTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={secTab === t.id}
                className={`${styles.secTabBtn} ${secTab === t.id ? styles.secTabBtnActive : ''}`}
                onClick={() => setSecTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <select
            className={styles.secTabSelect}
            value={secTab}
            onChange={(e) => setSecTab(e.target.value as SecTab)}
            aria-label="Booking settings section"
          >
            {mobileTabs.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </>
      )}

      {secTab !== 'contracts' && (
      <div className={styles.card}>
        {djType === 'club' ? (
          <ClubBookingTab
            bookingSettings={bookingSettings}
            onChange={setBookingSettings}
            autosaveStatus={autosaveStatus}
            userId={initialProfile.id}
            onDirtyChange={setHasDirtyClubRates}
            masterSaveTrigger={masterSaveTrigger}
            onActivationIncompleteChange={setClubBookingActivationIncomplete}
            activeSection={secTab as ('rates' | 'settings' | 'discounts' | 'rider' | 'guests' | 'payments')}
            onSaveSettings={saveBookingSettingsNow}
            settingsDirty={settingsDirty}
          />
        ) : (
          <BookingTab
            djType={djType}
            selectedEventTypes={selectedEventTypes}
            customEventTypes={customEventTypes}
            specialtyTypes={specialtyTypes}
            onEventTypesSave={saveEventTypes}
            bookingSettings={bookingSettings}
            onChange={setBookingSettings}
            userId={initialProfile.id}
            onGoToGeneral={() => router.push('/update-dj-profile')}
            autosaveStatus={autosaveStatus}
            onDirtyChange={setHasDirtyPackages}
            externalMasterSaveTrigger={masterSaveTrigger}
            activeSection={isMobile ? secTab as ('settings' | 'packages' | 'discounts' | 'payments') : undefined}
            onSaveSettings={saveBookingSettingsNow}
            settingsDirty={settingsDirty}
          />
        )}

      </div>
      )}

      {hasBookingAccess && secTab === 'contracts' && (
        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>Your Contracts</div>
          </div>
          <div className={styles.settingHint} style={{ margin: '0 0 1rem' }}>
            Build and name the contracts clients sign when they book you — a standard
            agreement or your own. When a booking is approved, the details fill in for
            you to review and send.
          </div>
          <ContractPortal userId={initialProfile.id} djType={djType} />
        </div>
      )}
    </div>
  );
}
