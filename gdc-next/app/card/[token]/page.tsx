// /card/[token] — the public, login-free, read-only booking card.
//
// The token is an unguessable per-booking UUID (bookings.share_token). Anyone
// with the link sees the full card exactly as it stands, but READ-ONLY: no
// icons, no actions, nothing clickable that changes anything. noindex so it
// never lands in a search engine. Read via the admin client (there is no RLS
// path for an anonymous viewer, and the token IS the authorization).

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MOB_EVENT_LABELS } from '@/lib/constants';
import CardDownloadButton from './CardDownloadButton';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Never index a shareable private card.
export const metadata: Metadata = { robots: { index: false, follow: false } };

interface BookingRow {
  id: string;
  dj_id: string | null;
  booking_type: string | null;
  event_type: string | null;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  venue_name: string | null;
  venue_address: string | null;
  venue_type: string | null;
  venue_type_desc: string | null;
  ceremony_needed: boolean | null;
  ceremony_start_time: string | null;
  ceremony_same_room: boolean | null;
  cocktail_needed: boolean | null;
  cocktail_start_time: string | null;
  cocktail_same_room: boolean | null;
  requester_name: string | null;
  host_email: string | null;
  phone: string | null;
  package_title: string | null;
  package_details: string | null;
  set_type: string | null;
  equipment: string | null;
  quoted_rate: number | null;
  counter_rate: number | null;
  offer_amount: number | null;
  deposit_pct: number | null;
  deposit_amount: number | null;
  tax_pct: number | null;
  tax_amount: number | null;
  total_with_tax: number | null;
  currency: string | null;
  status: string | null;
  contract_status: string | null;
  planner_status: string | null;
  deposit_completed_at: string | null;
  balance_completed_at: string | null;
  status_overrides: Record<string, boolean> | null;
}

