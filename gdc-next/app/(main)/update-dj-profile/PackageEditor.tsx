'use client';

// PackageEditor — renders one package card. Includes the rich-text
// editor (bold/italic/underline/lists/check-list), pricing inputs
// (4hr/5hr/6hr + overtime), reqAll toggle, setup hours, photo upload,
// and the wedding-only cocktail block.
//
// Faithful port of udjp-booking-mobile.js buildPkgCard / buildCatPane /
// buildPricingSection (lines 382-611).
//
// Photo upload uses the Supabase storage REST API directly with the
// user's access token (matches vanilla approach in handlePkgPhotoUpload).

import { useEffect, useRef, useState } from 'react';
import styles from './updateDjProfile.module.css';
import { createClient } from '@/lib/supabase/client';
import { useConfirm } from '@/components/ConfirmModal';
import type { MobilePackage } from '@/app/(main)/[slug]/bookingSettings';

const PKG_SETUP_HOURS = ['1', '2', '3', '4', '5'];

interface Props {
  cat: 'general' | 'wedding' | 'mitzvah';
  idx: number;
  pkg: MobilePackage;
  totalCount: number;             // total packages in this category (for index display + remove gating)
  userId: string;
  onChange: (next: MobilePackage) => void;
  onRemove: () => void;
  // When true, PackageEditor renders the inner fields only — no card
  // wrapper, no "Package N" header, no remove button. The parent component
  // is expected to provide those instead. Used by the inner-tabs case in
  // BookingTab when multiple package categories are active.
  hideOwnHeader?: boolean;
}

export function newMobPackage(): MobilePackage & {
  setupHours?: string;
  cocktailIncluded?: boolean;
  cocktailPrice?: string | number;
} {
  return {
    title: '',
    details: '',
    price4: '',
    price5: '',
    price6: '',
    overtime: '',
    reqAll: false,
    photo: '',
    // Extra fields beyond the public MobilePackage type — used here
    // and persisted to booking_settings.mob_packages.
    ...({
      setupHours: '',
      cocktailIncluded: true,
      cocktailPrice: '',
    } as object),
  };
}

