'use client';

// ClubBookingTab — the Booking tab content shown when DJ type is 'club'.
// Mirror of BookingTab.tsx (which is mobile-only) but tailored to the
// club-DJ flow.
//
// Sections (vanilla parity):
//   1. Equipment       — autosaves on change. Three mutually-exclusive
//                        options + free-text detail fields for two of them.
//   2. Rates           — manual save. Global rate type (flat/hourly/offers)
//                        + currency + per-equipment pricing.
//   3. Availability    — autosaves on change. 3-month calendar with the
//                        same look as the embed; click a cell to edit.
//
// Master Save All is rendered by the parent (UpdateDjProfileClient) at
// the bottom of the page; this tab reports its dirty state up via
// onDirtyChange so the master button knows when to enable.

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './updateDjProfile.module.css';
import {
  type BookingSettings,
} from '@/app/(main)/[slug]/bookingSettings';
import EmbedCodeSection from './EmbedCodeSection';
import DiscountsSection from './DiscountsSection';
import { useConfirm } from '@/components/ConfirmModal';
import { createClient } from '@/lib/supabase/client';
import { guessStateTaxRate } from '@/lib/salesTax';

// Currency options matching vanilla's <select> dropdown
const CURRENCIES: { code: string; symbol: string; label: string }[] = [
  { code: 'USD', symbol: '$', label: 'USD ($)' },
  { code: 'EUR', symbol: '€', label: 'EUR (€)' },
  { code: 'GBP', symbol: '£', label: 'GBP (£)' },
  { code: 'CAD', symbol: '$', label: 'CAD ($)' },
  { code: 'AUD', symbol: '$', label: 'AUD ($)' },
  { code: 'JPY', symbol: '¥', label: 'JPY (¥)' },
  { code: 'KRW', symbol: '₩', label: 'KRW (₩)' },
  { code: 'CNY', symbol: '¥', label: 'CNY (¥)' },
  { code: 'INR', symbol: '₹', label: 'INR (₹)' },
  { code: 'BRL', symbol: 'R$', label: 'BRL (R$)' },
  { code: 'MXN', symbol: '$', label: 'MXN ($)' },
];

interface Props {
  bookingSettings: BookingSettings;
  onChange: (next: BookingSettings) => void;
  autosaveStatus: 'idle' | 'saving' | 'saved' | 'error';
  // DJ's URL slug — needed for the EmbedCodeSection so the iframe URL
  // points at this profile. Read live from general.slug in the parent
  // so the embed snippet updates as the user edits the slug.
  djSlug: string;
  // Aggregate dirty signal — true whenever the manual-save Rates section
  // has unsaved drafts. Bubbles up to UpdateDjProfileClient which combines
  // it with general-fields-dirty + mobile-package-drafts-dirty for the
  // page-leave warning.
  onDirtyChange?: (dirty: boolean) => void;
  // Trigger from the master Save All button — bumps when user clicks it.
  // The Rates section listens via useEffect and saves itself if dirty.
  masterSaveTrigger: number;
  // Reports the "booking is toggled on but no equipment selected" state
  // up to the parent so it can include it in the leave-page warning.
  // When this is true, the toggle is on but booking won't actually go
  // live publicly until the DJ picks an equipment option.
  onActivationIncompleteChange?: (incomplete: boolean) => void;
}