function money(n: number | null | undefined, currency: string): string {
  if (n == null) return '';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(n); }
  catch { return `$${Number(n).toFixed(2)}`; }
}
function fmtDate(d: string | null): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
function fmtTime(t: string | null): string {
  if (!t) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return t;
  let h = parseInt(m[1], 10); const min = m[2];
  if (isNaN(h)) return t;
  const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12; if (h === 0) h = 12;
  return `${h}:${min} ${ap}`;
}
function htmlToText(s: string | null): string {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

export default async function ShareableBookingCardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Validate the token shape before touching the DB (UUID only).
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound();

  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data } = await admin
    .from('bookings')
    .select('id, dj_id, booking_type, event_type, event_date, start_time, end_time, venue_name, venue_address, venue_type, venue_type_desc, ceremony_needed, ceremony_start_time, ceremony_same_room, cocktail_needed, cocktail_start_time, cocktail_same_room, requester_name, host_email, phone, package_title, package_details, set_type, equipment, quoted_rate, counter_rate, offer_amount, deposit_pct, deposit_amount, tax_pct, tax_amount, total_with_tax, currency, status, contract_status, planner_status, deposit_completed_at, balance_completed_at, status_overrides')
    .eq('share_token', token)
    .maybeSingle<BookingRow>();

  if (!data) notFound();
  const b = data;

  // DJ branding for the header. (Logo intentionally not shown on the card.)
  let djName = 'Global DJ Connect';
  if (b.dj_id) {
    const { data: dj } = await admin
      .from('users').select('name, company').eq('id', b.dj_id)
      .maybeSingle<{ name: string | null; company: string | null }>();
    djName = (dj?.company || dj?.name || djName) as string;
  }

  // Host name: prefer what the booking captured; if blank, fall back to the
  // host's account name (matched by email, then phone) so the card isn't left
  // showing a phone number with no name attached. Phones in `users` are stored
  // as E.164 digits (with or without a leading +), while the booking's phone may
  // be formatted — so match against all the common shapes.
  let hostName = b.requester_name || null;
  if (!hostName && b.host_email) {
    const { data } = await admin.from('users').select('name').eq('email', b.host_email).maybeSingle<{ name: string | null }>();
    hostName = data?.name || null;
  }
  if (!hostName && b.phone) {
    const d = String(b.phone).replace(/\D/g, '');
    const d10 = d.slice(-10);
    const cands = Array.from(new Set([d, d10, `1${d10}`, `+1${d10}`, `+${d}`].filter((x) => x.replace(/\D/g, '').length >= 7)));
    const { data } = await admin.from('users').select('name').in('phone', cands).limit(1);
    hostName = (data && data[0]?.name) || null;
  }

  const currency = b.currency || 'USD';
  const isClub = b.booking_type === 'club';
  const isCancelled = b.status === 'cancelled';
  const price = b.counter_rate ?? b.quoted_rate ?? b.offer_amount ?? null;
  const total = b.total_with_tax ?? price;

  // Payment status for the Pricing block. Read the manual-payment ledger rows so
  // a Paid deposit / Paid balance shows on the card, and a balance the host said
  // they'll settle in cash/check at the event reads "Cash on day of event".
  const ov = b.status_overrides || {};
  const { data: payData } = await admin
    .from('booking_payments')
    .select('kind, status, method, client_intent, amount, amount_paid')
    .eq('booking_id', b.id);
  const payRows = (payData || []) as Array<{ kind: string; status: string; method: string | null; client_intent: string | null; amount: number | null; amount_paid: number | null }>;
  const depRow = payRows.find((r) => r.kind === 'deposit') || null;
  const balRow = payRows.find((r) => r.kind === 'balance') || null;

  const hasDeposit = (b.deposit_amount != null && b.deposit_amount > 0) || (b.deposit_pct != null && b.deposit_pct > 0) || !!depRow;
  const depositAmount = b.deposit_amount != null && b.deposit_amount > 0
    ? b.deposit_amount
    : (b.deposit_pct && total != null ? Math.round(total * b.deposit_pct) / 100 : (depRow?.amount ?? null));
  const depositPaid = !!b.deposit_completed_at || !!ov.deposit || depRow?.status === 'paid';
  const balancePaid = !!b.balance_completed_at || !!ov.balance || !!ov.invoice || balRow?.status === 'paid';
  const balanceAmount = hasDeposit && depositAmount != null && total != null ? Math.max(total - depositAmount, 0) : total;

  // "Pay at the event" intent on an unpaid balance → Cash / Check on day of event.
  const balanceAtEvent = !balancePaid && balRow && balRow.client_intent === 'pay_at_event'
    ? (balRow.method === 'check' ? 'Check on day of event' : 'Cash on day of event')
    : null;

  const eventLabel = MOB_EVENT_LABELS[(b.event_type || '').toLowerCase()] || b.event_type || 'Event';
  const timeRange = [fmtTime(b.start_time), fmtTime(b.end_time)].filter(Boolean).join(' – ');
  const venueType = b.venue_type_desc || b.venue_type || '';
  // Downloaded image name: "Event type - date - venue".
  const downloadName = [eventLabel, b.event_date, b.venue_name || venueType]
    .filter(Boolean)
    .join(' - ')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim() || 'booking';

  // ── Presentation ──────────────────────────────────────────────────────
  const page: React.CSSProperties = { minHeight: '100vh', background: '#0b0b12', color: '#fff', padding: '1.5rem 1rem', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" };
  const card: React.CSSProperties = { maxWidth: 1100, margin: '0 auto', background: 'var(--bg-card,#14141f)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, overflow: 'hidden' };
  const section: React.CSSProperties = { border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: '1rem 1.1rem', margin: '0 1rem 1rem' };
  const chip: React.CSSProperties = { display: 'inline-block', background: 'rgba(0,224,164,.15)', color: '#00e0a4', fontWeight: 800, fontSize: '.62rem', letterSpacing: '.08em', padding: '.25rem .6rem', borderRadius: 6, textTransform: 'uppercase', marginBottom: '.7rem' };
  const label: React.CSSProperties = { color: '#8a8aa0', fontSize: '.62rem', letterSpacing: '.08em', textTransform: 'uppercase', fontFamily: "'Space Mono', monospace" };
  const value: React.CSSProperties = { color: '#fff', fontSize: '.92rem', marginTop: 2 };
  const paidPill: React.CSSProperties = { background: 'rgba(0,224,164,.15)', color: '#00e0a4', fontWeight: 800, fontSize: '.6rem', letterSpacing: '.06em', padding: '.12rem .45rem', borderRadius: 5, textTransform: 'uppercase' };
  const atEventPill: React.CSSProperties = { background: 'rgba(234,169,74,.15)', color: '#eaa94a', fontWeight: 700, fontSize: '.62rem', padding: '.12rem .45rem', borderRadius: 5 };

  const Field = ({ l, v }: { l: string; v: string | null | undefined }) => (!v ? null : (
    <div style={{ marginBottom: '.7rem' }}>
      <div style={label}>{l}</div>
      <div style={value}>{v}</div>
    </div>
  ));

  return (
    <div style={page}>
      <div id="gdc-share-card" style={card}>
        {/* Header — just the DJ / company name. Event type, date/time and the
            "Booked with" line were removed (those details live in the sections
            below). */}
        <div style={{ padding: '1.2rem 1.2rem 1rem', display: 'flex', alignItems: 'center', gap: '.8rem', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Bebas Neue', Impact, sans-serif", fontSize: '1.9rem', letterSpacing: '.03em', color: '#fff', lineHeight: 1 }}>{djName}</div>
          </div>
          {isCancelled && (
            <span style={{ background: '#c0392b', border: '1px solid #ff7676', color: '#fff', fontWeight: 800, fontSize: '.58rem', letterSpacing: '.06em', padding: '.2rem .5rem', borderRadius: 4 }}>CANCELLED</span>
          )}
        </div>

        {/* Event. Weddings can carry a ceremony and/or a cocktail hour, each with
            its own start time (and room note) — surface them above the main
            reception time, same as the DJ's own card. */}
        <div style={section}>
          <span style={chip}>Event</span>
          <Field l="Event Type" v={eventLabel} />
          <Field l="Date" v={fmtDate(b.event_date)} />
          {b.ceremony_needed && b.ceremony_start_time && (
            <Field
              l="Ceremony"
              v={`${fmtTime(b.ceremony_start_time)}${b.ceremony_same_room == null ? '' : b.ceremony_same_room ? ' · same room as reception' : ' · separate room'}`}
            />
          )}
          {b.cocktail_needed && b.cocktail_start_time && (
            <Field
              l="Cocktail Hour"
              v={`${fmtTime(b.cocktail_start_time)}${b.cocktail_same_room == null ? '' : b.cocktail_same_room ? ' · same room as reception' : ' · separate room'}`}
            />
          )}
          <Field l={(b.ceremony_needed && b.ceremony_start_time) || (b.cocktail_needed && b.cocktail_start_time) ? 'Reception' : 'Time'} v={timeRange} />
        </div>

        {/* Venue */}
        {(b.venue_name || b.venue_address || venueType) && (
          <div style={section}>
            <span style={chip}>Venue</span>
            <Field l="Venue" v={b.venue_name} />
            {b.venue_address && (
              <div style={{ marginBottom: '.7rem' }}>
                <div style={label}>Address</div>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.venue_address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...value, color: '#00e0a4', textDecoration: 'underline' }}
                >
                  {b.venue_address}
                </a>
              </div>
            )}
            <Field l="Venue Type" v={venueType} />
          </div>
        )}

        {/* Host */}
        {(hostName || b.host_email || b.phone) && (
          <div style={section}>
            <span style={chip}>Host</span>
            <Field l="Host Name" v={hostName} />
            <Field l="Email" v={b.host_email} />
            <Field l="Phone" v={b.phone} />
          </div>
        )}

        {/* Package */}
        {(b.package_title || b.package_details || b.set_type || b.equipment) && (
          <div style={section}>
            <span style={chip}>Package</span>
            <Field l="Package" v={b.package_title} />
            <Field l="Includes" v={htmlToText(b.package_details) || null} />
            {!isClub ? null : <Field l="Set Type" v={b.set_type} />}
            <Field l="Equipment" v={b.equipment} />
          </div>
        )}

        {/* Pricing */}
        {price != null && (
          <div style={{ ...section, marginBottom: '1.2rem' }}>
            <span style={chip}>Pricing</span>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '.15rem 0' }}>
              <span style={{ color: '#d6d6e2', fontSize: '.84rem' }}>Price{b.tax_amount && b.tax_amount > 0 ? ' (before tax)' : ''}</span>
              <span style={{ fontFamily: "'Space Mono', monospace", color: '#fff', fontSize: '.9rem' }}>{money(price, currency)}</span>
            </div>
            {b.tax_amount != null && b.tax_amount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '.15rem 0' }}>
                <span style={{ color: '#d6d6e2', fontSize: '.84rem' }}>Sales Tax{b.tax_pct ? ` (${b.tax_pct}%)` : ''}</span>
                <span style={{ fontFamily: "'Space Mono', monospace", color: '#fff', fontSize: '.9rem' }}>{money(b.tax_amount, currency)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '.3rem 0 0', marginTop: '.3rem', borderTop: '1px solid rgba(255,255,255,.1)' }}>
              <span style={{ color: '#fff', fontWeight: 800, fontSize: '.9rem' }}>Total</span>
              <span style={{ fontFamily: "'Space Mono', monospace", color: '#00e0a4', fontWeight: 800, fontSize: '1rem' }}>{money(total, currency)}</span>
            </div>

            {/* Deposit / balance status. Paid shows a green "Paid"; an unpaid
                balance the host plans to settle in cash/check at the event shows
                that note instead. */}
            {(hasDeposit || balanceAtEvent || depositPaid || balancePaid) && (
              <div style={{ marginTop: '.7rem', paddingTop: '.6rem', borderTop: '1px solid rgba(255,255,255,.1)' }}>
                {hasDeposit && depositAmount != null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.2rem 0', gap: '.6rem' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem', minWidth: 0 }}>
                      <span style={{ color: '#d6d6e2', fontSize: '.84rem' }}>Deposit</span>
                      {depositPaid && <span style={paidPill}>Paid</span>}
                    </span>
                    <span style={{ fontFamily: "'Space Mono', monospace", color: '#fff', fontSize: '.9rem', whiteSpace: 'nowrap' }}>{money(depositAmount, currency)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.2rem 0', gap: '.6rem' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem', minWidth: 0, flexWrap: 'wrap' }}>
                    <span style={{ color: '#d6d6e2', fontSize: '.84rem' }}>Balance</span>
                    {balancePaid
                      ? <span style={paidPill}>Paid</span>
                      : balanceAtEvent && <span style={atEventPill}>{balanceAtEvent}</span>}
                  </span>
                  {balanceAmount != null && <span style={{ fontFamily: "'Space Mono', monospace", color: '#fff', fontSize: '.9rem', whiteSpace: 'nowrap' }}>{money(balanceAmount, currency)}</span>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <CardDownloadButton targetId="gdc-share-card" fileName={downloadName} />
      <div style={{ textAlign: 'center', color: '#5a5a72', fontSize: '.68rem', marginTop: '1rem' }}>
        Shared via Global DJ Connect · view only
      </div>
    </div>
  );
}
