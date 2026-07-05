'use client';

// UsersTab — list of users for one role (dj/host/venue) with search,
// edit/delete/quick-verify/view buttons.
// Faithful port of vanilla adm-users.js renderUserList + filterList +
// quickVerify + deleteUser.

import { useState, useMemo } from 'react';
import styles from './admin.module.css';
import { deleteUserAction, updateUserAction } from './actions';
import type { AdminUserRow } from './page';

interface Props {
  role: 'dj' | 'host' | 'venue';
  users: AdminUserRow[];
  emailMap: Record<string, string>;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (user: AdminUserRow) => void;
}

export default function UsersTab({ role, users, emailMap, onEdit, onDelete, onUpdate }: Props) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const name = role === 'venue' ? (u.venue_name || u.name || '') : (u.name || '');
      const email = emailMap[u.id] || '';
      const slug = u.slug || '';
      return name.toLowerCase().includes(q)
        || email.toLowerCase().includes(q)
        || slug.toLowerCase().includes(q);
    });
  }, [users, search, emailMap, role]);

  async function quickVerify(u: AdminUserRow) {
    const displayName = u.name || 'this user';
    if (!window.confirm(`Mark ${displayName} as email-verified?\n\nThis bypasses the email confirmation step. Use only when you've confirmed the account belongs to a real person.`)) return;
    try {
      const result = await updateUserAction({
        user_id: u.id,
        updates: { email_verified: true },
      });
      if (result.success && result.user) {
        onUpdate(result.user as unknown as AdminUserRow);
      } else {
        alert('✗ ' + (result.error || 'Verify failed'));
      }
    } catch (e) {
      alert('✗ ' + (e as Error).message);
    }
  }

  async function deleteUser(u: AdminUserRow) {
    const displayName = u.name || 'this user';
    if (!window.confirm(`Permanently delete ${displayName}? This cannot be undone.`)) return;
    try {
      const result = await deleteUserAction(u.id);
      if (result.success) {
        onDelete(u.id);
      } else {
        alert('✗ ' + (result.error || 'Delete failed'));
      }
    } catch (e) {
      alert('✗ ' + (e as Error).message);
    }
  }

  function viewUser(slug: string | null) {
    if (!slug) return;
    window.open('/' + slug, '_blank');
  }

  const heading = role === 'dj' ? 'DJ Accounts'
    : role === 'host' ? 'Party Host Accounts'
    : 'Venue Accounts';
  const placeholder = role === 'dj' ? 'No dj accounts yet.'
    : role === 'host' ? 'No host accounts yet.'
    : 'No venue accounts yet.';
  const countLabel = `${users.length} ${users.length === 1 ? 'account' : 'accounts'}`;

  return (
    <div>
      <div className={styles.usersHeaderBar}>
        <div className={styles.formSectionLabel} style={{ margin: 0 }}>{heading}</div>
        <div className={styles.usersHeaderRight}>
          <span className={styles.usersCount}>{countLabel}</span>
        </div>
      </div>
      <input
        type="search"
        className={`${styles.formInput} ${styles.adminSearch}`}
        placeholder="Search by email, name, or slug..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {filtered.length === 0 ? (
        <div className={styles.emptyAdmin}>
          {search ? `No matches for "${search}"` : placeholder}
        </div>
      ) : (
        <div className={styles.adminList}>
          {filtered.map((u) => {
            const name = role === 'venue' ? (u.venue_name || u.name) : u.name;
            const email = emailMap[u.id] || '';
            const isUnclaimed = !u.claimed;
            const needsVerify = u.email_verified !== true;
            const createdLabel = u.created_at
              ? new Date(u.created_at).toLocaleDateString()
              : '—';
            const accessLabel = accessUntil(u);

            return (
              <div key={u.id} className={styles.adminRow}>
                {isUnclaimed && (
                  <span className={styles.unclaimedBadge}>Unclaimed</span>
                )}
                <div className={styles.arName}>{name || 'Unnamed'}</div>
                <div
                  className={styles.arDetail}
                  style={{ color: email ? 'var(--white)' : '#6b6b88', fontStyle: email ? 'normal' : 'italic' }}
                  title={email}
                >
                  {email || 'no email'}
                </div>
                <div className={styles.arDetail} title="Account created">{createdLabel}</div>
                <div
                  className={styles.arDetail}
                  title="Access good until (subscription or free access)"
                  style={{ color: accessLabel === '—' ? '#6b6b88' : 'var(--white)' }}
                >
                  {accessLabel}
                </div>

                <button
                  type="button"
                  onClick={() => onEdit(u.id)}
                  className={`${styles.btn} ${styles.btnAdmin} ${styles.btnSmall}`}
                >
                  Edit
                </button>
                {needsVerify && (
                  <button
                    type="button"
                    onClick={() => quickVerify(u)}
                    className={`${styles.btn} ${styles.btnOutline} ${styles.btnSmall}`}
                    style={{ borderColor: '#ffb347', color: '#ffb347' }}
                  >
                    Verify
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => viewUser(u.slug)}
                  className={`${styles.btn} ${styles.btnOutline} ${styles.btnSmall}`}
                >
                  View
                </button>
                <button
                  type="button"
                  onClick={() => deleteUser(u)}
                  className={`${styles.btn} ${styles.btnDanger} ${styles.btnSmall}`}
                >
                  Delete
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Access-until date for a row: the later of an active subscription's period
// end and an unexpired comp. Renders '—' when the account has no active access.
function accessUntil(u: AdminUserRow): string {
  const now = Date.now();
  const dates: number[] = [];
  if ((u.sub_status === 'active' || u.sub_status === 'grace') && u.sub_period_end) {
    const t = new Date(u.sub_period_end).getTime();
    if (!isNaN(t) && t > now) dates.push(t);
  }
  if (u.comp_tier && u.comp_expires_at) {
    const t = new Date(u.comp_expires_at).getTime();
    if (!isNaN(t) && t > now) dates.push(t);
  }
  if (dates.length === 0) return '—';
  return new Date(Math.max(...dates)).toLocaleDateString();
}
