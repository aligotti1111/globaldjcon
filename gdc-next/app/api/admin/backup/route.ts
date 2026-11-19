// /api/admin/backup — owner-only JSON export of the core business tables.
//
// This is an on-demand DATA copy the admin can download and keep. It reads
// each table through the service-role client (so RLS can't hide rows) and
// streams one JSON file: { meta, tables: { <table>: [ ...rows ] } }.
//
// It is NOT a full disaster-recovery backup: it does not include Supabase
// Storage files (uploaded logos / rider PDFs / gallery images live in a
// bucket, not a table), auth passwords, RLS policies, or Postgres internals.
// For true point-in-time restore, Supabase PITR is still the safeguard. This
// complements it with a copy you control.
//
// A matching "restore from file" importer can be added later; for now this is
// download-only.

import { NextResponse } from 'next/server';
import { isAdminUser } from '@/lib/supabase/admin-auth';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// The tables worth keeping a copy of — real business data. Transient security
// tokens (email_verification_tokens, password_setup_tokens, inbox_reply_tokens)
// and raw webhook-event logs (stripe/paypal) are intentionally excluded: they
// expire or are provider-side records, not data you'd restore.
const TABLES = [
  'users',
  'bookings',
  'booking_payments',
  'booking_planners',
  'booking_riders',
  'booking_guestlists',
  'booking_change_requests',
  'contracts',
  'messages',
  'team_members',
  'team_activity_log',
  'planners',
  'discount_codes',
  'comp_codes',
  'code_redemptions',
  'comp_code_redemptions',
  'site_sales',
  'profile_claims',
] as const;

const PAGE = 1000; // Supabase caps a single select at 1000 rows — page through.

export async function GET() {
  if (!(await isAdminUser())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  // Untyped handle: we read a dynamic list of table names, so the generated
  // per-table typings (and the created_at order) can't be statically checked.
  const admin = createAdminClient() as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        order: (c: string, o: { ascending: boolean }) => { range: (a: number, b: number) => Promise<{ data: unknown[] | null; error: unknown }> };
        range: (a: number, b: number) => Promise<{ data: unknown[] | null; error: unknown }>;
      };
    };
  };
  const tables: Record<string, unknown[]> = {};
  const errors: Record<string, string> = {};
  const counts: Record<string, number> = {};

  for (const table of TABLES) {
    try {
      const rows: unknown[] = [];
      // Page in 1000-row windows until a short page signals the end.
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from(table)
          .select('*')
          .order('created_at', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) {
          // Some tables may not have created_at — retry without the order.
          const retry = await admin.from(table).select('*').range(from, from + PAGE - 1);
          if (retry.error) throw retry.error;
          const batch = retry.data || [];
          rows.push(...batch);
          if (batch.length < PAGE) break;
          continue;
        }
        const batch = data || [];
        rows.push(...batch);
        if (batch.length < PAGE) break;
      }
      tables[table] = rows;
      counts[table] = rows.length;
    } catch (e) {
      // A missing/renamed table shouldn't sink the whole backup — note it and
      // move on, so the admin still gets everything else.
      errors[table] = e instanceof Error ? e.message : String(e);
    }
  }

  const payload = {
    meta: {
      app: 'Global DJ Connect',
      generated_at: new Date().toISOString(),
      format: 'gdc-json-backup-v1',
      table_counts: counts,
      ...(Object.keys(errors).length ? { skipped: errors } : {}),
      note: 'Data export only. Does not include Supabase Storage files (logos, rider PDFs, gallery images), auth passwords, or RLS policies.',
    },
    tables,
  };

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const body = JSON.stringify(payload, null, 2);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="gdc-backup-${stamp}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
