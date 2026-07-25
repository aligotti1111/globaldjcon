// Middleware runs on every request before the page renders.
// Its main job: refresh the user's Supabase session (sliding window) so
// they stay logged in across page navigations without re-authenticating.
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session if expired — this writes new cookies to the response
  const { data: { user } } = await supabase.auth.getUser();

  // Route protection: pages that require login
  const protectedPaths = [
    '/admin',
    '/inbox',
    '/account-settings',
    '/booking-requests',
    '/update-dj-profile',
  ];
  const path = request.nextUrl.pathname;
  const isProtected = protectedPaths.some(p => path.startsWith(p));

  if (isProtected && !user) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', path);
    return NextResponse.redirect(loginUrl);
  }

  // Personalized, per-user pages must NEVER be cached by a CDN (Cloudflare) or
  // the browser. `export const dynamic = 'force-dynamic'` stops Next's own
  // cache but sends no Cache-Control header, so Cloudflare can still cache the
  // rendered HTML and serve one user a stale or cross-account copy (e.g. a
  // teammate seeing an empty/owner page, or a stale subscription tier). This
  // header shuts that off at the edge.
  const personalPaths = [
    '/upcoming-bookings', '/booking-requests', '/account-settings',
    '/update-dj-profile', '/inbox', '/subscribe', '/notifications',
    '/past-bookings', '/admin',
  ];
  if (personalPaths.some((p) => path === p || path.startsWith(p + '/'))) {
    response.headers.set('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - api routes that handle their own auth
     * - public files (images, css, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js)$).*)',
  ],
};
