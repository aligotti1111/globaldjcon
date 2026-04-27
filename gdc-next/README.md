# Global DJ Connect — Next.js Migration

This is the in-progress Next.js rewrite of the Global DJ Connect site. The original vanilla HTML/CSS/JS version lives in the parent directory. This rewrite is being done page-by-page so the live site keeps working throughout.

## Stack

- **Next.js 15** (App Router)
- **TypeScript** (strict mode)
- **Supabase** (`@supabase/ssr` for cookie-based auth)
- **Resend** (transactional email)
- Existing CSS files (no Tailwind — visual design carries over 1:1 from the old site)

## Why the rewrite

The old site grew to 60+ files of vanilla JS with duplicated headers/nav/auth on every page. The patterns that drove this rewrite:

1. **Shared layout in one place.** The `<header>`, mobile menu, and footer used to be rebuilt by `ui-chrome.js` on every page. They now live in `app/layout.tsx` and `components/Header.tsx` — edit once, every page updates.
2. **One Supabase client setup.** No more `const db = window.supabase.createClient(...)` workaround for the Cloudflare/Netlify variable name collision. See `lib/supabase/`.
3. **Type-safe user object.** The biggest production bug we hit was `cu.email` being null after migrating to Supabase Auth (email moved from `public.users` to `auth.users`). With TypeScript, `UserProfile` doesn't have `.email` — code that reads it won't compile. Use `CurrentUser` (which merges in the auth email) instead.
4. **Server Components for read-heavy pages.** The DJ directory and profile pages render with data already in the HTML — no client-side loading spinner.

## Folder structure

```
gdc-next/
├── app/                    # All pages and API routes (one folder = one route)
│   ├── layout.tsx          # Root layout (header, footer, mobile menu, AuthProvider)
│   ├── page.tsx            # Homepage / DJ directory
│   ├── [slug]/             # Dynamic DJ profile pages (e.g. /dj-name)
│   ├── login/              # /login
│   ├── signup/             # /signup
│   ├── booking-requests/   # /booking-requests (auth-protected)
│   ├── inbox/              # /inbox (auth-protected)
│   ├── admin/              # /admin (auth-protected)
│   ├── ... etc
│   └── api/
│       └── send-email/     # POST /api/send-email (replaces Netlify function)
├── components/             # Shared React components
│   ├── AuthProvider.tsx    # Provides useAuth() everywhere — replaces auth.js
│   ├── Header.tsx
│   ├── MobileMenu.tsx
│   └── Footer.tsx
├── lib/
│   └── supabase/
│       ├── client.ts       # Browser-side Supabase client
│       ├── server.ts       # Server-side Supabase client (cookies)
│       └── admin.ts        # Service role key — server-only
├── types/
│   └── db.ts               # UserProfile, CurrentUser, Booking types
├── public/
│   └── css/                # Existing stylesheets (copied as-is)
├── middleware.ts           # Auth refresh + route protection
├── next.config.js
├── tsconfig.json
├── package.json
└── .env.example            # Copy to .env.local and fill in real keys
```

## Migration status

Done:
- Project scaffolding, Supabase clients, middleware, root layout
- Header, MobileMenu, Footer, AuthProvider components
- Homepage (DJ directory) — Server Component example
- API route for `booking_request` email (one of ~17 types — pattern to follow for the rest)

Still to port:
- All other pages (login, signup, dj-profile, booking-requests, inbox, admin, etc.)
- All other email types in `app/api/send-email/route.ts` (copy logic from the old `send-email.js`)
- Admin Netlify functions (admin-create-user, admin-approve-claim, etc.) → port to `app/api/admin/*/route.ts`
- Booking flow JS (the `br-*.js` and `udjp-booking-*.js` files) → React components

## Local development

```bash
cp .env.example .env.local
# Fill in real Supabase keys + Resend key

npm install
npm run dev
# → http://localhost:3000
```

## Deploying to Netlify

The existing Netlify site already builds from this repo. Update the build settings:

- Build command: `npm run build`
- Publish directory: `.next`
- Base directory: `gdc-next` (this folder)

Add the env vars from `.env.example` to Netlify's environment variables panel.

## Recommended porting order

1. **Static pages first** (`/privacy`, `/contact`) — low risk, learn the framework
2. **Auth flow** (`/login`, `/signup`, `/forgot-password`, `/reset-password`) — get this right early, everything depends on it
3. **DJ directory + profile pages** (`/`, `/[slug]`) — read-heavy, great fit for Server Components
4. **Update DJ profile** (`/update-dj-profile`) — owner-side editing
5. **Booking flow** — the most complex. Save for last.
6. **Admin** — port last.

## A note on the email bug

The old site had silent email failures (requester confirmation emails not sending after the Supabase Auth migration). Root cause: `sessionStorage.getItem('currentUser')` returned an object without an `email` field, so `if (cu.email)` was always false and the fetch was skipped. The defensive fix was to send `requesterUserId` instead and resolve email server-side.

In this codebase, that whole class of bug is prevented by:
- `UserProfile` type doesn't have `.email` — TypeScript blocks the bad pattern
- `CurrentUser` (returned by `useAuth()`) always has `.email` — auth and profile are merged in one place
- `pickEmail()` in the API route still falls back to userId resolution as a safety net
