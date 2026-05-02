// Browser-side Supabase client.
// Use this in Client Components ('use client').
//
// Now typed via the Database generic — every .from(), .select(), .insert(),
// .update() call gets full IntelliSense + compile-time column checking.
// See types/supabase.ts for the schema definition.
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/supabase';

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
