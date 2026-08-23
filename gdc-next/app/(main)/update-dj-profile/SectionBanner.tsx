'use client';

// SectionBanner — the gradient hero header used by the Discounts tab, extracted
// so every Booking Settings tab (Settings / Packages / Contracts / Payments /
// Planner & Playlist) shares the same look: a 3px gradient top accent, a teal
// icon tile, a Bebas Neue title and a muted subtitle, with an optional slot on
// the right (e.g. a "live" badge or a Save button).
//
// Usage — drop it in as the first child of a `sectionCard`, replacing the old
// <div className={styles.sectionTitle}>Title</div>:
//
//   <SectionBanner icon="payments" title="Payment Methods"
//     subtitle="How you collect deposits and balances." />
//
// Deploy to: gdc-next/app/(main)/update-dj-profile/SectionBanner.tsx

import type { ReactNode } from 'react';

const GRAD = 'linear-gradient(100deg,#22e3ad,#31d0ff)';

export type BannerIcon =
  | 'settings' | 'packages' | 'contracts' | 'payments' | 'planner'
  | 'discounts' | 'rider' | 'guests' | 'rates'
  // Account-settings icons.
  | 'user' | 'events' | 'location' | 'bell' | 'blocked' | 'clock';

function Icon({ name }: { name: BannerIcon }) {
  const common = {
    viewBox: '0 0 24 24', width: 22, height: 22, fill: 'none',
    stroke: '#04241b', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'settings':
      return (<svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>);
    case 'packages':
      return (<svg {...common}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>);
    case 'contracts':
      return (<svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>);
    case 'payments':
      return (<svg {...common}><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>);
    case 'planner':
      return (<svg {...common}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>);
    case 'rider':
      return (<svg {...common}><path d="M9 11H1l8-8v8zM15 13h8l-8 8v-8z" /></svg>);
    case 'guests':
      return (<svg {...common}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>);
    case 'rates':
      return (<svg {...common}><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>);
    case 'user':
      return (<svg {...common}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>);
    case 'events':
      return (<svg {...common}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>);
    case 'location':
      return (<svg {...common}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>);
    case 'bell':
      return (<svg {...common}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>);
    case 'blocked':
      return (<svg {...common}><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg>);
    case 'clock':
      return (<svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>);
    case 'discounts':
    default:
      return (<svg {...common}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>);
  }
}

export default function SectionBanner({
  icon, title, subtitle, right,
}: {
  icon: BannerIcon;
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 16,
        padding: '20px 26px', borderBottom: '1px solid rgba(255,255,255,.14)',
        background: 'linear-gradient(180deg,rgba(34,227,173,.10),rgba(34,227,173,.02))',
      }}
    >
      <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: GRAD }} />
      <span
        style={{
          width: 44, height: 44, borderRadius: 12, background: GRAD, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 22px -8px rgba(34,227,173,.7)',
        }}
      >
        <Icon name={icon} />
      </span>
      <div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.55rem', letterSpacing: '.04em', lineHeight: 1, color: '#fff' }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ marginTop: 4, fontSize: '.78rem', color: 'var(--muted,#8b8da3)' }}>
            {subtitle}
          </div>
        )}
      </div>
      {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
    </div>
  );
}
