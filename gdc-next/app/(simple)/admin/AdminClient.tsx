'use client';

// AdminClient — top-level shell for the admin panel.
// Faithful port of vanilla admin.html structure. Manages: tab state,
// stats, the underlying user/claim lists. Each tab is rendered as a
// separate component for readability.
//
// The data is initialized server-side and refreshed client-side via
// server actions. After any mutation we update local state instead of
// re-fetching everything from the DB.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import styles from './admin.module.css';
import CreateAccountTab from './CreateAccountTab';
import ClaimsTab from './ClaimsTab';
import UsersTab from './UsersTab';
import EditUserModal from './EditUserModal';
import CredsModal from './CredsModal';
import type { AdminUserRow, AdminClaimRow } from './page';

type TabKey = 'create' | 'claims' | 'djs' | 'hosts' | 'venues';

interface Props {
  initialDjs: AdminUserRow[];
  initialHosts: AdminUserRow[];
  initialVenues: AdminUserRow[];
  initialClaims: AdminClaimRow[];
  initialEmailMap: Record<string, string>;
}

export interface CredsModalData {
  user_id: string;
  name: string;
  role: string;
  slug: string | null;
  url: string;
}

export default function AdminClient({
  initialDjs, initialHosts, initialVenues, initialClaims, initialEmailMap,
}: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>('djs');

  // User lists, mutable so we can update after create/edit/delete
  const [djs, setDjs] = useState<AdminUserRow[]>(initialDjs);
  const [hosts, setHosts] = useState<AdminUserRow[]>(initialHosts);
  const [venues, setVenues] = useState<AdminUserRow[]>(initialVenues);
  const [claims, setClaims] = useState<AdminClaimRow[]>(initialClaims);
  const [emailMap, setEmailMap] = useState<Record<string, string>>(initialEmailMap);

  // Modal state — managed at the top level so any tab can open them
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [credsData, setCredsData] = useState<CredsModalData | null>(null);

  // Stats — derived from the lists (no extra fetch)
  const stats = useMemo(() => ({
    djs: djs.length,
    hosts: hosts.length,
    venues: venues.length,
    claims: claims.filter((c) => c.status === 'pending').length,
  }), [djs.length, hosts.length, venues.length, claims]);

  // Find a user by id across all role lists — used by EditUserModal
  const findUser = (id: string): AdminUserRow | null => {
    return djs.find((u) => u.id === id)
      || hosts.find((u) => u.id === id)
      || venues.find((u) => u.id === id)
      || null;
  };

  // Mutators called by child components after server actions succeed
  const upsertUser = (user: AdminUserRow) => {
    const setters: Record<string, [AdminUserRow[], React.Dispatch<React.SetStateAction<AdminUserRow[]>>]> = {
      dj: [djs, setDjs],
      host: [hosts, setHosts],
      venue: [venues, setVenues],
    };
    // The user might have changed role — remove from the old list, add to the new one
    for (const [, [list, setList]] of Object.entries(setters)) {
      if (list.find((u) => u.id === user.id)) {
        setList((prev) => prev.filter((u) => u.id !== user.id));
      }
    }
    const target = setters[user.role];
    if (target) {
      target[1]((prev) => [...prev, user].sort((a, b) =>
        (a.name || '').localeCompare(b.name || '')
      ));
    }
  };

  const removeUser = (id: string) => {
    setDjs((prev) => prev.filter((u) => u.id !== id));
    setHosts((prev) => prev.filter((u) => u.id !== id));
    setVenues((prev) => prev.filter((u) => u.id !== id));
  };

  const refreshClaims = (next: AdminClaimRow[]) => setClaims(next);

  const updateEmail = (userId: string, email: string) => {
    setEmailMap((prev) => ({ ...prev, [userId]: email }));
  };

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
  }

  return (
    <div className={styles.adminBody}>
      {/* Admin header */}
      <div className={styles.adminHeader}>
        <div className={styles.adminBranding}>
          <div className={styles.adminWordmark}>Global DJ Connect</div>
          <div className={styles.adminBadge}>Admin Panel</div>
        </div>
        <div className={styles.adminActions}>
          <Link href="/" className={`${styles.btn} ${styles.btnPrimary}`}>
            View Directory
          </Link>
          <button onClick={logout} className={`${styles.btn} ${styles.btnGhost}`}>
            Sign Out
          </button>
        </div>
      </div>

      <div className={styles.contentBody}>
        {/* Stat bar */}
        <div className={styles.statBar}>
          <div className={styles.statCard}>
            <div className={styles.statNumber}>{stats.djs}</div>
            <div className={styles.statLabel}>DJ Accounts</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statNumber}>{stats.hosts}</div>
            <div className={styles.statLabel}>Host Accounts</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statNumber}>{stats.venues}</div>
            <div className={styles.statLabel}>Venue Accounts</div>
          </div>
          <div className={`${styles.statCard} ${stats.claims > 0 ? styles.statCardAlert : ''}`}>
            <div className={styles.statNumber}>{stats.claims}</div>
            <div className={styles.statLabel}>Pending Claims</div>
          </div>
        </div>

        {/* Tabs */}
        <div className={styles.adminTabs}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '.25rem',
              border: '1px solid var(--border)',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: '10px',
              padding: '.15rem .55rem',
            }}
          >
            <span
              style={{
                fontSize: '.62rem',
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: 'var(--muted)',
                marginRight: '.15rem',
              }}
            >
              Accounts
            </span>
            <TabBtn active={activeTab === 'djs'} onClick={() => setActiveTab('djs')}>
              🎧 DJs
            </TabBtn>
            <TabBtn active={activeTab === 'hosts'} onClick={() => setActiveTab('hosts')}>
              🎉 Hosts
            </TabBtn>
            <TabBtn active={activeTab === 'venues'} onClick={() => setActiveTab('venues')}>
              🏛 Venues
            </TabBtn>
          </div>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', marginLeft: '.85rem' }}>
            <TabBtn active={activeTab === 'create'} onClick={() => setActiveTab('create')}>
              ➕ Create Account
            </TabBtn>
            <TabBtn active={activeTab === 'claims'} onClick={() => setActiveTab('claims')}>
              📋 Pending Claims
              {stats.claims > 0 && <span className={styles.pill}>{stats.claims}</span>}
            </TabBtn>
          </div>
        </div>

        {/* Tab content */}
        {activeTab === 'create' && (
          <CreateAccountTab
            onCreated={(creds) => setCredsData(creds)}
            onUserAdded={() => router.refresh()}
          />
        )}
        {activeTab === 'claims' && (
          <ClaimsTab claims={claims} onUpdated={refreshClaims} />
        )}
        {activeTab === 'djs' && (
          <UsersTab
            role="dj"
            users={djs}
            emailMap={emailMap}
            onEdit={(id) => setEditUserId(id)}
            onDelete={removeUser}
            onUpdate={(u) => upsertUser(u)}
          />
        )}
        {activeTab === 'hosts' && (
          <UsersTab
            role="host"
            users={hosts}
            emailMap={emailMap}
            onEdit={(id) => setEditUserId(id)}
            onDelete={removeUser}
            onUpdate={(u) => upsertUser(u)}
          />
        )}
        {activeTab === 'venues' && (
          <UsersTab
            role="venue"
            users={venues}
            emailMap={emailMap}
            onEdit={(id) => setEditUserId(id)}
            onDelete={removeUser}
            onUpdate={(u) => upsertUser(u)}
          />
        )}
      </div>

      {/* Modals */}
      {editUserId && (
        <EditUserModal
          user={findUser(editUserId)}
          email={emailMap[editUserId] || ''}
          onClose={() => setEditUserId(null)}
          onSaved={(user, newEmail) => {
            upsertUser(user);
            if (newEmail) updateEmail(user.id, newEmail);
            setEditUserId(null);
          }}
        />
      )}
      {credsData && (
        <CredsModal data={credsData} onClose={() => setCredsData(null)} />
      )}
    </div>
  );
}

function TabBtn({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.tabBtn} ${active ? styles.tabBtnActive : ''}`}
    >
      {children}
    </button>
  );
}
