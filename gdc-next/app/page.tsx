// Homepage — DJ directory.
// SERVER COMPONENT: data fetch happens on the server, page renders with data
// already in the HTML. No loading spinner, better SEO, faster first paint.
// This replaces all of idx-init.js + idx-render.js + idx-filters.js.
//
// (Filters/search will live in a Client Component child for interactivity.)

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
    <div className="page-container">
      <section className="hero">
        <h1>Global DJ Connect</h1>
        <p>Find and book DJs worldwide.</p>
      </section>

      <section className="dj-grid">
        {djs?.map(dj => (
          <Link key={dj.id} href={`/${dj.slug}`} className="dj-card">
            <h3>{dj.name}</h3>
            <p>
              {[dj.city, dj.state, dj.country].filter(Boolean).join(', ')}
            </p>
            {dj.dj_type && (
              <span className="dj-type-badge">
                {dj.dj_type === 'club' ? 'Club DJ' : 'Mobile DJ'}
              </span>
            )}
          </Link>
        ))}
      </section>
    </div>
  );
}
