// /update-dj-profile — now just a redirect to the canonical URL.
//
// The DJ profile editor moved to /account-settings: a DJ's "account settings"
// IS their profile, so both live at one URL. This route stays only so every
// existing link, bookmark, and auth redirect that still points here keeps
// working — it forwards to /account-settings, where the profile now renders.

import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function UpdateDjProfilePage() {
  redirect('/account-settings');
}
