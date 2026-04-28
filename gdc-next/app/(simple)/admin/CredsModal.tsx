'use client';

// CredsModal — shown after admin creates a new account, displaying the
// user_id + slug + profile URL with a copy button. Vanilla equivalent:
// the #creds-modal div in admin.html with copyField helper.

import { useState } from 'react';
import styles from './admin.module.css';
import type { CredsModalData } from './AdminClient';

interface Props {
  data: CredsModalData;
  onClose: () => void;
}

export default function CredsModal({ data, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  function copyUrl() {
    navigator.clipboard.writeText(data.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        className={styles.credsModalBox}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.credsTitle}>✓ Account Created</div>
        <div className={styles.credsSub}>{data.name} — {data.role.toUpperCase()}</div>

        <div className={styles.credField}>
          <div className={styles.credFieldLabel}>User ID</div>
          <div className={styles.credFieldValue}>{data.user_id || '—'}</div>
        </div>

        <div className={styles.credField}>
          <div className={styles.credFieldLabel}>Slug</div>
          <div className={styles.credFieldValue}>{data.slug || '(none)'}</div>
        </div>

        <div className={styles.credField}>
          <div className={styles.credFieldLabel}>Profile</div>
          <div className={styles.credFieldValue}>{data.url}</div>
          <button
            type="button"
            onClick={copyUrl}
            className={styles.credCopyBtn}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        <p className={styles.credNote}>
          This account has a placeholder email and no active password. When
          a real person claims the profile, approve their claim in the
          Pending Claims tab — they&apos;ll automatically receive a &quot;Set
          Password&quot; email.
        </p>

        <button
          type="button"
          onClick={onClose}
          className={`${styles.btn} ${styles.btnAdmin}`}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          Got It
        </button>
      </div>
    </div>
  );
}
