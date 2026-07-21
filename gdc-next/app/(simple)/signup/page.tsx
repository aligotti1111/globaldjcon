'use client';

// Signup route.
//
// The actual signup — the account-type chooser, the DJ / Host / Venue forms,
// all of it — moved into SignupFlow.tsx. Why: the header's Create-an-Account
// popup (AuthModal) needs to render the SAME chooser and forms, so they had to
// be importable as named exports. Next.js 15 forbids arbitrary named exports
// from a page.tsx (only reserved config fields are allowed), so a page file
// can't be the home for shared components. This page is therefore a thin
// wrapper around SignupPageBody, which lives in that normal module.
//
// Behaviour is unchanged: this renders exactly what /signup rendered before.

import { SignupPageBody } from './SignupFlow';

export default function SignupPage() {
  return <SignupPageBody />;
}
