'use client';

// PaymentMethodsSection — how a DJ tells us which ways a client can pay them.
//
// ─────────────────────────────────────────────────────────────────────────
// THE REDESIGN, AND WHY
//
// The first version made the DJ build the page before they could read it: an
// empty list, an "+ Add method" button, and a dropdown of types. To find out
// whether Cash App was even supported you had to add a row and open a select.
// Nothing was visible until you'd already committed to it, and the Stripe
// block sat on top explaining SSNs and payout timings to someone who only
// wanted to type a Venmo handle. It read as a form to survive rather than a
// choice to make.
//
// Now: every rail is on screen from the first paint, as a tile. Green check =
// active, clients can pay you this way today. Click one to expand it and fill
// it in. Nothing to add, nothing to discover, and the whole set is legible in a
// glance — which is the actual question a DJ has ("what can I offer?").
//
// ONE ROW PER TYPE. The stored shape is still an array, but the UI treats type
// as the key: nobody has two Venmos, and the old model let you create three
// half-filled ones. Duplicates already in the data collapse to the first.
//
// PRESENCE IS THE SWITCH. The old rows had an "Offer this to clients" checkbox
// on top of a handle field — two ways to say the same thing, which meant a DJ
// could type a handle and still not be offering it, with nothing on screen
// explaining why the client never saw it. Now: filled in = offered. Remove to
// stop.
// ─────────────────────────────────────────────────────────────────────────
//
// MANUAL rails: the platform never touches the money. We publish the DJ's
// handle to one client, for one payment, and the DJ confirms what actually
// arrived. No processing, no custody, no chargeback liability.
//
// CARDS are a different animal: no handle to type. The DJ connects their OWN
// Stripe account (Standard Connect, direct charges — they're merchant of
// record, they pay Stripe's 2.9% + 30¢, they own disputes) and availability is
// cached in users.stripe_connect_ready, not stored in payment_methods.
// Onboarding happens on Stripe's site via a single-use Account Link; this
// section only starts/resumes it and reads back the result.
//
// Self-contained: loads and saves users.payment_methods on its own, exactly
// like the email/password blocks. It does NOT go through the profile's master
// save, so a DJ can add a handle without touching the rest of the form.
//
// WHY ITS OWN COLUMN, NOT booking_settings:
// booking_settings is serialized to every visitor of a DJ's public profile —
// it already leaks the full promo-code list. Payment handles are a worse leak:
// scraping every DJ's Zelle email and Venmo handle builds a ready-made
// phishing list. Handles only ever reach a client via the token-authed pay
// page.
//
// THE TYPO PROBLEM (why the preview exists):
// Zelle and Venmo are irreversible. A mistyped handle sends a stranger real
// money, permanently, and no deploy claws it back. So the DJ is shown their
// own handle rendered exactly as the client will see it, before it can ever be
// used. That readback is the cheapest defense that exists.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './updateDjProfile.module.css';
import {
  CardNetworksMark, VenmoMark, CashAppMark, PaypalMark, ZelleMark, CashMark, CheckMark,
} from './BrandMarks';
import {
  METHOD_TYPES,
  TYPE_ORDER,
  displayHandle,
  cleanHandle,
  type PaymentMethod,
  type PaymentMethodType,
} from '@/lib/paymentMethods';

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `m${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
}

/** Card is a tile like the rest, but it isn't a payment_methods row. */
type TileKey = 'card' | PaymentMethodType;

/**
 * What /api/stripe/connect?action=status reports back.
 *
 * `actionNeeded` is the important one: charges_enabled:false means cards are
 * off, but it does NOT mean the DJ did something wrong. Stripe may simply be
 * verifying. Conflating those two produced a "Finish setup" button that
 * looped forever on an account with nothing left to finish.
 */
interface CardState {
  connected: boolean;
  ready: boolean;
  detailsSubmitted: boolean;
  actionNeeded: boolean;
  currentlyDue: string[];
  pastDue: string[];
  pendingVerification: string[];
  disabledReason: string | null;
  payoutsEnabled: boolean;
}

const DISCONNECTED: CardState = {
  connected: false, ready: false, detailsSubmitted: false, actionNeeded: false,
  currentlyDue: [], pastDue: [], pendingVerification: [], disabledReason: null,
  payoutsEnabled: false,
};

/**
 * Stripe names requirements for engineers: "individual.verification.document".
 * A DJ reading that has no idea they need to photograph a driving licence.
 */
function prettyRequirement(field: string): string {
  const MAP: Record<string, string> = {
    'external_account': 'Bank account for payouts',
    'individual.verification.document': 'Photo ID',
    'individual.verification.additional_document': 'A second proof of identity',
    'individual.id_number': 'Social Security number',
    'individual.ssn_last_4': 'Last 4 of your SSN',
    'individual.dob.day': 'Date of birth',
    'individual.dob.month': 'Date of birth',
    'individual.dob.year': 'Date of birth',
    'individual.address.line1': 'Home address',
    'individual.address.city': 'Home address',
    'individual.address.postal_code': 'Home address',
    'individual.address.state': 'Home address',
    'individual.first_name': 'Your first name',
    'individual.last_name': 'Your last name',
    'individual.email': 'Email address',
    'individual.phone': 'Phone number',
    'business_profile.url': 'Your website (your Global DJ Connect profile URL works)',
    'business_profile.mcc': 'What kind of business you run',
    'business_profile.product_description': 'A description of what you sell',
    'tos_acceptance.date': 'Accept Stripe’s terms',
    'tos_acceptance.ip': 'Accept Stripe’s terms',
    'settings.dashboard.display_name': 'A public business name',
  };
  if (MAP[field]) return MAP[field];
  const tail = field.split('.').pop() || field;
  const words = tail.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Tile faces — the real marks, in each brand's own colour.
 *
 * A DJ scanning this grid recognises the Venmo blue before they've read a word;
 * that's the entire job of the tile. Emoji stand-ins made them all read as
 * generic coloured dots, which is the opposite.
 */
const TILE_MARK: Partial<Record<TileKey, (p: { size?: number }) => React.ReactElement>> = {
  card: CardNetworksMark,
  venmo: VenmoMark,
  cashapp: CashAppMark,
  paypal: PaypalMark,
  zelle: ZelleMark,
  cash: CashMark,
  check: CheckMark,
};

/**
 * The tiles, in order. 'other' is deliberately NOT here: a free-text "describe
 * how to pay me" box is the one rail we can't validate, can't link, can't QR
 * and can't explain to a client — every other tile earns its place by doing at
 * least one of those. Existing 'other' rows are still saved and still shown to
 * clients; they just can't be created any more.
 */
const TILE_ORDER: TileKey[] = ['card', ...TYPE_ORDER.filter((t) => t !== 'other')];

const TILE_LABEL: Record<TileKey, string> = {
  card: 'Card',
  venmo: 'Venmo',
  cashapp: 'Cash App',
  paypal: 'PayPal',
  zelle: 'Zelle',
  cash: 'Cash',
  check: 'Check',
  other: 'Other',
};

/**
 * Only Card gets a subtitle, because only Card needs one: four network logos
 * don't say where the money goes, and "via Stripe Connect" is the answer to
 * the question they raise.
 *
 * The rest had blurbs describing their quirks — "Phone only", "Copy by hand".
 * True, but that's a caveat, and a grid of caveats reads as a list of reasons
 * not to bother. The quirks belong in the expanded panel, where the DJ has
 * actually chosen the rail and the hint can be a full sentence instead of two
 * words. A logo and a name is all a tile owes anyone.
 */
const TILE_BLURB: Partial<Record<TileKey, string>> = {
  card: 'via Stripe Connect',
};

/**
 * Per-tile mark size. Not one number: these are different KINDS of mark.
 * Venmo's is a wordmark — five letters squeezed into the same 24px box that
 * holds Cash App's single $ glyph, so at a shared size it renders half as
 * legible. Card is four marks in a row and needs the opposite treatment.
 */
const TILE_MARK_SIZE: Partial<Record<TileKey, number>> = {
  card: 14,
  venmo: 40,
  paypal: 30,
};
const DEFAULT_MARK_SIZE = 24;

export default function PaymentMethodsSection({ userId }: { userId: string }) {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);
  const [openTile, setOpenTile] = useState<TileKey | null>(null);

  // ── Stripe Connect (cards) ────────────────────────────────────────
  const [card, setCard] = useState<CardState | null>(null);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardErr, setCardErr] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  // The DJ's number from their account. Cash needs a phone, and they've
  // already given us one — asking them to type it again is asking them to
  // maintain the same fact in two places, which is how one of them goes stale.
  const [accountPhone, setAccountPhone] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // Drop-off starts collapsed. Most DJs don't have an office, and two more
  // fields on a rail whose whole point is "hand me the money" is noise for them.
  const [showDropoff, setShowDropoff] = useState(false);

  const loadCardStatus = useCallback(async (): Promise<CardState> => {
    const res = await fetch('/api/stripe/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status' }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      connected?: boolean; ready?: boolean; detailsSubmitted?: boolean;
      actionNeeded?: boolean; currentlyDue?: string[]; pastDue?: string[];
      pendingVerification?: string[]; disabledReason?: string | null;
      payoutsEnabled?: boolean;
    };
    return {
      connected: !!json.connected,
      ready: !!json.ready,
      detailsSubmitted: !!json.detailsSubmitted,
      actionNeeded: !!json.actionNeeded,
      currentlyDue: Array.isArray(json.currentlyDue) ? json.currentlyDue : [],
      pastDue: Array.isArray(json.pastDue) ? json.pastDue : [],
      pendingVerification: Array.isArray(json.pendingVerification) ? json.pendingVerification : [],
      disabledReason: json.disabledReason ?? null,
      payoutsEnabled: !!json.payoutsEnabled,
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await loadCardStatus();
        if (!cancelled) setCard(next);
      } catch {
        if (!cancelled) setCard(DISCONNECTED);
      }
    })();
    return () => { cancelled = true; };
  }, [loadCardStatus]);

  async function refreshCard() {
    if (cardBusy) return;
    setCardBusy(true);
    setCardErr(null);
    try {
      const next = await loadCardStatus();
      setCard(next);
      if (!next.ready && !next.actionNeeded) {
        setCardErr('Still verifying — nothing has changed on Stripe’s side yet.');
        setTimeout(() => setCardErr(null), 4000);
      }
    } catch (e) {
      setCardErr(e instanceof Error ? e.message : 'Could not check status.');
    } finally {
      setCardBusy(false);
    }
  }

  // Reads .text() before parsing: a non-JSON body (a platform error page) would
  // otherwise collapse to {} and surface as a generic shrug. That exact line of
  // defensive code hid a real Stripe error behind "Could not start Stripe
  // onboarding." for hours.
  async function connectStripe() {
    if (cardBusy) return;
    setCardBusy(true);
    setCardErr(null);
    try {
      const res = await fetch('/api/stripe/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      const raw = await res.text();
      let json: { url?: string; error?: string } = {};
      let parsed = false;
      try { json = JSON.parse(raw); parsed = true; } catch { /* raw is the evidence */ }
      if (!parsed) {
        const snippet = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
        throw new Error(`HTTP ${res.status} — server sent ${raw.length} bytes of non-JSON${snippet ? `: ${snippet}` : ' (empty body)'}`);
      }
      if (!res.ok || !json.url) throw new Error(json.error || `HTTP ${res.status} — no URL and no error field.`);
      window.location.href = json.url;
    } catch (e) {
      const msg = e instanceof TypeError
        ? `Request failed before any reply arrived (${e.message}).`
        : e instanceof Error ? e.message : 'Could not start Stripe onboarding.';
      setCardErr(msg);
      setCardBusy(false);
    }
  }

  async function disconnectStripe() {
    if (cardBusy) return;
    if (!window.confirm('Stop accepting cards? Your Stripe account itself is untouched — this only unlinks it here. You can reconnect any time.')) return;
    setCardBusy(true);
    setCardErr(null);
    try {
      const res = await fetch('/api/stripe/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disconnect' }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || 'Could not disconnect.');
      setCard(DISCONNECTED);
    } catch (e) {
      setCardErr(e instanceof Error ? e.message : 'Could not disconnect.');
    } finally {
      setCardBusy(false);
    }
  }

  // ── Load saved rails + the DJ's slug ──────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('users')
          .select('payment_methods, slug, phone')
          .eq('id', userId)
          .maybeSingle();
        if (cancelled) return;
        const row = data as { payment_methods?: unknown; slug?: string | null; phone?: string | null } | null;
        setSlug(typeof row?.slug === 'string' ? row.slug : null);
        setAccountPhone(typeof row?.phone === 'string' && row.phone.trim() ? row.phone.trim() : null);
        const raw = row?.payment_methods;
        const arr = Array.isArray(raw) ? raw : [];
        setMethods(
          arr.map((r) => {
            const o = (r || {}) as Partial<PaymentMethod>;
            return {
              id: o.id || newId(),
              type: (TYPE_ORDER.includes(o.type as PaymentMethodType) ? o.type : 'zelle') as PaymentMethodType,
              handle: typeof o.handle === 'string' ? o.handle : '',
              note: typeof o.note === 'string' ? o.note : '',
              enabled: o.enabled !== false,
              contact: typeof o.contact === 'string' ? o.contact : undefined,
              dropoffAddress: typeof o.dropoffAddress === 'string' ? o.dropoffAddress : undefined,
              dropoffHours: typeof o.dropoffHours === 'string' ? o.dropoffHours : undefined,
            };
          }),
        );
      } catch {
        // Non-fatal — an empty list is a valid state (no methods yet).
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // One row per type. Old data may hold duplicates from the add-a-row era;
  // the first wins and the rest are dropped on next save.
  const byType = useMemo(() => {
    const m: Partial<Record<PaymentMethodType, PaymentMethod>> = {};
    for (const x of methods) if (!m[x.type]) m[x.type] = x;
    return m;
  }, [methods]);

  /** Live = filled in and valid. This is exactly what the client will see. */
  const isLive = useCallback((t: PaymentMethodType): boolean => {
    const m = byType[t];
    if (!m || !m.enabled) return false;
    if (METHOD_TYPES[t].validate(m.handle || '')) return false;
    // Both halves, or it isn't live. A green dot on a Cash rail with a number
    // and no name would promise the client something the email can't deliver.
    const vc = METHOD_TYPES[t].validateContact;
    return vc ? !vc(m.contact || '') : true;
  }, [byType]);

  const tileLive = (k: TileKey): boolean => (k === 'card' ? !!card?.ready : isLive(k));

  function patchType(t: PaymentMethodType, next: Partial<PaymentMethod>) {
    setFeedback(null);
    setMethods((prev) => {
      const i = prev.findIndex((m) => m.type === t);
      if (i === -1) {
        return [...prev, { id: newId(), type: t, handle: '', note: '', enabled: true, ...next }];
      }
      const copy = [...prev];
      copy[i] = { ...copy[i], ...next };
      return copy;
    });
  }

  function removeType(t: PaymentMethodType) {
    setFeedback(null);
    setMethods((prev) => prev.filter((m) => m.type !== t));
    setOpenTile(null);
  }

  const firstError = (TYPE_ORDER
    .map((t) => {
      const m = byType[t];
      if (!m || !m.enabled) return null;
      // A row that exists but is entirely empty is a tile the DJ opened and
      // walked away from — not an error to shout about. It's dropped on save.
      if (!(m.handle || '').trim() && METHOD_TYPES[t].handleLabel) return null;
      const e = METHOD_TYPES[t].validate(m.handle || '');
      if (e) return e;
      // A phone with no name is half a Cash rail: the client rings a stranger
      // and says "...hi?". Both halves or neither.
      const vc = METHOD_TYPES[t].validateContact;
      return vc ? vc(m.contact || '') : null;
    })
    .find((e) => e)) || null;

  async function save() {
    if (firstError) {
      setFeedback({ msg: firstError, ok: false });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const supabase = createClient();
      // Only real, filled-in rails get written. An opened-but-empty tile
      // vanishes rather than persisting as a broken option a client could see.
      const clean = TYPE_ORDER
        .map((t) => byType[t])
        .filter((m): m is PaymentMethod => !!m)
        .filter((m) => METHOD_TYPES[m.type].handleLabel === '' || !!cleanHandle(m))
        .map((m) => ({
          id: m.id,
          type: m.type,
          handle: cleanHandle(m),
          note: (m.note || '').trim(),
          enabled: true,
          // Only written when the rail actually has a second field, so a Venmo
          // row doesn't carry a stray empty `contact` forever.
          ...(METHOD_TYPES[m.type].contactLabel ? { contact: (m.contact || '').trim() } : {}),
          // Cash-only, and only when the DJ actually filled one in — an empty
          // string here would make cashDropoff() think there's an address.
          ...(m.type === 'cash' && (m.dropoffAddress || '').trim()
            ? {
                dropoffAddress: (m.dropoffAddress || '').trim(),
                dropoffHours: (m.dropoffHours || '').trim(),
              }
            : {}),
        }));
      const { error } = await supabase
        .from('users')
        .update({ payment_methods: clean } as unknown as never)
        .eq('id', userId);
      if (error) throw error;
      setMethods(clean);
      setFeedback({ msg: '✓ Saved.', ok: true });
      setTimeout(() => setFeedback(null), 2500);
    } catch (e) {
      setFeedback({ msg: e instanceof Error ? e.message : 'Could not save.', ok: false });
    } finally {
      setSaving(false);
    }
  }

  // Field titles are white. They name what you're being asked for — the one
  // thing you have to read to fill the form in — and muted grey put them below
  // the placeholder text they're labelling.
  const label: React.CSSProperties = {
    fontFamily: "'Space Mono', monospace",
    fontSize: '.6rem',
    letterSpacing: '.08em',
    textTransform: 'uppercase',
    color: 'var(--white)',
    marginBottom: '.35rem',
    display: 'block',
  };
  const field: React.CSSProperties = {
    width: '100%',
    background: 'var(--deep)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: 'var(--white)',
    padding: '.55rem .75rem',
    fontFamily: "'DM Sans', sans-serif",
    fontSize: '.88rem',
    outline: 'none',
  };
  const btn = (primary: boolean, enabled = true): React.CSSProperties => ({
    fontFamily: "'Space Mono', monospace",
    fontSize: '.65rem',
    letterSpacing: '.08em',
    textTransform: 'uppercase',
    padding: '.6rem 1.2rem',
    borderRadius: 6,
    border: primary ? 'none' : '1px solid var(--border)',
    background: primary ? 'var(--neon)' : 'transparent',
    color: primary ? 'var(--black)' : 'var(--muted)',
    fontWeight: primary ? 700 : 400,
    cursor: enabled ? 'pointer' : 'default',
    opacity: enabled ? 1 : 0.45,
  });

  if (!loaded) {
    return (
      <div className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Payment Methods</div>
        </div>
        <div className={styles.sectionBody}>
          <p className={styles.bodyHint}>Loading…</p>
        </div>
      </div>
    );
  }

  const liveCount = TILE_ORDER.filter(tileLive).length;

  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>Payment Methods</div>
      </div>
      <div className={styles.sectionBody}>
        <p className={styles.bodyHint}>
          Pick the ways you want to get paid. Clients choose whichever suits
          them — you&apos;re never handcuffing them to one. Money goes straight
          to you; Global DJ Connect never touches it and takes no cut.
        </p>

        {/* ── The rails, all of them, from the first paint ──────────── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))',
            gap: '.5rem',
            margin: '1rem 0 .25rem',
          }}
        >
          {TILE_ORDER.map((k) => {
            const live = tileLive(k);
            const open = openTile === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setOpenTile(open ? null : k)}
                style={{
                  position: 'relative',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  padding: '.7rem .4rem .6rem',
                  borderRadius: 8,
                  // Green frame + green dot = live. NOTHING else changes.
                  // A green wash behind the tile as well was a third signal for
                  // the same fact, and it tinted the brand marks sitting on top
                  // of it — the one thing on the tile that has to stay true to
                  // itself. Frame and dot say the state; the body stays out of it.
                  border: live
                    ? '1.5px solid var(--neon)'
                    : `1px solid ${open ? 'rgba(255,255,255,.4)' : 'var(--border)'}`,
                  background: open ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.02)',
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                <span
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    height: 30,
                    // Always full colour, live or not. Greying the unset ones
                    // made the grid read as "these are broken" rather than
                    // "these are available" — and a DJ recognises Venmo by its
                    // blue, which is the one thing greyscale takes away. The
                    // frame and the dot carry the state; the logo is just the
                    // logo.
                  }}
                >
                  {TILE_MARK[k]?.({ size: TILE_MARK_SIZE[k] ?? DEFAULT_MARK_SIZE })}
                </span>
                <span style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--white)' }}>{TILE_LABEL[k]}</span>
                {/* Only Card has one — don't leave an empty line reserving
                    space under every other tile. */}
                {TILE_BLURB[k] && (
                  <span style={{ fontSize: '.6rem', color: 'var(--muted)', lineHeight: 1.3 }}>{TILE_BLURB[k]}</span>
                )}
                {/* The dot is the whole point of the grid: what can a client
                    actually use right now, without opening anything. */}
                {live && (
                  <span
                    aria-label="Active"
                    style={{
                      position: 'absolute', top: 5, right: 5, width: 14, height: 14,
                      borderRadius: '50%', background: 'var(--neon)',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {/* A check, not a dot. A dot is a colour you have to be
                        taught to read; a tick means done in every interface
                        anyone has ever used. Same badge the booking pipeline
                        puts on a finished step, so the two agree. */}
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#06231b" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* The green check on each live tile says this already — a line
            underneath restating it in words was the caption to a picture that
            didn't need one. Kept only for the empty state, where there's
            nothing green to read yet. */}
        {liveCount === 0 && (
          <p style={{ ...label, textTransform: 'none', letterSpacing: 0, fontSize: '.72rem', marginBottom: '1rem' }}>
            Nothing live yet — tap one to set it up.
          </p>
        )}

        {/* ── The expanded rail ────────────────────────────────────── */}
        {openTile === 'card' && (
          <div style={{ padding: '.9rem', border: '1px solid var(--border)', borderRadius: 8, background: 'rgba(255,255,255,.02)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
              <span style={{ fontWeight: 700, color: 'var(--white)', fontSize: '.9rem' }}>Card payments</span>
              <span
                style={{
                  ...label, marginBottom: 0,
                  color: card === null ? 'var(--muted)' : card.ready ? 'var(--success)' : card.connected ? '#f5a623' : 'var(--muted)',
                }}
              >
                {card === null
                  ? 'Checking…'
                  : card.ready
                    ? '● Accepting cards'
                    : card.connected
                      ? (card.actionNeeded ? '● Setup incomplete' : '● Verifying')
                      : '○ Not connected'}
              </span>
            </div>

            <p className={styles.bodyHint} style={{ margin: '0 0 .6rem' }}>
              Clients pay by debit or credit card, straight into your own Stripe
              account. The fee is yours: 2.9% + 30¢ per charge. Stripe asks for
              your SSN and bank details during setup, and your{' '}
              <strong style={{ color: 'var(--white)', fontWeight: 600 }}>first payout takes 7–14 days</strong> —
              about 2 days after that. It&apos;s the only option that works the same
              on desktop and mobile, and it confirms itself — no &quot;did it land?&quot; step.
            </p>

            {card !== null && !card.ready && (
              <div style={{ marginBottom: '.7rem' }}>
                <button
                  type="button"
                  onClick={() => setShowHelp((v) => !v)}
                  style={{
                    background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                    color: 'var(--neon)', fontSize: '.72rem', fontFamily: "'Space Mono', monospace",
                    letterSpacing: '.04em', textDecoration: 'underline',
                  }}
                >
                  {showHelp ? 'Hide the answers' : 'What will Stripe ask me?'}
                </button>

                {showHelp && (
                  <div style={{ marginTop: '.6rem', padding: '.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(0,0,0,.25)' }}>
                    <p style={{ margin: '0 0 .6rem', fontSize: '.72rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                      Stripe asks for your SSN and bank details because anyone taking
                      card payments has to be identity-checked by law — PayPal and
                      Venmo do the same. It goes to Stripe, not to us. The questions
                      that catch people out:
                    </p>
                    <div style={{ marginBottom: '.6rem' }}>
                      <div style={{ ...label, marginBottom: '.25rem' }}>Business website</div>
                      {slug ? (
                        <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <code style={{ fontFamily: "'Space Mono', monospace", fontSize: '.72rem', color: 'var(--white)', background: 'var(--deep)', padding: '.3rem .5rem', borderRadius: 4, wordBreak: 'break-all' }}>
                            {`https://globaldjconnect.com/${slug}`}
                          </code>
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard.writeText(`https://globaldjconnect.com/${slug}`);
                              setCopied(true);
                              setTimeout(() => setCopied(false), 1800);
                            }}
                            style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, color: copied ? 'var(--success)' : 'var(--muted)', fontSize: '.65rem', padding: '.3rem .55rem', cursor: 'pointer', fontFamily: "'Space Mono', monospace" }}
                          >
                            {copied ? '✓ Copied' : 'Copy'}
                          </button>
                        </div>
                      ) : (
                        <p style={{ margin: 0, fontSize: '.72rem', color: 'var(--white)' }}>Your Global DJ Connect profile URL.</p>
                      )}
                      <p style={{ margin: '.25rem 0 0', fontSize: '.68rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                        No website? Use this. It&apos;s a real public page showing your
                        services and prices — exactly what Stripe wants to see.
                      </p>
                    </div>
                    <div style={{ marginBottom: '.6rem' }}>
                      <div style={{ ...label, marginBottom: '.25rem' }}>Type of business</div>
                      <p style={{ margin: 0, fontSize: '.72rem', color: 'var(--white)', lineHeight: 1.5 }}>
                        Individual — unless you actually have an LLC, in which case use
                        it and have the EIN handy.
                      </p>
                    </div>
                    <div style={{ marginBottom: '.6rem' }}>
                      <div style={{ ...label, marginBottom: '.25rem' }}>Industry</div>
                      <p style={{ margin: 0, fontSize: '.72rem', color: 'var(--white)', lineHeight: 1.5 }}>
                        Search &quot;DJ&quot; or &quot;band&quot; — the entertainment category for
                        musicians and entertainers is the one you want.
                      </p>
                    </div>
                    <div style={{ marginBottom: '.6rem' }}>
                      <div style={{ ...label, marginBottom: '.25rem' }}>What you sell</div>
                      <p style={{ margin: 0, fontSize: '.72rem', color: 'var(--white)', lineHeight: 1.5 }}>
                        &quot;DJ services for weddings, parties and private events.&quot;
                      </p>
                    </div>
                    <div>
                      <div style={{ ...label, marginBottom: '.25rem' }}>Statement descriptor</div>
                      <p style={{ margin: 0, fontSize: '.72rem', color: 'var(--white)', lineHeight: 1.5 }}>
                        Your DJ name. This is what shows on your client&apos;s card statement
                        — make it something they&apos;ll recognise, or you&apos;ll get
                        &quot;what&apos;s this charge?&quot; calls and chargebacks.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {card !== null && !card.connected && (
              <button type="button" onClick={() => void connectStripe()} disabled={cardBusy} style={btn(true, !cardBusy)}>
                {cardBusy ? 'Opening Stripe…' : 'Connect Stripe to accept cards'}
              </button>
            )}

            {card !== null && card.connected && !card.ready && (
              <div>
                <p style={{ margin: '0 0 .5rem', fontSize: '.72rem', color: '#f5a623', lineHeight: 1.45 }}>
                  {card.actionNeeded
                    ? 'Stripe still needs a few details before cards can be switched on.'
                    : card.disabledReason && card.disabledReason.startsWith('rejected')
                      ? 'Stripe has declined this account. Contact Stripe support — nothing on this page can change it.'
                      : 'Everything’s submitted. Stripe is verifying it now — usually minutes, occasionally a day. Nothing for you to do; cards switch on by themselves.'}
                </p>
                {card.actionNeeded && card.currentlyDue.length > 0 && (
                  <ul style={{ margin: '0 0 .6rem', paddingLeft: '1.1rem', color: 'var(--muted)', fontSize: '.7rem', lineHeight: 1.6 }}>
                    {card.currentlyDue.slice(0, 6).map((f) => (
                      <li key={f}>{prettyRequirement(f)}</li>
                    ))}
                  </ul>
                )}
                <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {card.actionNeeded ? (
                    <button type="button" onClick={() => void connectStripe()} disabled={cardBusy} style={btn(true, !cardBusy)}>
                      {cardBusy ? 'Opening Stripe…' : 'Finish Stripe setup'}
                    </button>
                  ) : (
                    <button type="button" onClick={() => void refreshCard()} disabled={cardBusy} style={btn(true, !cardBusy)}>
                      {cardBusy ? 'Checking…' : 'Check again'}
                    </button>
                  )}
                  <button type="button" onClick={() => void disconnectStripe()} disabled={cardBusy} style={btn(false, !cardBusy)}>
                    Disconnect
                  </button>
                </div>
              </div>
            )}

            {card !== null && card.ready && (
              <div style={{ display: 'flex', gap: '.8rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '.78rem', color: 'var(--white)' }}>
                  ✓ Connected — clients see &quot;Pay with Card&quot; on deposits and invoices.
                </span>
                <button
                  type="button"
                  onClick={() => void disconnectStripe()}
                  disabled={cardBusy}
                  style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: '.72rem', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  Disconnect
                </button>
              </div>
            )}

            {cardErr && (
              <p style={{ margin: '.5rem 0 0', fontSize: '.72rem', color: '#ff6b6b', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>
                {cardErr}
              </p>
            )}
          </div>
        )}

        {openTile !== null && openTile !== 'card' && (() => {
          const t = openTile;
          const cfg = METHOD_TYPES[t];
          const m = byType[t] || { id: 'draft', type: t, handle: '', note: '', enabled: true };
          // Shown errors only appear once the DJ has typed something — nobody
          // wants to be told a field is required before they've touched it.
          const err = (m.handle || '').trim() || !cfg.handleLabel ? cfg.validate(m.handle || '') : null;
          const contactErr = cfg.validateContact && (m.contact || '').trim()
            ? cfg.validateContact(m.contact || '')
            : null;
          // Whether it COULD go live — evaluated against the real values, not
          // against whether we're currently showing a complaint. An empty tile
          // has no visible error and still isn't activatable.
          const complete = !cfg.validate(m.handle || '')
            && (!cfg.validateContact || !cfg.validateContact(m.contact || ''));
          const shown = cleanHandle(m) ? displayHandle(m) : '';
          return (
            <div style={{ padding: '.9rem', border: '1px solid var(--border)', borderRadius: 8, background: 'rgba(255,255,255,.02)' }}>
              <div style={{ fontWeight: 700, color: 'var(--white)', fontSize: '.9rem', marginBottom: '.4rem' }}>{cfg.label}</div>
              {/* White, not muted: this is the rail's actual behaviour — what
                  the client will have to do, what it costs, what it can't do.
                  Greying it made the one paragraph that answers "should I use
                  this?" read as fine print. */}
              <p className={styles.bodyHint} style={{ margin: '0 0 .7rem', color: 'var(--white)' }}>{cfg.hint}</p>

              {cfg.handleLabel ? (
                <>
                  <label style={label}>{cfg.handleLabel}</label>
                  <input
                    autoFocus
                    value={m.handle}
                    placeholder={cfg.placeholder}
                    onChange={(e) => patchType(t, { handle: e.target.value })}
                    style={{ ...field, borderColor: err ? '#ff6b6b' : 'var(--border)' }}
                  />
                  {err && <p style={{ margin: '.3rem 0 0', color: '#ff6b6b', fontSize: '.72rem' }}>{err}</p>}

                  {/* Offered, not auto-filled. Silently writing their account
                      number into a field they didn't touch means they can't
                      tell what's saved from what's suggested — and a DJ may
                      well want clients calling a different number than the one
                      we text them on. One tap if it's the same, ignorable if
                      it isn't. */}
                  {t === 'cash' && accountPhone && cleanHandle(m) !== accountPhone && (
                    <button
                      type="button"
                      onClick={() => patchType(t, { handle: accountPhone })}
                      style={{
                        marginTop: '.35rem', background: 'transparent', border: 'none', padding: 0,
                        color: 'var(--neon)', fontSize: '.7rem', cursor: 'pointer',
                        fontFamily: "'Space Mono', monospace", textDecoration: 'underline',
                      }}
                    >
                      Use my account number ({accountPhone})
                    </button>
                  )}

                  {/* The readback exists for the IRREVERSIBLE rails: a mistyped
                      Zelle or Venmo handle sends a stranger real money and no
                      deploy claws it back, so the DJ sees their own handle
                      exactly as the client will, before it can be used.
                      Cash is not that. A phone number costs a wrong call, not
                      $600, and the client already sees it spelled out in the
                      "Reach out to…" line. Showing it twice made a safety net
                      into clutter. */}
                  {shown && !err && t !== 'cash' && (
                    <div style={{ marginTop: '.6rem', padding: '.5rem .6rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--deep)' }}>
                      <div style={{ ...label, marginBottom: '.2rem' }}>Client sees</div>
                      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.85rem', color: 'var(--neon)', wordBreak: 'break-all' }}>
                        {cfg.label}: {shown}
                      </div>
                    </div>
                  )}

                  {/* Second field, where the rail has one. Cash: who to ask
                      for. A client holding $600 at a venue they've never been
                      to needs a name as much as a number — "call this number"
                      gets them a stranger saying "who?". */}
                  {cfg.contactLabel && (
                    <>
                      <label style={{ ...label, marginTop: '.7rem' }}>{cfg.contactLabel}</label>
                      <input
                        value={m.contact || ''}
                        placeholder={cfg.contactPlaceholder}
                        onChange={(e) => patchType(t, { contact: e.target.value })}
                        style={{ ...field, borderColor: contactErr ? '#ff6b6b' : 'var(--border)' }}
                      />
                      {contactErr && <p style={{ margin: '.3rem 0 0', color: '#ff6b6b', fontSize: '.72rem' }}>{contactErr}</p>}
                    </>
                  )}

                  {/* Drop-off — cash only, and behind a button because most DJs
                      don't have an office. Two fields, not one: an address with
                      no hours sends a client across town to a locked door, and
                      a client who does that once pays at the event forever. */}
                  {t === 'cash' && (
                    <div style={{ marginTop: '.7rem' }}>
                      {!showDropoff && !(m.dropoffAddress || '').trim() ? (
                        <button
                          type="button"
                          onClick={() => setShowDropoff(true)}
                          style={{
                            background: 'transparent', border: '1px solid var(--border)',
                            borderRadius: 6, color: 'var(--muted)', fontSize: '.68rem',
                            padding: '.45rem .8rem', cursor: 'pointer',
                            fontFamily: "'Space Mono', monospace", letterSpacing: '.06em',
                            textTransform: 'uppercase',
                          }}
                        >
                          + Add office address for drop-off
                        </button>
                      ) : (
                        <>
                          <label style={label}>Office address (optional)</label>
                          <input
                            value={m.dropoffAddress || ''}
                            placeholder="123 Main St, Staten Island, NY 10307"
                            onChange={(e) => patchType(t, { dropoffAddress: e.target.value })}
                            style={field}
                          />
                          <label style={{ ...label, marginTop: '.7rem' }}>Open hours (optional)</label>
                          <input
                            value={m.dropoffHours || ''}
                            placeholder="Mon–Fri 10am–6pm"
                            onChange={(e) => patchType(t, { dropoffHours: e.target.value })}
                            style={field}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              patchType(t, { dropoffAddress: '', dropoffHours: '' });
                              setShowDropoff(false);
                            }}
                            style={{
                              marginTop: '.4rem', background: 'transparent', border: 'none', padding: 0,
                              color: 'var(--muted)', fontSize: '.68rem', cursor: 'pointer',
                              textDecoration: 'underline', fontFamily: "'Space Mono', monospace",
                            }}
                          >
                            Remove drop-off address
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {/* Check already tells the client everything: who to make it
                      out to, where to send it, and what to include. A third
                      free-text box invites a DJ to repeat one of those in
                      slightly different words, and then the two can disagree. */}
                  {t !== 'check' && t !== 'cash' && t !== 'cashapp' && t !== 'paypal' && (
                    <>
                      <label style={{ ...label, marginTop: '.7rem' }}>Note to client (optional)</label>
                      <input
                        value={m.note}
                        placeholder="e.g. Put the reference code in the memo"
                        onChange={(e) => patchType(t, { note: e.target.value })}
                        style={field}
                      />
                    </>
                  )}
                </>
              ) : (
                <p style={{ margin: 0, color: 'var(--white)', fontSize: '.82rem' }}>
                  Nothing to fill in — turn it on and clients will see it as an option.
                </p>
              )}

              {/* Close left, Activate right. The primary action sits where the
                  eye lands last after reading the fields, and the way out is
                  where a way out belongs — not sharing an edge with the button
                  that commits. */}
              {cfg.footnote && (<p style={{ margin: '.9rem 0 0', fontSize: '.68rem', color: 'var(--muted)', lineHeight: 1.5 }}>{cfg.footnote}</p>)}<div style={{ display: 'flex', gap: '.6rem', marginTop: '.9rem', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setOpenTile(null)} style={btn(false)}>
                  Close
                </button>
                {byType[t] && (
                  <button type="button" onClick={() => removeType(t)} style={btn(false)}>
                    Remove
                  </button>
                )}
                {/* Disabled until the rail would actually work. Before this,
                    Activate on an empty tile ran the save, dropped the empty
                    row on the floor (the save filters them out), and reported
                    "✓ Saved" — so the DJ walked away believing Zelle was on
                    when their clients would never see it. A button that lies
                    about succeeding is worse than one that won't press. */}
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving || !complete}
                  title={complete ? undefined : 'Fill in the fields above first'}
                  style={{ ...btn(!isLive(t), !saving && complete), marginLeft: 'auto' }}
                >
                  {saving ? 'Saving…' : isLive(t) ? 'Save' : 'Activate'}
                </button>
              </div>
            </div>
          );
        })()}

        {feedback && (
          <p style={{ margin: '.7rem 0 0', fontSize: '.75rem', color: feedback.ok ? 'var(--success)' : '#ff6b6b', lineHeight: 1.5 }}>
            {feedback.msg}
          </p>
        )}
      </div>
    </div>
  );
}
