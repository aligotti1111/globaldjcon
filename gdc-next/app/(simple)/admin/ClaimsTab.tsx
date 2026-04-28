'use client';

// ClaimsTab — admin reviews pending profile claims.
// Faithful port of vanilla adm-claims.js loadClaims/approveClaim/rejectClaim.

import { useState } from 'react';
import styles from './admin.module.css';
import { approveClaimAction, rejectClaimAction, listClaimsAction } from './actions';
import type { AdminClaimRow } from './page';

interface Props {
  claims: AdminClaimRow[];
  onUpdated: (next: AdminClaimRow[]) => void;
}

export default function ClaimsTab({ claims, onUpdated }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    const result = await listClaimsAction('pending');
    onUpdated(result.claims as AdminClaimRow[]);
  }

  async function approve(claim: AdminClaimRow) {
    const notes = window.prompt('Optional notes about this approval (leave blank if none):') || '';
    if (!window.confirm("Approve this claim? The user's email will be swapped and they'll receive a set-password email.")) return;
    setBusyId(claim.id);
    try {
      const siteBase = window.location.origin;
      const result = await approveClaimAction(claim.id, notes, siteBase);
      if (result.success) {
        alert('✓ ' + (result.message || 'Claim approved'));
        await refresh();
      } else {
        alert('✗ ' + (result.error || 'Approval failed'));
      }
    } finally {
      setBusyId(null);
    }
  }

  async function reject(claim: AdminClaimRow) {
    const reason = window.prompt('Reason for rejection (required):');
    if (!reason) return;
    if (!window.confirm('Reject this claim?')) return;
    setBusyId(claim.id);
    try {
      const result = await rejectClaimAction(claim.id, reason);
      if (result.success) {
        alert('✗ Claim rejected');
        await refresh();
      } else {
        alert('✗ ' + (result.error || 'Reject failed'));
      }
    } finally {
      setBusyId(null);
    }
  }

  if (claims.length === 0) {
    return <div className={styles.emptyAdmin}>No pending claims right now.</div>;
  }

  return (
    <div>
      {claims.map((c) => {
        const profileUrl = c.target_slug ? `https://globaldjconnect.com/${c.target_slug}` : '';
        const submitted = new Date(c.created_at).toLocaleString();
        const noTarget = !c.target_user_id;
        const busy = busyId === c.id;

        return (
          <div key={c.id} className={`${styles.claimCard} ${styles.claimCardPending}`}>
            <div className={styles.claimHead}>
              <div className={styles.claimTitle}>{c.target_biz_name}</div>
              <div className={`${styles.claimStatus} ${styles.claimStatusPending}`}>Pending</div>
            </div>
            <ClaimRow label="Submitted" value={submitted} />
            <ClaimRow label="Claimant" value={c.claimant_name} />
            <ClaimRow
              label="Their Email"
              value={<a href={`mailto:${c.claimant_email}`}>{c.claimant_email}</a>}
            />
            {profileUrl && (
              <ClaimRow
                label="Profile"
                value={<a href={profileUrl} target="_blank" rel="noopener noreferrer">{profileUrl}</a>}
              />
            )}
            {noTarget && (
              <ClaimRow
                label="⚠ Warning"
                value={
                  <span style={{ color: 'var(--error)' }}>
                    No target user ID — may have been deleted or never existed. Approval will fail.
                  </span>
                }
              />
            )}
            <ClaimRow
              label="Verification"
              value={
                <span style={{ whiteSpace: 'pre-wrap' }}>
                  {c.verify_msg || 'None provided'}
                </span>
              }
            />
            <div className={styles.claimActions}>
              <button
                type="button"
                onClick={() => approve(c)}
                disabled={busy || noTarget}
                className={`${styles.btn} ${styles.btnSuccess}`}
                style={noTarget ? { opacity: 0.4, cursor: 'not-allowed' } : {}}
              >
                ✓ Approve
              </button>
              <button
                type="button"
                onClick={() => reject(c)}
                disabled={busy}
                className={`${styles.btn} ${styles.btnDanger}`}
              >
                ✗ Reject
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ClaimRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={styles.claimRow}>
      <div className={styles.claimRowLabel}>{label}</div>
      <div className={styles.claimRowValue}>{value}</div>
    </div>
  );
}
