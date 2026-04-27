// Homepage — DJ directory.
// SERVER COMPONENT: data fetch happens on the server.
// Class names match the vanilla site's index.css so styling carries over.

import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import type { UserProfile } from '@/types/db';

export default async function HomePage() {
  const supabase = await createClient();

  const { data: djs } = await supabase
    .from('users')
    .select('id, name, slug, city, state, country, dj_type')
    .eq('role', 'dj')
    .not('slug', 'is', null)
    .order('created_at', { ascending: false })
    .limit(60)
    .returns<UserProfile[]>();

  return (
    <>
      <div className="main">
        <div className="grid">
          {(!djs || djs.length === 0) && (
            <div className="empty-state">
              <div className="empty-icon">🎧</div>
              <div className="empty-title">No DJs Found</div>
              <div className="empty-sub">Check back soon</div>
            </div>
          )}

          {djs?.map(dj => {
            const cardClass = `dj-card ${dj.dj_type === 'club' ? 'club' : ''}`.trim();
            const location = [dj.city, dj.state, dj.country].filter(Boolean).join(', ');
            const initial = (dj.name || '?').charAt(0).toUpperCase();

            return (
              <Link
                key={dj.id}
                href={`/${dj.slug}`}
                className={cardClass}
                style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
              >
                <div className="card-glow" />
                <div className="card-top">
                  <div className="avatar">{initial}</div>
                  <div>
                    <div className="dj-name">{dj.name}</div>
                    {location && <div className="location">{location}</div>}
                  </div>
                </div>
                {dj.dj_type && (
                  <div className="card-footer">
                    <span className="type-badge">
                      {dj.dj_type === 'club' ? 'Club DJ' : 'Mobile DJ'}
                    </span>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
