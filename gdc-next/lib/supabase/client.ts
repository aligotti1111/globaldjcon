// Browser-side Supabase client.
// Use this in Client Components ('use client').
// Replaces the old `const db = window.supabase.createClient(...)` pattern —
// no more Cloudflare/Netlify variable name collision.
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