export default function PackageEditor({
  cat, idx, pkg, totalCount, userId, onChange, onRemove, hideOwnHeader,
}: Props) {
  const isWedding = cat === 'wedding';
  const reqAll = !!pkg.reqAll;
  const { confirm, confirmDialog } = useConfirm();

  // Rich-text editor — kept uncontrolled (set initial via dangerouslySetInnerHTML
  // then onInput fires onChange with current innerHTML). React doesn't play well
  // with contenteditable as a controlled input — vanilla parity here is also
  // uncontrolled.
  const editorRef = useRef<HTMLDivElement>(null);
  // Track last value we set — when parent passes new pkg.details (e.g. reset),
  // we update the editor without re-rendering on every keystroke.
  const lastSetDetailsRef = useRef<string>('');
  useEffect(() => {
    if (editorRef.current && pkg.details !== lastSetDetailsRef.current) {
      // Only set on initial mount or external reset, not on user input
      if (lastSetDetailsRef.current === '') {
        editorRef.current.innerHTML = pkg.details || '';
        lastSetDetailsRef.current = pkg.details || '';
      }
    }
  }, [pkg.details]);

  function updateField<K extends keyof MobilePackage>(field: K, val: MobilePackage[K]) {
    onChange({ ...pkg, [field]: val });
  }

  // Generic field updater for the extended fields not in MobilePackage
  function updateExtra(field: string, val: unknown) {
    onChange({ ...pkg, [field]: val } as MobilePackage);
  }

  // Rich-text commands — these use the deprecated execCommand API. Vanilla
  // also uses execCommand; modern browsers still support it for now.
  function execCmd(cmd: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, undefined);
    // Sync state after the command modifies DOM
    if (editorRef.current) {
      const html = editorRef.current.innerHTML;
      lastSetDetailsRef.current = html;
      updateField('details', html);
    }
  }

  function execCheckList() {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const getContainingUL = (): HTMLUListElement | null => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      let node: Node | null = sel.anchorNode;
      if (!node) return null;
      if (node.nodeType === 3) node = (node as Text).parentElement;
      while (node && node !== el) {
        if ((node as HTMLElement).tagName === 'UL') return node as HTMLUListElement;
        node = (node as HTMLElement).parentElement;
      }
      return null;
    };
    const existingUL = getContainingUL();
    if (existingUL) {
      existingUL.classList.toggle('gdj-check-list');
    } else {
      document.execCommand('insertUnorderedList', false, undefined);
      const newUL = getContainingUL();
      if (newUL) newUL.classList.add('gdj-check-list');
    }
    const html = el.innerHTML;
    lastSetDetailsRef.current = html;
    updateField('details', html);
  }

  // ── Photo upload ────────────────────────────────────────────────
  const [uploadStatus, setUploadStatus] = useState<{ kind: 'idle' | 'uploading' | 'done' | 'error'; msg?: string }>({ kind: 'idle' });

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadStatus({ kind: 'uploading', msg: 'Uploading...' });
    try {
      const supabase = createClient();
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${userId}/packages/pkg_${cat}_${idx}_${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: pubData } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = `${pubData.publicUrl}?t=${Date.now()}`;
      updateField('photo', publicUrl);
      setUploadStatus({ kind: 'done', msg: '✓ Uploaded' });
      setTimeout(() => setUploadStatus({ kind: 'idle' }), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setUploadStatus({ kind: 'error', msg: '✗ ' + msg });
    }
  }

  async function removePhoto() {
    const ok = await confirm({
      title: 'Delete this package photo?',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    updateField('photo', '');
  }

  // Inner content (everything except the card wrapper + header)
  const inner = (
    <>
      {confirmDialog}
      {/* Title */}
      <div className={styles.pkgFieldGroup}>
        <label className={styles.pkgFieldLabel}>
          Package Title <span className={styles.pkgFieldRequired}>*</span>
        </label>
        <input
          type="text"
          placeholder="e.g. Essentials, Gold, Premium"
          value={pkg.title || ''}
          onChange={(e) => updateField('title', e.target.value)}
          className={styles.pkgInput}
        />
      </div>

      {/* Details (rich text) */}
      <div className={styles.pkgFieldGroup}>
        <label className={styles.pkgFieldLabel}>
          Package Details <span className={styles.pkgFieldRequired}>*</span>
        </label>
        <div className={styles.rteToolbar}>
          <button type="button" onClick={() => execCmd('bold')} className={`${styles.rteBtn} ${styles.rteBtnBold}`}>B</button>
          <button type="button" onClick={() => execCmd('italic')} className={`${styles.rteBtn} ${styles.rteBtnItalic}`}>I</button>
          <button type="button" onClick={() => execCmd('underline')} className={`${styles.rteBtn} ${styles.rteBtnUnder}`}>U</button>
          <span className={styles.rteSeparator} />
          <button type="button" onClick={() => execCmd('insertUnorderedList')} className={styles.rteBtn}>• List</button>
          <button type="button" onClick={execCheckList} className={`${styles.rteBtn} ${styles.rteBtnCheck}`}>✓ List</button>
          <button type="button" onClick={() => execCmd('insertOrderedList')} className={styles.rteBtn}>1. List</button>
        </div>
        <div
          ref={editorRef}
          contentEditable
          className={styles.rteEditor}
          onInput={(e) => {
            const html = (e.currentTarget as HTMLDivElement).innerHTML;
            lastSetDetailsRef.current = html;
            updateField('details', html);
          }}
          suppressContentEditableWarning
        />
      </div>

      {/* Pricing */}
      <div className={styles.pkgFieldGroup}>
        <label className={styles.pkgFieldLabel}>
          Pricing <span className={styles.pkgFieldRequired}>*</span>
        </label>
        {(['4', '5', '6'] as const).map((hrs) => {
          const fld = `price${hrs}` as 'price4' | 'price5' | 'price6';
          return (
            <div key={hrs} className={styles.priceRow}>
              <span className={styles.priceRowLabel}>
                {hrs} Hour Event{isWedding ? ' (Reception)' : ''}:
              </span>
              <span className={`${styles.priceCurrency} ${reqAll ? styles.priceCurrencyDisabled : ''}`}>$</span>
              <input
                type="number"
                min={0}
                placeholder="0"
                value={String(pkg[fld] ?? '')}
                disabled={reqAll}
                onChange={(e) => updateField(fld, e.target.value)}
                className={styles.priceInput}
              />
            </div>
          );
        })}

        {/* Overtime */}
        <div className={styles.priceRow}>
          <span className={styles.priceRowLabel} style={reqAll ? { opacity: 0.35 } : undefined}>
            Hourly Overtime: <span className={styles.pkgFieldRequired}>*</span>
          </span>
          <span className={`${styles.priceCurrency} ${reqAll ? styles.priceCurrencyDisabled : ''}`}>$</span>
          <input
            type="number"
            min={0}
            placeholder="0"
            value={String(pkg.overtime ?? '')}
            disabled={reqAll}
            onChange={(e) => updateField('overtime', e.target.value)}
            className={styles.priceInput}
          />
          <span className={styles.perHourLabel} style={reqAll ? { opacity: 0.35 } : undefined}>
            Per Hour
          </span>
        </div>

        {/* Cocktail block — all package categories, hidden when reqAll */}
        {!reqAll && (
          <div className={styles.cocktailBlock}>
            <label className={styles.cocktailRow}>
              <input
                type="checkbox"
                checked={(pkg as { cocktailIncluded?: boolean }).cocktailIncluded !== false}
                onChange={(e) => updateExtra('cocktailIncluded', e.target.checked)}
              />
              <span className={styles.cocktailPrompt}>
                Cocktail hour music included in event price?
              </span>
            </label>
            {(pkg as { cocktailIncluded?: boolean }).cocktailIncluded === false && (
              <div className={styles.cocktailPriceWrap}>
                <span className={styles.priceRowLabel}>Cocktail Hour Price (per hour):</span>
                <span className={styles.priceCurrency}>$</span>
                <input
                  type="number"
                  min={0}
                  placeholder="0"
                  value={String((pkg as { cocktailPrice?: string | number }).cocktailPrice ?? '')}
                  onChange={(e) => updateExtra('cocktailPrice', e.target.value)}
                  className={styles.priceInput}
                />
              </div>
            )}
          </div>
        )}

        {/* Req-all toggle */}
        <label className={styles.reqAllRow}>
          <input
            type="checkbox"
            checked={reqAll}
            onChange={(e) => updateField('reqAll', e.target.checked)}
          />
          <span className={styles.reqAllLabel}>
            REQUIRE EVENT HOST TO <span className={styles.reqAllHighlight}>REQUEST PRICE</span> (This will deactivate price fields above)
          </span>
        </label>
      </div>

      {/* Setup hours */}
      <div className={styles.setupRow}>
        <label className={styles.pkgFieldLabel} style={{ margin: 0 }}>
          The number of hours required to set up prior to event start time:
        </label>
        <select
          value={(pkg as { setupHours?: string }).setupHours || ''}
          onChange={(e) => updateExtra('setupHours', e.target.value)}
          className={styles.setupSelect}
        >
          <option value="">—</option>
          {PKG_SETUP_HOURS.map((h) => (
            <option key={h} value={h}>{h} hr{h === '1' ? '' : 's'}</option>
          ))}
        </select>
      </div>

      {/* Photo */}
      <div className={styles.pkgFieldGroup}>
        <label className={styles.pkgFieldLabel}>Package Setup Photo</label>
        {pkg.photo ? (
          <div className={styles.photoPreviewRow}>
            <div className={styles.photoPreviewWrap}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pkg.photo} alt="Package photo" className={styles.photoPreviewImg} />
              <div className={styles.photoIconActions}>
                <label className={styles.photoIconBtn} title="Replace photo">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoUpload}
                    style={{ display: 'none' }}
                  />
                </label>
                <button type="button" onClick={removePhoto} className={styles.photoIconBtn} title="Delete photo">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.uploadBox}>
            <input
              type="file"
              accept="image/*"
              onChange={handlePhotoUpload}
              className={styles.uploadInput}
            />
            <span className={styles.uploadBoxLabel}>Click to upload photo</span>
            <span className={styles.uploadBoxHint}>JPG, PNG, WebP</span>
          </div>
        )}
        {uploadStatus.kind !== 'idle' && (
          <div
            className={`${styles.uploadStatus} ${
              uploadStatus.kind === 'uploading' ? styles.uploadStatusUploading
                : uploadStatus.kind === 'done' ? styles.uploadStatusDone
                : styles.uploadStatusError
            }`}
          >
            {uploadStatus.msg}
          </div>
        )}
      </div>
    </>
  );

  if (hideOwnHeader) {
    return inner;
  }

  return (
    <div className={styles.pkgCard}>
      <div className={styles.pkgHeader}>
        <div className={styles.pkgHeaderTitle}>Package {idx + 1}</div>
        {totalCount > 1 && (
          <button
            type="button"
            onClick={onRemove}
            className={styles.pkgRemoveBtn}
            title="Remove package"
          >
            ✕
          </button>
        )}
      </div>
      {inner}
    </div>
  );
}