export default function ClubBookingTab({
  bookingSettings, onChange, autosaveStatus, djSlug, onDirtyChange, masterSaveTrigger,
  onActivationIncompleteChange,
}: Props) {
  // Patch helper — preserves other fields in booking_settings
  function patch(p: Partial<BookingSettings>) {
    onChange({ ...bookingSettings, ...p });
  }

  // ── Per-section last-changed tracking (for inline saved hints) ──
  const [lastChangedField, setLastChangedField] = useState<string | null>(null);
  const [showBpdTip, setShowBpdTip] = useState(false);

  // Confirm modal — used to require explicit acknowledgement before
  // disabling booking. The Confirm hook returns the confirm() async fn
  // plus a JSX element to render once at the top of the component tree.
  const { confirmDialog } = useConfirm();

  // ── Booking config (subscription-gated; no manual toggle) ────────
  // Always render the config; whether booking goes live publicly is decided
  // by the DJ's subscription + equipment completeness on the profile side.
  const enabled = true;

  // ── Equipment section (autosave) ──────────────────────────────────
  const equipFull = !!bookingSettings.equip_full;
  const equipFullDetail = bookingSettings.equip_full_detail || '';
  const equipDecks = !!bookingSettings.equip_decks;
  const equipDecksDetail = bookingSettings.equip_decks_detail || '';
  const equipNone = !!bookingSettings.equip_none;
  const hasEquipSelected = equipFull || equipDecks || equipNone;

  // Mutually-exclusive selection — pick one, clear the others.
  function selectEquip(which: 'full' | 'decks' | 'none') {
    setLastChangedField('equipment');
    patch({
      equip_full: which === 'full',
      equip_decks: which === 'decks',
      equip_none: which === 'none',
      // Clear stale detail when switching away
      equip_full_detail: which === 'full' ? equipFullDetail : '',
      equip_decks_detail: which === 'decks' ? equipDecksDetail : '',
    });
  }
  function setEquipFullDetail(v: string) {
    setLastChangedField('equipment');
    patch({ equip_full_detail: v });
  }
  function setEquipDecksDetail(v: string) {
    setLastChangedField('equipment');
    patch({ equip_decks_detail: v });
  }

  // ── Rates section (MANUAL save) ────────────────────────────────────
  // Local draft state keyed off the saved values. Edits update drafts
  // only; nothing flows back to bookingSettings until Save is clicked.
  // Dirty = drafts !== saved.
  type RatesDraft = {
    global_rate_type: 'flat' | 'hourly' | 'offers';
    rate_currency: string;
    base_rate: string;
    // Flat-mode rates
    rate_with_system: string;
    rate_with_decks: string;
    rate_no_equip: string;
    // Hourly-mode rates — stored independently so switching rate types
    // doesn't overwrite either set. Each acts dormant when its type
    // isn't active.
    rate_hourly_with_system: string;
    rate_hourly_with_decks: string;
    rate_hourly_no_equip: string;
  };

  function snapshotRates(bs: BookingSettings): RatesDraft {
    const t = bs.global_rate_type;
    const rateType: 'flat' | 'hourly' | 'offers' =
      t === 'hourly' ? 'hourly' : t === 'offers' ? 'offers' : 'flat';
    return {
      global_rate_type: rateType,
      rate_currency: bs.rate_currency || 'USD',
      base_rate: bs.base_rate != null ? String(bs.base_rate) : '',
      rate_with_system: bs.rate_with_system != null ? String(bs.rate_with_system) : '',
      rate_with_decks: bs.rate_with_decks != null ? String(bs.rate_with_decks) : '',
      rate_no_equip: bs.rate_no_equip != null ? String(bs.rate_no_equip) : '',
      rate_hourly_with_system: bs.rate_hourly_with_system != null ? String(bs.rate_hourly_with_system) : '',
      rate_hourly_with_decks: bs.rate_hourly_with_decks != null ? String(bs.rate_hourly_with_decks) : '',
      rate_hourly_no_equip: bs.rate_hourly_no_equip != null ? String(bs.rate_hourly_no_equip) : '',
    };
  }

  const [ratesDraft, setRatesDraft] = useState<RatesDraft>(() => snapshotRates(bookingSettings));
  const [ratesSaveStatus, setRatesSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  const ratesDirty = useMemo(() => {
    const saved = snapshotRates(bookingSettings);
    return JSON.stringify(saved) !== JSON.stringify(ratesDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ratesDraft,
    // Spell out the saved dependencies so this recalcs when the parent
    // updates booking_settings (e.g. after a save commit)
    bookingSettings.global_rate_type,
    bookingSettings.rate_currency,
    bookingSettings.base_rate,
    bookingSettings.rate_with_system,
    bookingSettings.rate_with_decks,
    bookingSettings.rate_no_equip,
    bookingSettings.rate_hourly_with_system,
    bookingSettings.rate_hourly_with_decks,
    bookingSettings.rate_hourly_no_equip,
    bookingSettings.club_bookings_per_day,
  ]);

  // Bubble dirty state up to parent (powers the page-leave warning AND
  // the master Save All button's enable state).
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  useEffect(() => {
    onDirtyChangeRef.current?.(ratesDirty);
  }, [ratesDirty]);

  // Bubble activation-incomplete state up. True when the booking toggle
  // is on but no equipment option has been picked — booking won't actually
  // be live on the public profile until equipment is set.
  const activationIncomplete = enabled && !hasEquipSelected;
  const onActivationIncompleteRef = useRef(onActivationIncompleteChange);
  onActivationIncompleteRef.current = onActivationIncompleteChange;
  useEffect(() => {
    onActivationIncompleteRef.current?.(activationIncomplete);
  }, [activationIncomplete]);

  function commitRates() {
    setLastChangedField('rates');
    patch({
      global_rate_type: ratesDraft.global_rate_type,
      allow_offers: ratesDraft.global_rate_type === 'offers',
      rate_currency: ratesDraft.rate_currency,
      base_rate: ratesDraft.base_rate,
      rate_with_system: ratesDraft.rate_with_system,
      rate_with_decks: ratesDraft.rate_with_decks,
      rate_no_equip: ratesDraft.rate_no_equip,
      rate_hourly_with_system: ratesDraft.rate_hourly_with_system,
      rate_hourly_with_decks: ratesDraft.rate_hourly_with_decks,
      rate_hourly_no_equip: ratesDraft.rate_hourly_no_equip,
    });
    setRatesSaveStatus('saved');
    setTimeout(() => {
      setRatesSaveStatus((cur) => (cur === 'saved' ? 'idle' : cur));
    }, 5000);
  }

  // Master save trigger — when bumped, attempt a rates save if dirty.
  // We don't need to save anything else here (equipment + calendar
  // already autosave; clicking Save All is just a no-op for them, which
  // is fine).
  const lastTriggerRef = useRef(masterSaveTrigger);
  useEffect(() => {
    if (masterSaveTrigger === 0) return;
    if (masterSaveTrigger === lastTriggerRef.current) return;
    lastTriggerRef.current = masterSaveTrigger;
    if (ratesDirty) commitRates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterSaveTrigger]);

  function setRateField(field: keyof RatesDraft, value: string | number) {
    setRatesDraft((prev) => ({ ...prev, [field]: value }));
    if (ratesSaveStatus !== 'idle') setRatesSaveStatus('idle');
  }

  // ── Booking window (autosave) ─────────────────────────────────────
  const bookingWindow = bookingSettings.booking_window_months || 12;
  function setBookingWindow(v: number) {
    setLastChangedField('settings');
    patch({ booking_window_months: v });
  }

  // ── Deposit (autosave) ────────────────────────────────────────────
  // Club DJ deposit policy: a % of the total added to the contract as a
  // deposit due on signing. Default 0 = no deposit. Stored in the same
  // booking_settings JSON blob (club_deposit_pct); read via a cast since
  // the shared type doesn't declare it yet.
  const clubDepositPct = (bookingSettings as { club_deposit_pct?: number }).club_deposit_pct || 0;
  function setClubDeposit(v: number) {
    setLastChangedField('settings');
    patch({ club_deposit_pct: v } as unknown as Partial<BookingSettings>);
  }

  // Optional sales tax — OFF by default. When on, we suggest a rate from the
  // DJ's state (adjustable). The DJ is responsible for charging + remitting;
  // the platform doesn't collect or remit. Stored as tax_enabled + tax_pct.
  const taxEnabled = !!(bookingSettings as { tax_enabled?: boolean }).tax_enabled;
  const clubTaxPct = (bookingSettings as { tax_pct?: number }).tax_pct || 0;
  // The DJ's state (from their profile) — used to suggest a base rate. Read via
  // the authenticated user so this tab doesn't need a userId/state prop.
  const [djState, setDjState] = useState<string>('');
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase.from('users').select('state').eq('id', user.id).maybeSingle();
        if (active) setDjState(((data as { state?: string | null } | null)?.state) || '');
      } catch { /* ignore — no suggestion */ }
    })();
    return () => { active = false; };
  }, []);
  const suggestedTax = guessStateTaxRate(djState);
  function setTaxEnabled(on: boolean) {
    setLastChangedField('settings');
    if (on) {
      const next = clubTaxPct > 0 ? clubTaxPct : (suggestedTax != null ? suggestedTax : 0);
      patch({ tax_enabled: true, tax_pct: next } as unknown as Partial<BookingSettings>);
    } else {
      patch({ tax_enabled: false } as unknown as Partial<BookingSettings>);
    }
  }
  function setClubTax(v: number) {
    setLastChangedField('settings');
    patch({ tax_pct: v } as unknown as Partial<BookingSettings>);
  }

  // Currency symbol helper (used for the rate field prefix)
  const currentCurrency = useMemo(() => {
    return CURRENCIES.find((c) => c.code === ratesDraft.rate_currency) || CURRENCIES[0];
  }, [ratesDraft.rate_currency]);

  return (
    <div>
      {confirmDialog}

      {enabled && (
        <>
          {/* Activation-incomplete banner — shown whenever no equipment
              option is selected. Booking won't go live publicly until the
              DJ picks one. */}
          {activationIncomplete && (
            <div
              style={{
                margin: '0 0 1rem 0',
                padding: '.75rem 1rem',
                background: 'rgba(255, 176, 32, 0.08)',
                border: '1px solid rgba(255, 176, 32, 0.35)',
                borderRadius: '8px',
                color: 'var(--amber)',
                fontSize: '.82rem',
                lineHeight: 1.5,
              }}
            >
              <strong>⚠ Pick an equipment option below to make booking live on your profile.</strong>
              <span style={{ display: 'block', marginTop: '.25rem', color: 'rgba(255,255,255,.7)', fontSize: '.78rem' }}>
                Booking is enabled, but visitors won't see a Book button until you choose how you handle equipment.
              </span>
            </div>
          )}

          {/* ── Equipment section ─────────────────────────────────────── */}
      <div className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Equipment</div>
        </div>
        <div className={styles.sectionBody}>
          <p className={styles.bodyHint}>
            What equipment do you bring to gigs? Pick one — your rates
            below are tied to this selection.
          </p>

          <div className={styles.equipOptions}>
            <label className={styles.equipOption}>
              <input
                type="radio"
                name="club-equip"
                checked={equipFull}
                onChange={() => selectEquip('full')}
              />
              <div className={styles.equipOptionBody}>
                <div className={styles.equipOptionTitle}>
                  I provide Sound System &amp; Decks/Controller
                </div>
                {equipFull && (
                  <input
                    type="text"
                    value={equipFullDetail}
                    onChange={(e) => setEquipFullDetail(e.target.value)}
                    placeholder="List your system (e.g. QSC K12.2, Pioneer CDJ-3000)"
                    className={styles.equipDetailInput}
                  />
                )}
              </div>
            </label>

            <label className={styles.equipOption}>
              <input
                type="radio"
                name="club-equip"
                checked={equipDecks}
                onChange={() => selectEquip('decks')}
              />
              <div className={styles.equipOptionBody}>
                <div className={styles.equipOptionTitle}>
                  I provide Decks/Controller only
                </div>
                {equipDecks && (
                  <input
                    type="text"
                    value={equipDecksDetail}
                    onChange={(e) => setEquipDecksDetail(e.target.value)}
                    placeholder="List your decks (e.g. Pioneer DDJ-1000)"
                    className={styles.equipDetailInput}
                  />
                )}
              </div>
            </label>

            <label className={styles.equipOption}>
              <input
                type="radio"
                name="club-equip"
                checked={equipNone}
                onChange={() => selectEquip('none')}
              />
              <div className={styles.equipOptionBody}>
                <div className={styles.equipOptionTitle}>
                  I require all equipment provided by venue
                </div>
              </div>
            </label>
          </div>

          <SectionHint
            fieldKey="equipment"
            lastChangedField={lastChangedField}
            autosaveStatus={autosaveStatus}
          />
        </div>
      </div>

      {/* ── Rates section (MANUAL save) ───────────────────────────── */}
      <div className={styles.sectionCard}>
        {/* Header uses default centered title (same as Equipment) with the
            currency picker positioned absolutely on the right so it doesn't
            pull the title off-center. */}
        <div className={styles.sectionHeader} style={{ position: 'relative' }}>
          <div className={styles.sectionTitle}>Rates</div>
          {/* Currency picker — top-right of section header. Hidden for
              the Offers rate type since offers don't have a fixed price.
              Hidden until equipment is selected (rates are gated on it). */}
          {hasEquipSelected && ratesDraft.global_rate_type !== 'offers' && (
            <div style={{ position: 'absolute', right: '1rem', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: '.45rem' }}>
              <label
                style={{
                  fontFamily: "'Space Mono', monospace",
                  fontSize: '.6rem',
                  letterSpacing: '.07em',
                  textTransform: 'uppercase',
                  color: 'var(--muted)',
                }}
              >
                Currency
              </label>
              <select
                value={ratesDraft.rate_currency}
                onChange={(e) => setRateField('rate_currency', e.target.value)}
                className={styles.rateSelect}
                style={{ width: 'auto', minWidth: 110 }}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className={styles.sectionBody}>
          {!hasEquipSelected ? (
            <p className={styles.bodyHint}>
              Pick your equipment selection above before setting rates.
            </p>
          ) : (
            <>
              <p className={styles.bodyHint}>
                These are your default rates. You can override on a
                per-day basis from the calendar.
              </p>

              {/* Rate type pill toggle */}
              <div className={styles.rateTypeRow}>
                <div className={styles.rateTypeLabel}>Rate Type</div>
                <div className={styles.rateTypePillGroup}>
                  {(['flat', 'hourly', 'offers'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setRateField('global_rate_type', t)}
                      className={`${styles.rateTypePill} ${
                        ratesDraft.global_rate_type === t ? styles.rateTypePillActive : ''
                      }`}
                    >
                      {t === 'flat' ? 'Flat Rate' : t === 'hourly' ? 'Hourly' : 'Offers'}
                    </button>
                  ))}
                </div>
              </div>

              {ratesDraft.global_rate_type === 'offers' && (
                <p className={styles.rateOffersHint}>
                  Offers can be countered and negotiated through the platform.
                </p>
              )}

              {/* Per-equipment rate fields. Higher equipment tier = more
                  rate options because the DJ COULD show up with less.
                    - equip_full  → can charge full system / decks-only / no-equip
                    - equip_decks → can charge decks-only / no-equip
                    - equip_none  → only the no-equip rate (DJ has nothing)
                  Each rate type (flat / hourly) has its own set of fields
                  in the draft. The active field name + draft value is
                  resolved here so the inputs stay simple. Switching rate
                  type swaps which set of fields is shown — the dormant
                  set stays in storage and reappears when you switch back. */}
              {(() => { return null; })()}
              {ratesDraft.global_rate_type !== 'offers' && (() => {
                const isHourly = ratesDraft.global_rate_type === 'hourly';
                const fSys = isHourly ? 'rate_hourly_with_system' : 'rate_with_system';
                const fDecks = isHourly ? 'rate_hourly_with_decks' : 'rate_with_decks';
                const fNone = isHourly ? 'rate_hourly_no_equip' : 'rate_no_equip';
                const vSys = ratesDraft[fSys as keyof RatesDraft] as string;
                const vDecks = ratesDraft[fDecks as keyof RatesDraft] as string;
                const vNone = ratesDraft[fNone as keyof RatesDraft] as string;
                const hourlySuffix = isHourly ? ' (per hour)' : '';
                return (
                  <>
                    {equipFull && (
                      <>
                        <RateInput
                          label={`Rate with Sound System & Decks/Controller${hourlySuffix}`}
                          symbol={currentCurrency.symbol}
                          value={vSys}
                          onChange={(v) => setRateField(fSys as keyof RatesDraft, v)}
                        />
                        <RateInput
                          label={`Rate with Decks/Controller only${hourlySuffix}`}
                          symbol={currentCurrency.symbol}
                          value={vDecks}
                          onChange={(v) => setRateField(fDecks as keyof RatesDraft, v)}
                        />
                        <RateInput
                          label={`Rate with venue providing all equipment${hourlySuffix}`}
                          symbol={currentCurrency.symbol}
                          value={vNone}
                          onChange={(v) => setRateField(fNone as keyof RatesDraft, v)}
                        />
                      </>
                    )}
                    {equipDecks && (
                      <>
                        <RateInput
                          label={`Rate with Decks/Controller only${hourlySuffix}`}
                          symbol={currentCurrency.symbol}
                          value={vDecks}
                          onChange={(v) => setRateField(fDecks as keyof RatesDraft, v)}
                        />
                        <RateInput
                          label={`Rate with venue providing all equipment${hourlySuffix}`}
                          symbol={currentCurrency.symbol}
                          value={vNone}
                          onChange={(v) => setRateField(fNone as keyof RatesDraft, v)}
                        />
                      </>
                    )}
                    {equipNone && (
                      <RateInput
                        label={`Rate with venue providing all equipment${hourlySuffix}`}
                        symbol={currentCurrency.symbol}
                        value={vNone}
                        onChange={(v) => setRateField(fNone as keyof RatesDraft, v)}
                      />
                    )}
                  </>
                );
              })()}

              {/* Save row — manual save button + status. Disabled when
                  nothing's dirty so the user knows they're up to date. */}
              <div className={styles.rateSaveRow}>
                <div className={styles.rateSaveStatus}>
                  {ratesSaveStatus === 'saved' ? (
                    <span style={{ color: 'var(--neon)' }}>✓ Saved</span>
                  ) : ratesDirty ? (
                    <span style={{ color: 'var(--amber)' }}>● Unsaved changes</span>
                  ) : (
                    <span style={{ color: 'var(--muted)' }}>✓ All saved</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={commitRates}
                  disabled={!ratesDirty}
                  className={`${styles.rateSaveBtn} ${ratesDirty ? styles.rateSaveBtnEnabled : ''}`}
                >
                  Save Rates
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Settings (autosave) ─────────────────────────────── */}
      <div className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Settings</div>
        </div>
        <div className={styles.sectionBody}>
          <div className={styles.settingRow} style={{ paddingBottom: '1.25rem', borderBottom: '1px solid var(--border, rgba(255,255,255,.08))', marginBottom: '1.25rem' }}>
            <div className={styles.settingLabelWrap}>
              <div className={styles.settingLabel} style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
                Bookings Per Day
                <button
                  type="button"
                  onClick={() => setShowBpdTip((v) => !v)}
                  aria-label="What is this?"
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 18, height: 18, borderRadius: '50%', padding: 0,
                    border: '1px solid var(--muted, #8a8aa0)', background: 'transparent',
                    color: 'var(--muted, #8a8aa0)', fontSize: '.7rem', cursor: 'pointer', lineHeight: 1,
                  }}
                >
                  ?
                </button>
                {showBpdTip && (
                  <div
                    style={{
                      position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 20,
                      width: 260, background: '#1a1a2e', color: '#fff',
                      border: '1px solid var(--border, rgba(255,255,255,.2))', borderRadius: 8,
                      padding: '.6rem .75rem', fontSize: '.78rem', lineHeight: 1.5,
                      textTransform: 'none', letterSpacing: 'normal', fontWeight: 400,
                      boxShadow: '0 4px 16px rgba(0,0,0,.4)',
                    }}
                  >
                    Max number of jobs you can DJ in one day before the day is marked completely booked.
                  </div>
                )}
              </div>
              <div className={styles.settingHint}>
                How many bookings you&rsquo;ll accept on a single day.
              </div>
            </div>
            <select
              value={bookingSettings.club_bookings_per_day != null ? bookingSettings.club_bookings_per_day : 1}
              onChange={(e) => { setLastChangedField('settings'); patch({ club_bookings_per_day: Number(e.target.value) }); }}
              className={styles.settingSelect}
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </div>

          <div className={styles.settingRow} style={{ paddingBottom: '1.25rem', borderBottom: '1px solid var(--border, rgba(255,255,255,.08))', marginBottom: '1.25rem' }}>
            <div className={styles.settingLabelWrap}>
              <div className={styles.settingLabel}>Book In Advance</div>
              <div className={styles.settingHint}>
                How far ahead can someone book you?
              </div>
            </div>
            <select
              value={bookingWindow}
              onChange={(e) => setBookingWindow(parseInt(e.target.value, 10))}
              className={styles.settingSelect}
            >
              {[3, 6, 9, 12, 18, 24, 36].map((m) => (
                <option key={m} value={m}>{m} months</option>
              ))}
            </select>
          </div>

          <div className={styles.settingRow}>
            <div className={styles.settingLabelWrap}>
              <div className={styles.settingLabel}>Require deposit?</div>
              <div className={styles.settingHint}>
                Percentage of the total added to the contract as a deposit due on signing.
              </div>
            </div>
            <select
              value={clubDepositPct}
              onChange={(e) => setClubDeposit(parseInt(e.target.value, 10) || 0)}
              className={styles.settingSelect}
            >
              <option value={0}>No Deposit</option>
              {[5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95].map((p) => (
                <option key={p} value={p}>{p}%</option>
              ))}
            </select>
          </div>

          <div className={styles.settingRow}>
            <div className={styles.settingLabelWrap}>
              <div className={styles.settingLabel}>Charge sales tax?</div>
              <div className={styles.settingHint}>
                Off by default. You&rsquo;re responsible for charging and remitting it where it applies; Global DJ Connect doesn&rsquo;t collect or remit tax.
              </div>
            </div>
            <select
              value={taxEnabled ? 'yes' : 'no'}
              onChange={(e) => setTaxEnabled(e.target.value === 'yes')}
              className={styles.settingSelect}
            >
              <option value="no">Off</option>
              <option value="yes">On</option>
            </select>
          </div>

          {taxEnabled && (
            <div className={styles.settingRow}>
              <div className={styles.settingLabelWrap}>
                <div className={styles.settingLabel}>Tax rate (%)</div>
                <div className={styles.settingHint}>
                  {suggestedTax != null
                    ? `Suggested from your state (${djState}): ${suggestedTax}% base rate — adjust for your local rate.`
                    : 'Enter your local rate.'}
                </div>
              </div>
              <input
                type="number"
                min={0}
                max={100}
                step="0.001"
                value={clubTaxPct || ''}
                onChange={(e) => setClubTax(parseFloat(e.target.value) || 0)}
                className={styles.settingNumber}
                placeholder="0"
              />
            </div>
          )}

          <SectionHint
            fieldKey="settings"
            lastChangedField={lastChangedField}
            autosaveStatus={autosaveStatus}
          />
        </div>
      </div>

      {/* ── Discounts & Promo Codes ─────────────────────────── */}
      <DiscountsSection
        promoCodes={bookingSettings.promo_codes || []}
        sale={bookingSettings.sale || {}}
        onChange={(p) => patch(p)}
      />

      {/* ── Embed Code ──────────────────────────────────────── */}
      <EmbedCodeSection slug={djSlug} />
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SectionHint — same inline indicator pattern used elsewhere on this tab.
// ─────────────────────────────────────────────────────────────────────────
function SectionHint({
  fieldKey, lastChangedField, autosaveStatus,
}: {
  fieldKey: string;
  lastChangedField: string | null;
  autosaveStatus: 'idle' | 'saving' | 'saved' | 'error';
}) {
  if (lastChangedField !== fieldKey) return null;
  if (autosaveStatus === 'idle') return null;

  const text = autosaveStatus === 'saving' ? 'Saving…'
    : autosaveStatus === 'saved' ? '✓ Saved'
    : '✗ Failed';
  const color = autosaveStatus === 'saving' ? 'var(--muted)'
    : autosaveStatus === 'saved' ? 'var(--neon)'
    : '#ff5f5f';

  return (
    <div style={{
      minHeight: 18,
      display: 'flex',
      justifyContent: 'flex-end',
      alignItems: 'center',
      paddingTop: '.6rem',
      marginTop: '.4rem',
      borderTop: '1px solid var(--border)',
    }}>
      <span style={{
        fontFamily: "'Space Mono', monospace",
        fontSize: '.6rem',
        letterSpacing: '.05em',
        color,
        whiteSpace: 'nowrap',
      }}>{text}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// RateInput — labelled currency-symbol-prefixed numeric input for a rate.
// ─────────────────────────────────────────────────────────────────────────
function RateInput({
  label, symbol, value, onChange,
}: {
  label: string;
  symbol: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className={styles.rateFieldGroup}>
      <label className={styles.rateFieldLabel}>{label}</label>
      <div className={styles.rateInputWrap}>
        <span className={styles.rateSymbol}>{symbol}</span>
        <input
          type="number"
          min={0}
          step="0.01"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          className={styles.rateInput}
        />
      </div>
    </div>
  );
}
