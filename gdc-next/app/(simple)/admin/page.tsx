// /admin — admin panel for the platform owner.
// Faithful port of vanilla admin.html.
//
// Auth: gated by ADMIN_EMAIL constant in admin-auth.ts. Anyone else gets
// bounced to /login. Admin signs in via /login normally — Supabase auth.
//
// Initial data:
//   - Stats (DJ / Host / Venue counts, pending claim count)
//   - Initial DJ list, Host list, Venue list (cached server-side so the
//     client renders synchronously on first paint)
//   - Initial pending claims
//   - Initial email map (so user lists show emails)
//
// Tabs (rendered client-side):
//   1. Create Account
//   2. Pending Claims
//   3. Manage DJs
//   4. Manage Hosts
//   5. Manage Venues

import { redirect } from 'next/navigation';
import { isAdminUser } from '@/lib/supabase/admin-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import AdminClient from './AdminClient';

export const dynamic = 'force-dynamic';

export interface AdminUserRow {
  id: string;
  name: string | null;
  slug: string | null;
  role: string;
  dj_type: string | null;
  venue_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  bio: string | null;
  phone: string | null;
  website: string | null;
  instagram: string | null;
  soundcloud: string | null;
  tiktok: string | null;
  facebook: string | null;
  twitch: string | null;
  travel_distance: string | null;
  profile_private: boolean | null;
  claimed: boolean | null;
  email_verified: boolean | null;
  // Email is fetched separately from auth.users and merged in by the client
  email?: string;
}

export interface AdminClaimRow {
  id: string;
  target_user_id: string | null;
  target_slug: string | null;
  target_biz_name: string;
  claimant_name: string;
  claimant_email: string;
  verify_msg: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  reviewed_notes: string | null;
}

export default async function AdminPage() {
  const ok = await isAdminUser();
  if (!ok) redirect('/login?redirect=/admin');

  const admin = createAdminClient();

  // Fetch all three role lists in parallel + claims + email list
  const [djRes, hostRes, venueRes, claimsRes] = await Promise.all([
    admin.from('users').select('*').eq('role', 'dj').order('name'),
    admin.from('users').select('*').eq('role', 'host').order('name'),
    admin.from('users').select('*').eq('role', 'venue').order('name'),
    admin.from('profile_claims').select('*').eq('status', 'pending').order('created_at', { ascending: false }),
  ]);

  const djs = (djRes.data as AdminUserRow[]) || [];
  const hosts = (hostRes.data as AdminUserRow[]) || [];
  const venues = (venueRes.data as AdminUserRow[]) || [];
  const claims = (claimsRes.data as AdminClaimRow[]) || [];

  // Build the email map. listUsers paginates; we pull up to 5 pages.
  const emailMap: Record<string, string> = {};
  try {
    let page = 1;
    while (page <= 5) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) break;
      if (!data.users.length) break;
      for (const u of data.users) emailMap[u.id] = u.email || '';
      if (data.users.length < 1000) break;
      page++;
    }
  } catch (e) {
    console.error('Admin: email map fetch error', e);
  }

  return (
    <AdminClient
      initialDjs={djs}
      initialHosts={hosts}
      initialVenues={venues}
      initialClaims={claims}
      initialEmailMap={emailMap}
    />
  );
}
