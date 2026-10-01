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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createClient } from '@/lib/supabase/client';
import styles from './updateDjProfile.module.css';
import SectionBanner from './SectionBanner';
import PaypalConnectSection from './PaypalConnectSection';
import {
  CardNetworksMark, VenmoMark, CashAppMark, PaypalMark, ZelleMark, CashMark, CheckMark,
} from './BrandMarks';
import {
  METHOD_TYPES,
  TYPE_ORDER,
  displayHandle,
  cleanHandle,
  isLinkable,
  type PaymentMethod,
  type PaymentMethodType,
} from '@/lib/paymentMethods';
import { searchAddresses } from '../[slug]/mobileBookingForm';
import { COUNTRIES, COUNTRY_CODES_ADDR } from '../account-settings/helpers';
import { COUNTRY_FLAGS } from '../upcoming-bookings/shared';

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

export default function PaymentMethodsSection({ userId, currency, onDirtyChange, ownerHint }: { userId: string; currency?: string; onDirtyChange?: (dirty: boolean) => void; ownerHint?: boolean }) {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  // What's actually in the database, held separately from `methods` (the live
  // edits). The two are equal right after a load or a save; the moment the DJ
  // types, they diverge — and that divergence, per rail, is what tells Save
  // whether it has anything to do. Without it, Save on an untouched-but-live
  // rail runs a write that changes nothing and still says "✓ Saved", which
  // trains the DJ that the button is meaningless.
  const [savedMethods, setSavedMethods] = useState<PaymentMethod[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Owner-only gate. Payment options decide where money lands, so NO team
  // member (admin/manager/assistant) may edit them — whatever surface opened
  // this editor. When the caller already knows the acting role (the booking
  // dashboard does), it passes ownerHint so there's NO extra round-trip and
  // the lock (or editor) shows instantly. Otherwise we resolve it ourselves.
  const [isOwner, setIsOwner] = useState<boolean | null>(ownerHint ?? null);
  useEffect(() => {
    if (ownerHint !== undefined) { setIsOwner(ownerHint); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/me/role');
        const j = (await r.json().catch(() => ({}))) as { role?: string | null };
        if (!cancelled) setIsOwner(j?.role === 'owner');
      } catch {
        if (!cancelled) setIsOwner(false); // fail closed
      }
    })();
    return () => { cancelled = true; };
  }, [ownerHint]);
  const [saving, setSaving] = useState(false);
  // Set once the DJ clicks Save — turns the check night-of question red if it
  // was never answered (tri-state: yes / no / unanswered).
  const [attempted, setAttempted] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);
  const [openTile, setOpenTile] = useState<TileKey | null>(null);
  // Which tile is awaiting a "yes, remove" confirmation (Remove pop-up).
  const [confirmingRemove, setConfirmingRemove] = useState<PaymentMethodType | null>(null);
  // The confirm modal portals to document.body, which only exists on the client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  // Tiles the DJ has explicitly Removed this session — auto-fill leaves these
  // alone from then on, so Remove means blank and stays blank.
  const autofillOff = useRef<Set<PaymentMethodType>>(new Set());

  // When the DJ connects PayPal (Option 1), Option 2 (the manual PayPal.me /
  // email rail) is greyed out and made unclickable — Option 1 overrides it.
  const [paypalReady, setPaypalReady] = useState(false);

  // ── Stripe Connect (cards) ────────────────────────────────────────
  const [card, setCard] = useState<CardState | null>(null);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardErr, setCardErr] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  // The DJ's number from their account. Cash needs a phone, and they've
  // already given us one — asking them to type it again is asking them to
  // maintain the same fact in two places, which is how one of them goes stale.
  const [accountPhone, setAccountPhone] = useState<string | null>(null);
  // The DJ's ONE address, from account settings. Cash's drop-off and Check's
  // mailing address both default to this — enter it once, it shows everywhere —
  // and the invoice already reads the same users.address column, so the three
  // can't disagree. accountCountry biases the address autocomplete.
  const [accountAddress, setAccountAddress] = useState<string | null>(null);
  // The DJ's chosen currency (booking_settings.rate_currency) — used to warn
  // when a live rail can't accept it (Venmo/Zelle are USD-only, Cash App
  // US/UK). Default USD.
  const [rateCurrency, setRateCurrency] = useState<string>('USD');
  // When embedded in Booking Settings, the parent passes the live currency
  // (it updates the moment the DJ changes the dropdown, before any save), so the
  // mismatch warnings and blocked tiles react on the page. Wins over the value
  // this section self-loads on mount.
  useEffect(() => {
    if (typeof currency === 'string' && currency.trim()) {
      setRateCurrency(currency.trim().toUpperCase());
    }
  }, [currency]);

  // Returning from PayPal Connect onboarding (?paypal=connected), auto-expand
  // the PayPal tile so the DJ lands on the "Connected" state. This also mounts
  // PaypalConnectSection, which reads the same flag and then cleans the URL.
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get('paypal') === 'connected') {
        setOpenTile('paypal');
      }
    } catch { /* no-op */ }
  }, []);

  // Fetch PayPal connect status on mount so the tile grid shows the green
  // "active" check the moment the page loads — without waiting for the DJ to
  // open the PayPal tile (PaypalConnectSection only mounts once it's open).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/paypal/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status' }),
        });
        const json = (await res.json().catch(() => ({}))) as { ready?: boolean };
        if (!cancelled && res.ok) setPaypalReady(!!json.ready);
      } catch { /* no-op */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const [accountCountry, setAccountCountry] = useState<string>('United States');
  // Address autocomplete (shared — only one rail's address field is open at a
  // time). Same Nominatim-backed searchAddresses the booking form and account
  // settings use, so suggestions look identical wherever an address is typed.
  // Booking-form shape: the SAME searchAddresses the public booking page uses,
  // so the type-ahead here is byte-for-byte the one clients already know.
  type AddrSug = { display: string; lat: number | null; lon: number | null };
  const [addrSug, setAddrSug] = useState<AddrSug[]>([]);
  const [showAddrSug, setShowAddrSug] = useState(false);
  const addrTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
          .select('payment_methods, slug, phone, address, city, state, zip, country, booking_settings')
          .eq('id', userId)
          .maybeSingle();
        if (cancelled) return;
        const row = data as {
          payment_methods?: unknown; slug?: string | null; phone?: string | null;
          address?: string | null; city?: string | null; state?: string | null;
          zip?: string | null; country?: string | null; booking_settings?: unknown;
        } | null;
        setSlug(typeof row?.slug === 'string' ? row.slug : null);
        setAccountPhone(typeof row?.phone === 'string' && row.phone.trim() ? row.phone.trim() : null);
        // Compose exactly the way lib/receiptDocs builds the invoice's business
        // address: the full `address` string wins; older rows with only the
        // parts fall back to "city, ST zip". Empty => there's nothing to inherit.
        const composed = (typeof row?.address === 'string' && row.address.trim())
          ? row.address.trim()
          : [row?.city, [row?.state, row?.zip].filter(Boolean).join(' ')]
              .filter((x) => x && String(x).trim()).join(', ');
        setAccountAddress(composed.trim() || null);
        if (typeof row?.country === 'string' && row.country.trim()) setAccountCountry(row.country.trim());
        // rate_currency lives inside the booking_settings JSON (string or object).
        try {
          const bs = typeof row?.booking_settings === 'string'
            ? JSON.parse(row.booking_settings)
            : (row?.booking_settings || {});
          const rc = (bs as { rate_currency?: string })?.rate_currency;
          // Only seed from the DB when the parent isn't already driving currency.
          if (!currency && typeof rc === 'string' && rc.trim()) setRateCurrency(rc.trim().toUpperCase());
        } catch { /* leave USD */ }
        const raw = row?.payment_methods;
        const arr = Array.isArray(raw) ? raw : [];
        const mapped = arr.map((r) => {
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
            smsOk: typeof o.smsOk === 'boolean' ? o.smsOk : undefined,
            checkNightOf: typeof o.checkNightOf === 'boolean' ? o.checkNightOf : undefined,
            checkLeadWeeks: typeof o.checkLeadWeeks === 'number' ? o.checkLeadWeeks : undefined,
            checkPhone: typeof o.checkPhone === 'string' ? o.checkPhone : undefined,
            checkCall: o.checkCall === false ? false : undefined,
            checkText: o.checkText === false ? false : undefined,
            cashNightOf: typeof o.cashNightOf === 'boolean' ? o.cashNightOf : undefined,
            cashLeadWeeks: typeof o.cashLeadWeeks === 'number' ? o.cashLeadWeeks : undefined,
            checkMail: o.checkMail === false ? false : undefined,
            checkMeet: o.checkMeet === true ? true : undefined,
            checkOffice: o.checkOffice === true ? true : undefined,
          };
        });
        setMethods(mapped);
        setSavedMethods(mapped);
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

  // The same, but over the SAVED snapshot — the mirror of byType against what's
  // in the database.
  const savedByType = useMemo(() => {
    const m: Partial<Record<PaymentMethodType, PaymentMethod>> = {};
    for (const x of savedMethods) if (!m[x.type]) m[x.type] = x;
    return m;
  }, [savedMethods]);

  /**
   * Has THIS rail changed from what's saved? Compares only the fields a save
   * actually writes, trimmed the same way save() trims them — so trailing
   * whitespace the DJ didn't mean to add doesn't count as an edit, and a rail
   * that's byte-for-byte what's in the DB reports clean. Drives whether Save
   * has anything to do; when it's clean and already live, Save is inert.
   */
  const isDirty = useCallback((t: PaymentMethodType): boolean => {
    const cur = byType[t];
    const saved = savedByType[t];
    const norm = (m: PaymentMethod) => [
      cleanHandle(m),
      (m.note || '').trim(),
      (m.contact || '').trim(),
      (m.dropoffAddress || '').trim(),
      (m.dropoffHours || '').trim(),
      m.smsOk === false ? '0' : '1',
      m.checkNightOf ? '1' : '0',
      String(m.checkLeadWeeks ?? ''),
      (m.checkPhone || '').trim(),
      m.checkCall === false ? '0' : '1',
      m.checkText === false ? '0' : '1',
      m.cashNightOf === undefined ? '' : (m.cashNightOf ? '1' : '0'),
      String(m.cashLeadWeeks ?? ''),
      m.checkMail === false ? '0' : '1',
      m.checkMeet === true ? '1' : '0',
      m.checkOffice === true ? '1' : '0',
    ].join('\u0000');
    // Present now but not saved: only a real change if the rail actually has
    // content save() would keep. An opened-but-empty handle tile (Venmo, Cash
    // App, Zelle, PayPal Option 2…) that the DJ walked away from is a no-op —
    // save() drops it — so it must NOT count as unsaved, or it traps the page
    // behind the leave guard forever.
    if (cur && !saved) {
      // Check / Cash carry many fields beyond the handle (balance answer,
      // accept-method toggles, mailing/office address, phone…). ANY of them the
      // DJ populated or changed is a real edit they must save — not just the
      // "payable to" / handle. We compare against the tile's OPEN baseline, not a
      // blank one: opening Check auto-fills the account address + phone, and that
      // auto-fill is not a DJ edit, so it must not count as unsaved on its own.
      if (cur.type === 'check' || cur.type === 'cash') {
        const af = !autofillOff.current.has(cur.type);
        const base = (cur.type === 'cash'
          ? { id: cur.id, type: 'cash', handle: af && accountPhone ? accountPhone : '' }
          : { id: cur.id, type: 'check', handle: '', contact: af && accountAddress ? accountAddress : '', checkPhone: af && accountPhone ? accountPhone : '' }) as PaymentMethod;
        return norm(cur) !== norm(base);
      }
      return METHOD_TYPES[cur.type].handleLabel === '' ? true : !!cleanHandle(cur);
    }
    // Saved but now gone = a removal (removeType persists it immediately, so
    // this only shows transiently).
    if (!cur || !saved) return !!cur !== !!saved;
    return norm(cur) !== norm(saved);
  }, [byType, savedByType, accountPhone, accountAddress]);

  // Aggregate "has any unsaved rail change" — reported up so the Payments tab
  // in Booking Settings can show the unsaved dot.
  const anyPaymentsDirty = useMemo(
    () => (TYPE_ORDER as PaymentMethodType[]).some((t) => isDirty(t)),
    [isDirty],
  );
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  useEffect(() => { onDirtyRef.current?.(anyPaymentsDirty); }, [anyPaymentsDirty]);
  useEffect(() => () => { onDirtyRef.current?.(false); }, []);

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

  // Same test, but against what's actually SAVED on the server — not the
  // in-progress edits in state. Drives the Activate↔Save button and the Remove
  // button: a rail isn't a real "active payment option" until a save succeeds,
  // so the button stays "Activate" (and Remove stays hidden) until then. If a
  // save fails, savedByType is unchanged, so an already-active rail stays "Save".
  const isSavedLive = useCallback((t: PaymentMethodType): boolean => {
    const m = savedByType[t];
    if (!m || !m.enabled) return false;
    if (METHOD_TYPES[t].validate(m.handle || '')) return false;
    const vc = METHOD_TYPES[t].validateContact;
    return vc ? !vc(m.contact || '') : true;
  }, [savedByType]);

  // Card is "live" when Stripe is ready; PayPal is live when EITHER the DJ
  // connected via Option 1 (paypalReady) OR saved a manual PayPal.me/email;
  // every other rail is live once it has a saved handle.
  const tileLive = (k: TileKey): boolean =>
    k === 'card' ? !!card?.ready
      : k === 'paypal' ? (paypalReady || isLive(k))
      : isLive(k);

  // Which tiles the DJ has ALREADY set up (a connected card, or a saved rail).
  // Used to pick which one opens by default.
  const tileConfigured = (k: TileKey): boolean =>
    k === 'card' ? !!card?.ready : !!savedByType[k];

  // Open one tile by default: the first already-configured option in tile
  // order (the one "closest to the first"), or the very first tile if the DJ
  // hasn't added anything yet. Runs once after load, and never fights the DJ
  // after that — collapsing or opening a tile by hand sticks.
  const didInitOpen = useRef(false);
  useEffect(() => {
    if (didInitOpen.current || !loaded) return;
    didInitOpen.current = true;
    const firstConfigured = TILE_ORDER.find(tileConfigured);
    setOpenTile(firstConfigured ?? TILE_ORDER[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

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
    setConfirmingRemove(null);
    // Remove means "leave it blank" — stop the account auto-fill from silently
    // re-populating this tile the next time it's opened.
    autofillOff.current.add(t);
    // PayPal: Remove just clears the Option 2 (PayPal.me / email) input and
    // leaves the tile open on the page — it doesn't tear the whole PayPal
    // method off the grid (Option 1 Connect lives in the same tile). Clearing
    // the handle also re-enables the Connect button.
    // Either way we persist the result immediately so the change is saved and
    // the page doesn't get stuck behind the unsaved-changes guard.
    if (t === 'paypal') {
      const next = methods.map((m) => (m.type === t ? { ...m, handle: '', contact: '' } : m));
      setMethods(next);
      void persistClean(buildClean(next), '✓ Removed.');
      return;
    }
    const next = methods.filter((m) => m.type !== t);
    setMethods(next);
    setOpenTile(null);
    void persistClean(buildClean(next), '✓ Removed.');
  }

  const firstError = (TYPE_ORDER
    .map((t) => {
      const m = byType[t];
      if (!m || !m.enabled) return null;
      // A row that exists but is entirely empty is a tile the DJ opened and
      // walked away from — not an error to shout about. It's dropped on save.
      // BUT a check/cash tile with other fields filled in (balance answer,
      // address, phone, toggles) is a real in-progress option — if we treat it
      // as "empty" and let save() run, buildClean drops it for the missing
      // handle and every field the DJ typed vanishes. So require the handle
      // (payable-to / cash name) instead of silently discarding.
      if (!(m.handle || '').trim() && METHOD_TYPES[t].handleLabel) {
        if ((t === 'check' || t === 'cash') && t === openTile) {
          const hasOther = !!((m.contact || '').trim() || (m.dropoffAddress || '').trim()
            || (m.dropoffHours || '').trim() || (m.checkPhone || '').trim()
            || m.checkNightOf !== undefined || m.cashNightOf !== undefined
            || m.checkMail === false || m.checkMeet === true || m.checkOffice === true);
          if (hasOther) {
            return t === 'check'
              ? 'Enter who the check should be made payable to.'
              : 'Enter the number clients should use for cash.';
          }
        }
        return null;
      }
      const e = METHOD_TYPES[t].validate(m.handle || '');
      if (e) return e;
      // The night-of question is only enforced for the tile the DJ is actively
      // editing — otherwise an unanswered Cash rail would block saving the Check
      // rail (and show a "cash" error on the check page). Each tile validates
      // its own balance question when it's the one open.
      // Check must have the night-of question answered (yes or no) before it
      // can be saved — it changes the whole flow the host is shown.
      if (t === openTile && t === 'check' && m.checkNightOf === undefined) {
        return 'Answer whether the host can pay the balance by check the day of the event.';
      }
      // If night-of isn't allowed, a lead time must be chosen.
      if (t === openTile && t === 'check' && m.checkNightOf === false && m.checkLeadWeeks == null) {
        return 'Choose how far in advance the check must be received.';
      }
      // Cash mirrors check: the night-of question must be answered, and a lead
      // time chosen when the host can't pay in cash the day of the event.
      if (t === openTile && t === 'cash' && m.cashNightOf === undefined) {
        return 'Answer whether the host can pay the balance in cash the day of the event.';
      }
      if (t === openTile && t === 'cash' && m.cashNightOf === false && m.cashLeadWeeks == null) {
        return 'Choose how far in advance the cash must be dropped off.';
      }
      // A phone with no name is half a Cash rail: the client rings a stranger
      // and says "...hi?". Both halves or neither.
      const vc = METHOD_TYPES[t].validateContact;
      return vc ? vc(m.contact || '') : null;
    })
    .find((e) => e)) || null;

  // Clearing a previously-saved rail's handle means "I don't want this method
  // anymore" — the DJ emptied the field instead of hitting Remove. That reads
  // as a dirty edit the per-tile Save can't commit (empty rails aren't saved),
  // so it would sit forever as a phantom "unsaved change" and trap the leave
  // guard. Detect it and persist the removal automatically (buildClean drops
  // empty rails), keeping the tile open so the DJ sees it's now an "add" slot.
  // Debounced so clearing-to-retype doesn't nuke the saved value mid-edit.
  useEffect(() => {
    if (!loaded || saving || firstError) return;
    const cleared = (TYPE_ORDER as PaymentMethodType[]).some((t) => {
      const cur = byType[t];
      const saved = savedByType[t];
      return !!cur && !!saved && METHOD_TYPES[t].handleLabel !== '' && !cleanHandle(cur) && !!cleanHandle(saved);
    });
    if (!cleared) return;
    const timer = setTimeout(() => { void persistClean(buildClean(methods), '✓ Removed.'); }, 650);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byType, savedByType, loaded, saving, firstError]);

  // Switching to a different tile clears the "attempted" red state so a freshly
  // opened tile never opens pre-scolded.
  useEffect(() => { setAttempted(false); setConfirmingRemove(null); }, [openTile]);

  // Auto-fill cash/check contact details from the DJ's account when they open
  // that tile — the phone (cash + check) and mailing address (check) — so the
  // common case needs no "Apply" tap. Only fills EMPTY fields on open, never
  // overwrites what the DJ typed or cleared, and only when the account has it.
  // Once the DJ hits Remove on a tile, we stop auto-filling it for the rest of
  // the session — Remove means "leave it blank", not "blank it and refill it".
  useEffect(() => {
    if (!loaded) return;
    if (openTile !== 'cash' && openTile !== 'check') return;
    const t = openTile;
    if (autofillOff.current.has(t)) return;
    const cur = byType[t];
    const patch: Partial<PaymentMethod> = {};
    if (t === 'cash') {
      if (accountPhone && !(cur?.handle || '').trim()) patch.handle = accountPhone;
    } else {
      if (accountAddress && !(cur?.contact || '').trim()) patch.contact = accountAddress;
      if (accountPhone && !(cur?.checkPhone || '').trim()) patch.checkPhone = accountPhone;
    }
    if (Object.keys(patch).length) patchType(t, patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTile, loaded, accountPhone, accountAddress]);

  // Build the server payload from an explicit list (not just current state), so
  // an action that changes the list — Remove — can persist the post-change list
  // in the same tick instead of waiting for a state round-trip.
  function buildClean(list: PaymentMethod[]) {
    return list
      .filter((m) => METHOD_TYPES[m.type].handleLabel === '' || !!cleanHandle(m))
      .map((m) => ({
        id: m.id,
        type: m.type,
        handle: cleanHandle(m),
        note: (m.note || '').trim(),
        enabled: true,
        ...(METHOD_TYPES[m.type].contactLabel ? { contact: (m.contact || '').trim() } : {}),
        ...((m.type === 'cash' || m.type === 'check') && (m.dropoffAddress || '').trim()
          ? { dropoffAddress: (m.dropoffAddress || '').trim(), dropoffHours: (m.dropoffHours || '').trim() }
          : {}),
        ...(m.type === 'cash' ? { smsOk: m.smsOk !== false } : {}),
        // Cash mirrors check's balance rule: can the host pay in cash the night
        // of the event, and (if not) how many weeks ahead must it be dropped off.
        // Stored explicitly (even false) so the host cash page can rely on it.
        ...(m.type === 'cash'
          ? {
              cashNightOf: m.cashNightOf === true,
              ...(m.cashNightOf ? {} : { cashLeadWeeks: m.cashLeadWeeks ?? 2 }),
            }
          : {}),
        // Check: whether the host may pay the night of the event, and (if not)
        // how many weeks ahead they must pay. checkNightOf is stored explicitly
        // (even false) so the check page can rely on it.
        ...(m.type === 'check'
          ? {
              checkNightOf: m.checkNightOf === true,
              ...(m.checkNightOf ? {} : { checkLeadWeeks: m.checkLeadWeeks ?? 2 }),
              ...((m.checkPhone || '').trim() ? { checkPhone: (m.checkPhone || '').trim() } : {}),
              ...(m.checkCall === false ? { checkCall: false } : {}),
              ...(m.checkText === false ? { checkText: false } : {}),
              ...(m.checkMail === false ? { checkMail: false } : {}),
              ...(m.checkMeet === true ? { checkMeet: true } : {}),
              ...(m.checkOffice === true ? { checkOffice: true } : {}),
            }
          : {}),
      }));
  }

  // Persist a cleaned list and sync BOTH methods + savedMethods so the parent's
  // unsaved-changes guard sees a clean slate (no phantom "unsaved" after Remove).
  async function persistClean(clean: ReturnType<typeof buildClean>, successMsg = '✓ Saved.') {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/dj/payment-methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ methods: clean }),
      });
      const jr = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !jr.ok) throw new Error(jr.error || 'Could not save.');
      setMethods(clean);
      setSavedMethods(clean);
      setFeedback({ msg: successMsg, ok: true });
      setTimeout(() => setFeedback(null), 2500);
      try { window.dispatchEvent(new Event('gdc-setup-progress')); } catch { /* no-op */ }
    } catch (e) {
      setFeedback({ msg: e instanceof Error ? e.message : 'Could not save.', ok: false });
    } finally {
      setSaving(false);
    }
  }

  // Closing a tile must never leave the section stranded as "unsaved". If the
  // open edits are valid, persist them; if something's half-filled (a
  // validation error), discard the in-progress edits back to what's saved.
  // Either way the section ends clean, so the leave-guard won't nag over a
  // value the DJ already walked away from.
  function closeTile() {
    if (firstError) {
      setMethods(savedMethods);          // discard invalid in-progress edits
    } else if (anyPaymentsDirty) {
      void persistClean(buildClean(methods));
    }
    setOpenTile(null);
    setAttempted(false);                  // a freshly reopened tile isn't "attempted"
  }

  async function save() {
    // Mark that a save was attempted so an unanswered check question can turn
    // red (the button stays clickable precisely so this can fire).
    setAttempted(true);
    if (firstError) {
      setFeedback({ msg: firstError, ok: false });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
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
          // Cash + check, and only when the DJ actually filled one in — an empty
          // string here would make the drop-off readers think there's an address.
          ...((m.type === 'cash' || m.type === 'check') && (m.dropoffAddress || '').trim()
            ? {
                dropoffAddress: (m.dropoffAddress || '').trim(),
                dropoffHours: (m.dropoffHours || '').trim(),
              }
            : {}),
          ...(m.type === 'cash' ? { smsOk: m.smsOk !== false } : {}),
          ...(m.type === 'cash'
            ? {
                cashNightOf: m.cashNightOf === true,
                ...(m.cashNightOf ? {} : { cashLeadWeeks: m.cashLeadWeeks ?? 2 }),
              }
            : {}),
          ...(m.type === 'check'
            ? {
                checkNightOf: m.checkNightOf === true,
                ...(m.checkNightOf ? {} : { checkLeadWeeks: m.checkLeadWeeks ?? 2 }),
                ...((m.checkPhone || '').trim() ? { checkPhone: (m.checkPhone || '').trim() } : {}),
                ...(m.checkCall === false ? { checkCall: false } : {}),
                ...(m.checkText === false ? { checkText: false } : {}),
                ...(m.checkMail === false ? { checkMail: false } : {}),
                ...(m.checkMeet === true ? { checkMeet: true } : {}),
                ...(m.checkOffice === true ? { checkOffice: true } : {}),
              }
            : {}),
        }));
      // OWNER-ONLY on the server. No team member of any role may change where
      // money lands — the endpoint rejects non-owners, so this is airtight
      // regardless of how the editor was reached.
      const res = await fetch('/api/dj/payment-methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ methods: clean }),
      });
      const jr = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !jr.ok) throw new Error(jr.error || 'Could not save.');
      setMethods(clean);
      setSavedMethods(clean);
      setFeedback({ msg: '✓ Saved.', ok: true });
      setTimeout(() => setFeedback(null), 2500);
      // Nudge the setup checklist to re-check the Payments step now that a rail
      // is saved — otherwise its green check waits for a full page reload.
      try { window.dispatchEvent(new Event('gdc-setup-progress')); } catch { /* no-op */ }
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
    fontFamily: 'inherit',
    fontSize: '.74rem',
    letterSpacing: '.03em',
    textTransform: 'uppercase',
    fontWeight: 600,
    color: 'var(--white)',
    marginBottom: '.35rem',
    display: 'block',
  };
  // Readable label for full-sentence questions — the all-caps mono `label`
  // above works for short tags ("PAYABLE TO") but is hard to read on a whole
  // sentence, so questions use sentence case in the normal sans font.
  const qLabel: React.CSSProperties = {
    fontFamily: 'inherit',
    fontSize: '.82rem',
    letterSpacing: 'normal',
    textTransform: 'none',
    color: 'var(--white)',
    marginBottom: '.35rem',
    display: 'block',
    fontWeight: 600,
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
    // Secondary (Close / Remove / an already-saved Save) used var(--muted) text
    // on a var(--border) outline — both so close to the panel colour the button
    // was nearly invisible. A brighter border, a faint fill, and white text make
    // it read as a control without competing with the neon primary.
    border: primary ? 'none' : '1px solid rgba(255,255,255,.4)',
    background: primary ? 'var(--neon)' : 'rgba(255,255,255,.06)',
    color: primary ? 'var(--black)' : 'var(--white)',
    fontWeight: primary ? 700 : 600,
    cursor: enabled ? 'pointer' : 'default',
    opacity: enabled ? 1 : 0.45,
  });

  // Debounced address lookup for the Cash/Check address fields. Under 5 chars
  // searchAddresses returns nothing, so don't even fire.
  function runAddrSearch(val: string) {
    if (addrTimer.current) clearTimeout(addrTimer.current);
    if (val.trim().length < 3) { setAddrSug([]); setShowAddrSug(false); return; }
    addrTimer.current = setTimeout(async () => {
      // Country CODE, not name — exactly how the booking form calls it.
      const cc = COUNTRY_CODES_ADDR[accountCountry] || null;
      const results = await searchAddresses(val.trim(), cc);
      setAddrSug(results);
      setShowAddrSug(results.length > 0);
    }, 350);
  }

  // One address input with the type-ahead dropdown, reused by both the Cash
  // office field and the Check mailing field so they behave identically.
  const addressField = (opts: {
    value: string; onChange: (v: string) => void; placeholder: string;
    autoFocus?: boolean; invalid?: boolean;
  }) => (
    // Input + country picker side by side — the same pairing the booking form
    // uses. The country biases the address search (and is what the booking
    // page shows), so it lives right next to the box it affects.
    <div style={{ display: 'flex', gap: '.4rem', alignItems: 'stretch' }}>
      <div style={{ position: 'relative', flex: 1 }}>
        <input
          value={opts.value}
          autoFocus={opts.autoFocus}
          placeholder={opts.placeholder}
          autoComplete="off"
          onChange={(e) => { opts.onChange(e.target.value); runAddrSearch(e.target.value); }}
          onFocus={() => { if (addrSug.length > 0) setShowAddrSug(true); }}
          onBlur={() => setTimeout(() => setShowAddrSug(false), 150)}
          style={{ ...field, borderColor: opts.invalid ? '#ff6b6b' : 'var(--border)' }}
        />
        {showAddrSug && addrSug.length > 0 && (
          <div style={{
            position: 'absolute', zIndex: 5, top: '100%', left: 0, right: 0,
            background: 'var(--deep)', border: '1px solid var(--border)',
            borderRadius: 6, marginTop: 2, maxHeight: 200, overflowY: 'auto',
          }}>
            {addrSug.map((sg, i) => (
              <div
                key={i}
                onMouseDown={(e) => { e.preventDefault(); opts.onChange(sg.display); setAddrSug([]); setShowAddrSug(false); }}
                style={{
                  padding: '.5rem .6rem', cursor: 'pointer', fontSize: '.8rem',
                  color: 'var(--white)',
                  borderBottom: i < addrSug.length - 1 ? '1px solid var(--border)' : 'none',
                }}
              >
                {sg.display}
              </div>
            ))}
          </div>
        )}
      </div>
      <select
        value={accountCountry}
        onChange={(e) => { setAccountCountry(e.target.value); setAddrSug([]); setShowAddrSug(false); }}
        aria-label="Country for address search"
        style={{ ...field, width: 'auto', flex: '0 0 auto', padding: '.55rem .4rem', cursor: 'pointer' }}
      >
        {COUNTRIES.filter((c) => c !== 'Other').map((c) => (
          <option key={c} value={c}>
            {COUNTRY_FLAGS[c] || '🌍'} {(COUNTRY_CODES_ADDR[c] || '??').toUpperCase()}
          </option>
        ))}
      </select>
    </div>
  );

  // Non-owner (team member): show a read-only lock instead of the editor.
  // The server also rejects the save (403), so this is defense in depth.
  if (isOwner === false) {
    return (
      <div className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Payment Methods</div>
        </div>
        <div className={styles.sectionBody}>
          <p className={styles.bodyHint}>
            Only the account owner can view or change payment options — where a
            booking&rsquo;s money is sent. Ask the owner to update these.
          </p>
        </div>
      </div>
    );
  }

  if (!loaded || isOwner === null) {
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

  // Rails the provider locks to specific currencies. Anything not listed
  // (PayPal is multi-currency; cash/check/card are the DJ's own) accepts any.
  const RAIL_ALLOWED_CURRENCIES: Partial<Record<PaymentMethodType, string[]>> = {
    venmo: ['USD'], zelle: ['USD'], cashapp: ['USD', 'GBP'],
  };
  // Live rails that can't represent the DJ's chosen currency — a client paying
  // with them would be charged in the rail's own currency, not the DJ's.
  const currencyMismatches = (TYPE_ORDER as PaymentMethodType[])
    .filter((t) => isLive(t))
    .map((t) => ({ t, allowed: RAIL_ALLOWED_CURRENCIES[t] }))
    .filter((x) => x.allowed && !x.allowed.includes(rateCurrency))
    .map((x) => ({ label: METHOD_TYPES[x.t].label, allowed: (x.allowed as string[]).join(' or ') }));

  const liveCount = TILE_ORDER.filter(tileLive).length;

  return (
    <div className={styles.sectionCard}>
      <SectionBanner
        icon="payments"
        title="Payment Methods"
        subtitle="Pick the ways you want to get paid. Clients choose whichever suits them — you're never handcuffing them to one. Money goes straight to you; Global DJ Connect never touches it and takes no cut."
      />
      <div className={styles.sectionBody}>

        {/* Currency mismatch — Venmo/Zelle are USD-only, Cash App US/UK. If the
            DJ prices in a currency one of their live rails can't represent, the
            client gets charged in the rail's currency instead. Warn, don't
            block — the DJ may still want to offer it. */}
        {rateCurrency !== 'USD' && currencyMismatches.length > 0 && (
          <p style={{ margin: '0 0 .5rem', padding: '.6rem .7rem', borderRadius: 6, background: 'transparent', border: '1px solid rgba(245,166,35,.5)', color: '#f5a623', fontSize: '.75rem', lineHeight: 1.5 }}>
            You price in <strong>{rateCurrency}</strong>, but{' '}
            {currencyMismatches.map((m, i) => (
              <span key={m.label}>
                {i > 0 ? (i === currencyMismatches.length - 1 ? ' and ' : ', ') : ''}
                <strong>{m.label}</strong> only accepts {m.allowed}
              </span>
            ))}
            {' '}— a client paying that way is charged in that currency, not {rateCurrency}.
          </p>
        )}

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
            // Rails the provider locks to currencies the DJ isn't pricing in
            // (Venmo/Zelle USD-only, Cash App US/UK) are disabled — a client
            // couldn't actually pay in the DJ's currency through them.
            const allowedCur = k !== 'card' ? RAIL_ALLOWED_CURRENCIES[k as PaymentMethodType] : undefined;
            const blocked = !!allowedCur && !allowedCur.includes(rateCurrency);
            return (
              <button
                key={k}
                type="button"
                onClick={() => { if (!blocked) setOpenTile(open ? null : k); }}
                disabled={blocked}
                title={blocked ? `${(allowedCur as string[]).join('/')} only — not available for ${rateCurrency}` : undefined}
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
                  // Border reads the tile's state at a glance:
                  //   neon solid  = live (offered to clients)
                  //   white solid = available, click to set up
                  //   dashed faint = disabled (currency can't use it)
                  border: blocked
                    ? '1px dashed rgba(255,255,255,.14)'
                    : live
                      ? '1.5px solid var(--neon)'
                      : `1px solid ${open ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.28)'}`,
                  background: blocked
                    ? 'rgba(255,255,255,.01)'
                    : (open ? 'rgba(0,224,164,.12)' : 'rgba(255,255,255,.03)'),
                  // The OPEN tile gets a neon ring + glow so it's obvious which
                  // one the panel below is editing — this works even for a live
                  // tile, whose neon border otherwise looks the same open or not.
                  boxShadow: open && !blocked ? '0 0 0 2px var(--neon), 0 8px 20px rgba(0,224,164,.35)' : undefined,
                  cursor: blocked ? 'not-allowed' : 'pointer',
                  opacity: blocked ? 0.45 : 1,
                  textAlign: 'center',
                  zIndex: open ? 2 : undefined,
                  // Lift the open tile so it visibly separates from its neighbours,
                  // which all share the same neon border when they're live.
                  transform: open && !blocked ? 'translateY(-4px)' : undefined,
                  transition: 'transform .12s ease, box-shadow .12s ease',
                }}
              >
                {/* Solid "EDITING" badge — the one signal that stands out against
                    a row where every live tile already has a neon border. */}
                {open && !blocked && (
                  <span
                    style={{
                      position: 'absolute', top: -9, left: '50%', transform: 'translateX(-50%)',
                      background: 'var(--neon)', color: '#04121a',
                      fontSize: '.5rem', fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase',
                      padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap',
                      boxShadow: '0 2px 6px rgba(0,0,0,.4)',
                    }}
                  >
                    Editing
                  </span>
                )}
                {/* Caret pointing down to the editor panel, so the open tile is
                    visibly tied to the fields below it. */}
                {open && !blocked && (
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute', bottom: -9, left: '50%', transform: 'translateX(-50%)',
                      width: 0, height: 0,
                      borderLeft: '8px solid transparent', borderRight: '8px solid transparent',
                      borderTop: '9px solid var(--neon)',
                    }}
                  />
                )}
                <span
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    height: 30,
                    filter: blocked ? 'grayscale(1)' : undefined,
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
                <span style={{ fontSize: '.72rem', fontWeight: 700, color: blocked ? 'var(--muted)' : 'var(--white)' }}>{TILE_LABEL[k]}</span>
                {blocked && (
                  <span style={{ fontSize: '.55rem', fontWeight: 700, color: '#f5a623', lineHeight: 1.2, letterSpacing: '.02em' }}>
                    {(allowedCur as string[]).join('/')} only
                  </span>
                )}
                {/* Only Card has one — don't leave an empty line reserving
                    space under every other tile. */}
                {TILE_BLURB[k] && (
                  <span style={{ fontSize: '.6rem', color: 'var(--muted)', lineHeight: 1.3 }}>{TILE_BLURB[k]}</span>
                )}
                {/* The dot is the whole point of the grid: what can a client
                    actually use right now, without opening anything. Hidden on a
                    currency-blocked tile — a green "active" badge on a disabled
                    rail is exactly the mixed signal that made it read clickable. */}
                {live && !blocked && (
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
          <div
            style={
              card?.ready
                ? {
                    // Same electric "it's live" treatment as PayPal: neon border,
                    // teal-tinted gradient fill and an outer glow.
                    padding: '.9rem',
                    border: '1px solid rgba(0,245,196,.55)',
                    borderRadius: 8,
                    background: 'linear-gradient(135deg, rgba(0,245,196,.10), rgba(0,245,196,.02))',
                    boxShadow: '0 0 0 1px rgba(0,245,196,.15), 0 0 22px rgba(0,245,196,.22)',
                  }
                : { padding: '.9rem', border: '1px solid var(--border)', borderRadius: 8, background: 'rgba(255,255,255,.02)' }
            }
          >
            {/* Blinking "live" dot — matches the PayPal connected pill. */}
            <style>{`
              @keyframes gdcStripeBlink { 0%,100% { opacity: 1; transform: scale(1); box-shadow: 0 0 0 0 rgba(0,245,196,.8); } 50% { opacity: .25; transform: scale(.8); box-shadow: 0 0 10px 4px rgba(0,245,196,.55); } }
            `}</style>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
              <span style={{ fontWeight: 700, color: 'var(--white)', fontSize: '.9rem' }}>Card payments via Stripe</span>
              {card?.ready ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '.8rem', fontWeight: 800, letterSpacing: '.06em', color: '#00f5c4', background: '#04121a', padding: '5px 13px', borderRadius: 999, border: '1px solid rgba(0,245,196,.6)', boxShadow: '0 0 14px rgba(0,245,196,.4)', textTransform: 'uppercase', fontFamily: "'Space Mono', monospace" }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#00f5c4', display: 'inline-block', animation: 'gdcStripeBlink 1.2s ease-in-out infinite' }} />
                  Connected
                </span>
              ) : (() => {
                const st = card === null
                  ? { text: 'Checking…', c: 'var(--muted)', bg: 'rgba(255,255,255,.05)', b: 'var(--border)' }
                  : card.connected
                    ? (card.actionNeeded
                        ? { text: 'Setup incomplete', c: '#f5a623', bg: 'rgba(245,166,35,.12)', b: 'rgba(245,166,35,.35)' }
                        : { text: 'Verifying', c: '#f5a623', bg: 'rgba(245,166,35,.12)', b: 'rgba(245,166,35,.35)' })
                    : { text: 'Not connected', c: 'var(--muted)', bg: 'rgba(255,255,255,.05)', b: 'var(--border)' };
                return (
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '.22rem .55rem', borderRadius: 999, fontSize: '.6rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', fontFamily: "'Space Mono', monospace", color: st.c, background: st.bg, border: `1px solid ${st.b}` }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.c, display: 'inline-block', flexShrink: 0 }} />
                    {st.text}
                  </span>
                );
              })()}
            </div>

            <ul className={styles.bodyHint} style={{ margin: '0 0 .6rem', paddingLeft: '1.1rem', lineHeight: 1.6 }}>
              <li>Clients pay by debit or credit card, straight into your own Stripe account.</li>
              <li>You will be charged 2.9% + 30¢ per transaction. Amount is deducted from payment received.</li>
            </ul>


            {card !== null && !card.connected && (
              <>
                <p className={styles.bodyHint} style={{ margin: '0 0 .5rem' }}>
                  <strong style={{ color: 'var(--white)', fontWeight: 600 }}>No Stripe account?</strong> You&apos;ll create one during setup.
                </p>
                <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => void connectStripe()} disabled={cardBusy} style={btn(true, !cardBusy)}>
                    {cardBusy ? 'Opening Stripe…' : 'Connect or sign up for Stripe'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowHelp((v) => !v)}
                    style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--neon)', fontSize: '.72rem', fontFamily: "'Space Mono', monospace", letterSpacing: '.04em', textDecoration: 'underline' }}
                  >
                    {showHelp ? 'Hide the answers' : 'What will Stripe ask me when signing up?'}
                  </button>
                </div>
                {showHelp && (
                  <div style={{ marginTop: '.7rem', padding: '.9rem', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(0,0,0,.25)' }}>
                    <div style={{ ...label, color: 'var(--neon)', marginBottom: '.4rem' }}>Stripe details</div>
                    <p style={{ margin: '0 0 .55rem', fontSize: '.8rem', color: 'var(--muted)', lineHeight: 1.55 }}>Stripe is the card processor that handles the charge and pays out to your bank.</p>
                    <ul style={{ margin: '0 0 .9rem', paddingLeft: '1.1rem', fontSize: '.8rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                      <li>Stripe verifies you — SSN and bank details — during setup (the law requires it for card payments). It goes to Stripe, not us.</li>
                      <li>Your <strong style={{ color: 'var(--white)', fontWeight: 600 }}>first payout takes 7–14 days</strong> (a one-time hold). After that, each payment reaches your bank in about 2 business days.</li>
                    </ul>

                    <div style={{ ...label, color: 'var(--neon)', margin: '0 0 .5rem' }}>The questions that trip people up</div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                      <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)', borderRadius: 8, padding: '.6rem .7rem' }}>
                        <div style={{ ...label, marginBottom: '.35rem' }}>Business website</div>
                        {slug ? (
                          <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <code style={{ fontFamily: "'Space Mono', monospace", fontSize: '.8rem', color: 'var(--white)', background: 'var(--deep)', padding: '.3rem .5rem', borderRadius: 4, wordBreak: 'break-all' }}>
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
                          <p style={{ margin: 0, fontSize: '.8rem', color: 'var(--white)' }}>Your Global DJ Connect profile URL.</p>
                        )}
                        <p style={{ margin: '.4rem 0 0', fontSize: '.74rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                          No website? Use this — it&apos;s a real public page showing your services and prices, exactly what Stripe wants to see.
                        </p>
                      </div>

                      <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)', borderRadius: 8, padding: '.6rem .7rem' }}>
                        <div style={{ ...label, marginBottom: '.35rem' }}>Type of business</div>
                        <p style={{ margin: 0, fontSize: '.8rem', color: 'var(--white)', lineHeight: 1.5 }}>Individual — unless you actually have an LLC, in which case use it and have the EIN handy.</p>
                      </div>

                      <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)', borderRadius: 8, padding: '.6rem .7rem' }}>
                        <div style={{ ...label, marginBottom: '.35rem' }}>Industry</div>
                        <p style={{ margin: 0, fontSize: '.8rem', color: 'var(--white)', lineHeight: 1.5 }}>Search &quot;DJ&quot; or &quot;band&quot; — the entertainment category for musicians and entertainers is the one you want.</p>
                      </div>

                      <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)', borderRadius: 8, padding: '.6rem .7rem' }}>
                        <div style={{ ...label, marginBottom: '.35rem' }}>What you sell</div>
                        <p style={{ margin: 0, fontSize: '.8rem', color: 'var(--white)', lineHeight: 1.5 }}>&quot;DJ services for events, weddings, and parties.&quot;</p>
                      </div>

                      <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)', borderRadius: 8, padding: '.6rem .7rem' }}>
                        <div style={{ ...label, marginBottom: '.35rem' }}>Statement descriptor</div>
                        <p style={{ margin: 0, fontSize: '.8rem', color: 'var(--white)', lineHeight: 1.5 }}>Your Company or DJ name — this is what shows on your client&apos;s card statement. Make it something they&apos;ll recognize, or you&apos;ll get &quot;what&apos;s this charge?&quot; calls and chargebacks.</p>
                      </div>
                    </div>
                  </div>
                )}
              </>
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
                  onMouseEnter={(e) => { if (!cardBusy) { e.currentTarget.style.color = '#ff6b6b'; e.currentTarget.style.borderColor = '#ff6b6b'; } }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--muted,#9a9ab0)'; e.currentTarget.style.borderColor = 'var(--line,#2a2a38)'; }}
                  style={{ marginLeft: 'auto', flexShrink: 0, padding: '.7rem 1.1rem', borderRadius: 8, border: '1px solid var(--line,#2a2a38)', background: 'transparent', color: 'var(--muted,#9a9ab0)', fontWeight: 700, fontSize: '.82rem', cursor: cardBusy ? 'default' : 'pointer', opacity: cardBusy ? 0.6 : 1, transition: 'color .15s, border-color .15s' }}
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
          // Shown errors appear once the DJ has typed something — or once they
          // press Save/Activate on an empty required field (attempted), so the
          // reason the button "didn't work" is spelled out on the field itself.
          const err = (m.handle || '').trim() || !cfg.handleLabel || attempted ? cfg.validate(m.handle || '') : null;
          const contactErr = cfg.validateContact && ((m.contact || '').trim() || attempted)
            ? cfg.validateContact(m.contact || '')
            : null;
          // Whether it COULD go live — evaluated against the real values, not
          // against whether we're currently showing a complaint. An empty tile
          // has no visible error and still isn't activatable.
          const complete = !cfg.validate(m.handle || '')
            && (!cfg.validateContact || !cfg.validateContact(m.contact || ''));
          // Already live and unchanged since the last save: there is genuinely
          // nothing to write. Save goes inert rather than running a no-op that
          // reports success.
          const nothingToSave = isLive(t) && !isDirty(t);
          // Option 1 (Connect PayPal) overrides Option 2 (manual PayPal.me /
          // email): once connected, the manual rail is greyed and unclickable.
          const paypalManualDisabled = t === 'paypal' && paypalReady;
          // The reverse lock: once Option 2 (a manual PayPal.me / email) has a
          // value, Option 1 (Connect) is blocked — the two rails are mutually
          // exclusive. Only applies while not already connected.
          const paypalManualFilled = t === 'paypal' && !paypalReady && !!(m.handle || '').trim();
          const shown = cleanHandle(m) ? displayHandle(m) : '';
          return (
            <div style={{ padding: '.9rem', border: '1px solid var(--border)', borderRadius: 8, background: 'rgba(255,255,255,.02)' }}>
              {/* Hero header — the method you're editing reads big, in the
                  display font, so it's obvious which rail this panel is for. */}
              <div style={{ fontFamily: "'Bebas Neue', Impact, sans-serif", fontWeight: 400, color: 'var(--white)', fontSize: '1.75rem', letterSpacing: '.03em', lineHeight: 1, marginBottom: '.7rem', paddingBottom: '.55rem', borderBottom: '1px solid rgba(255,255,255,.5)' }}>{cfg.label}</div>
              {/* White, not muted: this is the rail's actual behaviour — what
                  the client will have to do, what it costs, what it can't do.
                  Greying it made the one paragraph that answers "should I use
                  this?" read as fine print. */}
              {/* PayPal shows its own Option 1/Option 2 copy below, so the
                  generic one-line hint is suppressed for it. */}
              {t !== 'paypal' && cfg.hint && (
                <p className={styles.bodyHint} style={{ margin: '0 0 .7rem', color: 'var(--white)' }}>{cfg.hint}</p>
              )}

              {/* Check timing sits at the TOP — it changes the whole flow the
                  host is shown. Compact radios; the weeks dropdown only when
                  night-of isn't allowed. */}
              {t === 'check' && (() => {
                // Tri-state: yes / no / unanswered (undefined). Turns red only
                // AFTER a save attempt, so the DJ isn't scolded before trying.
                const unanswered = attempted && m.checkNightOf === undefined;
                // Section headings sit in a solid "notched accent bar" — a filled
                // block with a darker offset notch on the left. Balance = neon,
                // Deposit = deeper green, so the two read as distinct.
                const headBase: React.CSSProperties = { display: 'inline-block', fontFamily: "'Bebas Neue', Impact, sans-serif", fontSize: '1.15rem', fontWeight: 400, letterSpacing: '.06em', textTransform: 'uppercase', lineHeight: 1, padding: '.28rem .8rem .28rem 1.1rem', borderRadius: 4, marginBottom: '.6rem' };
                const balHead: React.CSSProperties = { ...headBase, display: 'block', padding: '.35rem .8rem', background: 'linear-gradient(90deg, rgba(0,245,196,.9), rgba(0,245,196,.15))', color: '#04121a', borderRadius: 6 };
                const depHead: React.CSSProperties = { ...headBase, display: 'block', padding: '.35rem .8rem', background: 'linear-gradient(90deg, rgba(10,155,134,.9), rgba(10,155,134,.12))', color: '#eafff8', borderRadius: 6 };
                return (
                <div style={{ margin: '0 0 .85rem', paddingBottom: '.85rem', borderBottom: '1px solid var(--border)' }}>
                  {/* Balance and Deposit sit SIDE BY SIDE, split by a divider. */}
                  <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, flexWrap: 'wrap' }}>
                    {/* Balance column */}
                    <div style={{ flex: '1 1 0', minWidth: 260, paddingRight: '1.4rem' }}>
                      <div style={balHead}>Balance</div>
                      <label style={{ ...qLabel, color: unanswered ? '#ff6b6b' : '#6b727b' }}>Can the host pay the balance by check the day of the event?</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem', marginTop: '.4rem' }}>
                        {([['Yes', true], ['No, check must be in hand prior to date of event', false]] as const).map(([lbl, val]) => (
                          <label key={lbl} style={{ display: 'flex', alignItems: 'center', gap: '.35rem', cursor: 'pointer', fontSize: '.82rem', color: unanswered ? '#ff6b6b' : '#6b727b' }}>
                            <input
                              type="radio"
                              name={`checkNightOf-${m.id}`}
                              checked={m.checkNightOf === val}
                              onChange={() => patchType(t, { checkNightOf: val })}
                              style={{ accentColor: unanswered ? '#ff6b6b' : 'var(--neon)' }}
                            />
                            {lbl}
                          </label>
                        ))}
                      </div>
                      {/* When it's "No", the deadline question appears below. */}
                      {m.checkNightOf === false && (
                        <div style={{ marginTop: '.6rem' }}>
                          <label style={{ ...qLabel, display: 'block', marginBottom: '.3rem', color: (attempted && m.checkLeadWeeks == null) ? '#ff6b6b' : '#6b727b' }}>How far in advance must the check be received?</label>
                          <select
                            value={m.checkLeadWeeks != null ? String(m.checkLeadWeeks) : ''}
                            onChange={(e) => { const v = e.target.value; if (v) patchType(t, { checkLeadWeeks: Number(v) }); }}
                            style={{ ...field, marginTop: 0, width: 'auto', minWidth: 110, borderColor: (attempted && m.checkLeadWeeks == null) ? '#ff6b6b' : 'var(--border)' }}
                          >
                            <option value="" disabled>Select…</option>
                            {Array.from({ length: 10 }, (_, i) => i + 1).map((w) => (
                              <option key={w} value={w}>{w} week{w === 1 ? '' : 's'}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {unanswered && (
                        <p style={{ margin: '.45rem 0 0', color: '#ff6b6b', fontSize: '.72rem' }}>Please choose Yes or No before saving.</p>
                      )}
                    </div>
                    {/* Center divider */}
                    <span aria-hidden="true" style={{ width: 2, alignSelf: 'stretch', background: 'rgba(255,255,255,.75)', flexShrink: 0, borderRadius: 2 }} />
                    {/* Deposit column — deposits are always paid ahead, so
                        there's no night-of choice: mail or drop off, full stop. */}
                    <div style={{ flex: '1 1 0', minWidth: 260, paddingLeft: '1.4rem' }}>
                      <div style={depHead}>Deposit</div>
                      <p style={{ ...qLabel, margin: 0, color: '#6b727b' }}>Host will choose one of the options below to get you the deposit.</p>
                    </div>
                  </div>
                </div>
                );
              })()}

              {/* Cash mirrors Check's Balance/Deposit split. The difference:
                  cash can never be MAILED, so a cash deposit — and cash paid
                  ahead of the event — is always an in-person drop-off. */}
              {t === 'cash' && (() => {
                const unanswered = attempted && m.cashNightOf === undefined;
                const headBase: React.CSSProperties = { display: 'inline-block', fontFamily: "'Bebas Neue', Impact, sans-serif", fontSize: '1.15rem', fontWeight: 400, letterSpacing: '.06em', textTransform: 'uppercase', lineHeight: 1, padding: '.28rem .8rem .28rem 1.1rem', borderRadius: 4, marginBottom: '.6rem' };
                const balHead: React.CSSProperties = { ...headBase, display: 'block', padding: '.35rem .8rem', background: 'linear-gradient(90deg, rgba(0,245,196,.9), rgba(0,245,196,.15))', color: '#04121a', borderRadius: 6 };
                const depHead: React.CSSProperties = { ...headBase, display: 'block', padding: '.35rem .8rem', background: 'linear-gradient(90deg, rgba(10,155,134,.9), rgba(10,155,134,.12))', color: '#eafff8', borderRadius: 6 };
                return (
                <div style={{ margin: '0 0 .85rem', paddingBottom: '.85rem', borderBottom: '1px solid var(--border)' }}>
                  {/* Balance and Deposit sit SIDE BY SIDE, split by a divider. */}
                  <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, flexWrap: 'wrap' }}>
                    {/* Balance column */}
                    <div style={{ flex: '1 1 0', minWidth: 260, paddingRight: '1.4rem' }}>
                      <div style={balHead}>Balance</div>
                      <label style={{ ...qLabel, color: unanswered ? '#ff6b6b' : '#6b727b' }}>Can the host pay the balance in cash the day of the event?</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem', marginTop: '.4rem' }}>
                        {([['Yes', true], ['No, cash must be exchanged prior to date of event', false]] as const).map(([lbl, val]) => (
                          <label key={lbl} style={{ display: 'flex', alignItems: 'center', gap: '.35rem', cursor: 'pointer', fontSize: '.82rem', color: unanswered ? '#ff6b6b' : '#6b727b' }}>
                            <input
                              type="radio"
                              name={`cashNightOf-${m.id}`}
                              checked={m.cashNightOf === val}
                              onChange={() => patchType(t, { cashNightOf: val })}
                              style={{ accentColor: unanswered ? '#ff6b6b' : 'var(--neon)' }}
                            />
                            {lbl}
                          </label>
                        ))}
                      </div>
                      {m.cashNightOf === false && (
                        <div style={{ marginTop: '.6rem' }}>
                          <label style={{ ...qLabel, display: 'block', marginBottom: '.3rem', color: (attempted && m.cashLeadWeeks == null) ? '#ff6b6b' : '#6b727b' }}>How far in advance must the cash be dropped off?</label>
                          <select
                            value={m.cashLeadWeeks != null ? String(m.cashLeadWeeks) : ''}
                            onChange={(e) => { const v = e.target.value; if (v) patchType(t, { cashLeadWeeks: Number(v) }); }}
                            style={{ ...field, marginTop: 0, width: 'auto', minWidth: 110, borderColor: (attempted && m.cashLeadWeeks == null) ? '#ff6b6b' : 'var(--border)' }}
                          >
                            <option value="" disabled>Select…</option>
                            {Array.from({ length: 10 }, (_, i) => i + 1).map((w) => (
                              <option key={w} value={w}>{w} week{w === 1 ? '' : 's'}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {unanswered && (
                        <p style={{ margin: '.45rem 0 0', color: '#ff6b6b', fontSize: '.72rem' }}>Please choose Yes or No before saving.</p>
                      )}
                    </div>
                    {/* Center divider */}
                    <span aria-hidden="true" style={{ width: 2, alignSelf: 'stretch', background: 'rgba(255,255,255,.75)', flexShrink: 0, borderRadius: 2 }} />
                    {/* Deposit column — a cash deposit is always paid ahead and
                        cash can't be mailed, so it's an in-person drop-off, full stop. */}
                    <div style={{ flex: '1 1 0', minWidth: 260, paddingLeft: '1.4rem' }}>
                      <div style={depHead}>Deposit</div>
                      <p style={{ ...qLabel, margin: 0, color: '#6b727b' }}>Host and DJ will arrange to exchange the cash. If you have an office, add the address and hours as an option below.</p>
                    </div>
                  </div>
                </div>
                );
              })()}

              {/* PayPal offers TWO ways to get paid. Option 1: connect a PayPal
                  business account for auto-tracked payments (deposits/balances
                  mark themselves paid). Option 2: the manual PayPal.me/email
                  rail below, where the client sends by hand. */}
              {t === 'paypal' && (
                <>
                  <div style={{ fontFamily: 'inherit', color: 'var(--neon)', fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-.01em', textTransform: 'none', margin: '0 0 .35rem' }}>Option 1 — Connect your PayPal business account</div>
                  <PaypalConnectSection onStatus={setPaypalReady} initialReady={paypalReady} blockedByManual={paypalManualFilled} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', margin: '1.1rem 0 .7rem' }}>
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                    <span style={{ fontSize: '.66rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>Or</span>
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  </div>
                  <div style={{ opacity: paypalManualDisabled ? 0.45 : 1 }}>
                    <div style={{ fontFamily: 'inherit', color: 'var(--white)', fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-.01em', textTransform: 'none', margin: '0 0 .35rem' }}>Option 2 — Enter your PayPal.me link or PayPal Email Address</div>
                    {paypalManualDisabled ? (
                      <p style={{ margin: '0 0 .6rem', fontSize: '.8rem', color: 'var(--neon)', lineHeight: 1.55 }}>
                        PayPal is connected via Option 1 — the manual option isn&rsquo;t needed. Disconnect above to use it instead.
                      </p>
                    ) : (
                      <p style={{ margin: '0 0 .6rem', fontSize: '.8rem', color: 'var(--muted)', lineHeight: 1.55 }}>
                        Works on a personal account, but a <strong style={{ color: 'var(--white)' }}>Business account</strong> is recommended for regular income.
                      </p>
                    )}
                  </div>
                </>
              )}

              {cfg.handleLabel ? (
                <>
                  {/* PayPal's field label is suppressed — the Option 2 note
                      above already tells them what to enter. Cash puts the
                      "allow text" toggle on the same line as the phone label. */}
                  {t === 'cash' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.2rem', flexWrap: 'wrap' }}>
                      <label style={{ ...label, marginBottom: 0 }}>{cfg.handleLabel}</label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.78rem', color: 'var(--white)', textTransform: 'none', letterSpacing: 0, marginBottom: 0 }}>
                        <input
                          type="checkbox"
                          checked={m.smsOk !== false}
                          onChange={(e) => patchType(t, { smsOk: e.target.checked })}
                          style={{ accentColor: 'var(--neon)' }}
                        />
                        Allow host to text this number to arrange the cash drop-off
                      </label>
                    </div>
                  ) : (
                    t !== 'paypal' && <label style={label}>{cfg.handleLabel}</label>
                  )}
                  <input
                    autoFocus={!paypalManualDisabled}
                    value={m.handle}
                    placeholder={cfg.placeholder}
                    disabled={paypalManualDisabled}
                    onChange={(e) => patchType(t, { handle: e.target.value })}
                    style={{
                      ...field,
                      borderColor: err ? '#ff6b6b' : 'var(--border)',
                      ...(paypalManualDisabled ? { opacity: 0.45, cursor: 'not-allowed', pointerEvents: 'none' as const } : null),
                    }}
                  />
                  {err && <p style={{ margin: '.3rem 0 0', color: '#ff6b6b', fontSize: '.72rem' }}>{err}</p>}

                  {/* PayPal only becomes a one-tap button when it's a PayPal.me
                      link. A plain email is valid but leaves the client to open
                      PayPal and send by hand — so say which one they've given. */}
                  {t === 'paypal' && !err && (m.handle || '').trim() && (
                    isLinkable(m)
                      ? <p style={{ margin: '.4rem 0 0', color: 'var(--neon,#00e0a4)', fontSize: '.72rem', lineHeight: 1.5 }}>
                          ✓ Clients get a one-tap <strong>Pay</strong> button with the amount already filled in.
                        </p>
                      : <p style={{ margin: '.4rem 0 0', color: '#f5c451', fontSize: '.72rem', lineHeight: 1.5 }}>
                          This works, but clients must open PayPal and send it by hand. Use your <strong>paypal.me</strong> link (e.g. paypal.me/yourname) to give them a one-tap Pay button instead.
                        </p>
                  )}

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
                      Apply {accountPhone}
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
                  {shown && !err && t !== 'cash' && t !== 'check' && (
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
                  {t === 'check' && (() => {
                    const cardWrap = (clr: string, on: boolean): React.CSSProperties => ({ border: `1px solid ${on ? clr : 'var(--border)'}`, borderRadius: 8, marginBottom: '.55rem', overflow: 'hidden' });
                    const cardHead: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '.55rem', cursor: 'pointer', padding: '.65rem .7rem' };
                    const numBadge = (clr: string, n: number) => (<span style={{ width: 20, height: 20, borderRadius: '50%', background: clr, color: '#04121a', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '.64rem', fontWeight: 800, flexShrink: 0 }}>{n}</span>);
                    const bodyPad: React.CSSProperties = { padding: '0 .7rem .75rem 2.7rem' };
                    const applyLink = (val: string, apply: () => void) => (<button type="button" onClick={apply} style={{ marginTop: '.4rem', background: 'transparent', border: 'none', padding: 0, color: 'var(--neon)', fontSize: '.78rem', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}>{`Apply ${val}`}</button>);
                    // Toggle switch — replaces the checkbox on each accept-method card.
                    const toggleSwitch = (on: boolean, clr: string) => (
                      <span aria-hidden="true" style={{ width: 38, height: 22, borderRadius: 999, flexShrink: 0, background: on ? clr : 'rgba(255,255,255,.18)', transition: 'background .15s', display: 'inline-flex', alignItems: 'center', padding: 2 }}>
                        <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', transform: on ? 'translateX(16px)' : 'translateX(0)', transition: 'transform .15s', display: 'block' }} />
                      </span>
                    );
                    return (
                      <div style={{ marginTop: '.9rem', paddingTop: '.85rem', borderTop: '1px solid var(--border)' }}>
                        <div style={{ ...label, color: 'var(--neon)', fontSize: '.72rem', marginBottom: '.55rem' }}>Ways you&rsquo;ll accept the check — pick any</div>

                        {/* 1 · Mail it to me — ON by default */}
                        <div style={cardWrap('#00f5c4', m.checkMail !== false)}>
                          <div style={cardHead} onClick={() => patchType(t, { checkMail: m.checkMail !== false ? false : undefined })}>
                            {toggleSwitch(m.checkMail !== false, '#00f5c4')}
                            {numBadge('#00f5c4', 1)}
                            <span style={{ fontFamily: "'Bebas Neue', Impact, sans-serif", fontSize: '1.15rem', fontWeight: 400, letterSpacing: '.03em', color: 'var(--white)' }}>Mail It</span>
                            <span aria-hidden="true" style={{ marginLeft: 'auto', fontSize: '1.65rem', lineHeight: 1 }}>📭</span>
                          </div>
                          {(
                            <div style={bodyPad}>
                              <label style={label}>Mailing address</label>
                              {addressField({ value: m.contact || '', onChange: (v) => patchType(t, { contact: v }), placeholder: '', invalid: !!contactErr })}
                              {contactErr && <p style={{ margin: '.3rem 0 0', color: '#ff6b6b', fontSize: '.72rem' }}>{contactErr}</p>}
                              {accountAddress && (m.contact || '').trim() !== accountAddress && applyLink(accountAddress, () => patchType(t, { contact: accountAddress }))}
                            </div>
                          )}
                        </div>

                        {/* 2 · Arrange a meet-up — OFF by default */}
                        <div style={cardWrap('#14c9a4', m.checkMeet === true)}>
                          <div style={cardHead} onClick={() => patchType(t, { checkMeet: m.checkMeet === true ? undefined : true })}>
                            {toggleSwitch(m.checkMeet === true, '#14c9a4')}
                            {numBadge('#14c9a4', 2)}
                            <span style={{ fontFamily: "'Bebas Neue', Impact, sans-serif", fontSize: '1.15rem', fontWeight: 400, letterSpacing: '.03em', color: 'var(--white)' }}>Exchange In Person</span>
                            <span aria-hidden="true" style={{ marginLeft: 'auto', fontSize: '1.65rem', lineHeight: 1 }}>🤝</span>
                          </div>
                          {(
                            <div style={bodyPad}>
                              <label style={label}>Phone for the host to call or text to arrange drop-off (optional)</label>
                              <input value={m.checkPhone || ''} placeholder="" onChange={(e) => patchType(t, { checkPhone: e.target.value })} style={{ ...field, marginTop: '.35rem' }} />
                              {accountPhone && (m.checkPhone || '').trim() !== accountPhone && applyLink(accountPhone, () => patchType(t, { checkPhone: accountPhone }))}
                              <div style={{ display: 'flex', gap: '1.4rem', marginTop: '.55rem' }}>
                                {([['Call', 'checkCall'], ['Text', 'checkText']] as const).map(([lbl, key]) => (
                                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.82rem', color: 'var(--white)' }}>
                                    <input type="checkbox" checked={m[key] !== false} onChange={(e) => patchType(t, { [key]: e.target.checked ? undefined : false })} style={{ accentColor: 'var(--neon)' }} />
                                    {lbl}
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* 3 · Drop off at my office — OFF by default */}
                        <div style={cardWrap('#0a9b86', m.checkOffice === true)}>
                          <div style={cardHead} onClick={() => patchType(t, { checkOffice: m.checkOffice === true ? undefined : true })}>
                            {toggleSwitch(m.checkOffice === true, '#0a9b86')}
                            {numBadge('#0a9b86', 3)}
                            <span style={{ fontFamily: "'Bebas Neue', Impact, sans-serif", fontSize: '1.15rem', fontWeight: 400, letterSpacing: '.03em', color: 'var(--white)' }}>Drop Off At Office</span>
                            <span aria-hidden="true" style={{ marginLeft: 'auto', fontSize: '1.65rem', lineHeight: 1 }}>🏠</span>
                          </div>
                          {(
                            <div style={bodyPad}>
                              <label style={label}>Office address</label>
                              {addressField({ value: m.dropoffAddress || '', onChange: (v) => patchType(t, { dropoffAddress: v }), placeholder: '' })}
                              {accountAddress && (m.dropoffAddress || '').trim() !== accountAddress && applyLink(accountAddress, () => patchType(t, { dropoffAddress: accountAddress }))}
                              <label style={{ ...label, marginTop: '.7rem' }}>Open hours</label>
                              <input value={m.dropoffHours || ''} placeholder="Mon–Fri 10am–6pm" onChange={(e) => patchType(t, { dropoffHours: e.target.value })} style={field} />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                  {cfg.contactLabel && t !== 'check' && (
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

                  {/* Drop-off — cash + check, behind a button because most DJs
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
                            background: 'transparent', border: '1px solid var(--neon)',
                            borderRadius: 6, color: 'var(--neon)', fontSize: '.68rem',
                            padding: '.45rem .8rem', cursor: 'pointer',
                            fontFamily: "'Space Mono', monospace", letterSpacing: '.06em',
                            textTransform: 'uppercase', fontWeight: 700,
                          }}
                        >
                          + Add office address for drop-off
                        </button>
                      ) : (
                        <>
                          <label style={label}>Office address (optional)</label>
                          {addressField({
                            value: m.dropoffAddress || '',
                            onChange: (v) => patchType(t, { dropoffAddress: v }),
                            placeholder: '',
                          })}
                          {accountAddress && (m.dropoffAddress || '').trim() !== accountAddress && (
                            <button
                              type="button"
                              onClick={() => patchType(t, { dropoffAddress: accountAddress })}
                              style={{
                                marginTop: '.35rem', background: 'transparent', border: 'none', padding: 0,
                                color: 'var(--neon)', fontSize: '.7rem', cursor: 'pointer',
                                fontFamily: "'Space Mono', monospace", textDecoration: 'underline',
                              }}
                            >
                              {`Apply ${accountAddress}`}
                            </button>
                          )}
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
                  {t !== 'check' && t !== 'cash' && t !== 'cashapp' && t !== 'paypal' && t !== 'venmo' && t !== 'zelle' && (
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
              {cfg.footnote && (<p style={{ margin: '.9rem 0 0', fontSize: '.68rem', color: 'var(--muted)', lineHeight: 1.5 }}>{cfg.footnote}</p>)}
              {/* Off-app manual rails: we can't see the money land, so the DJ
                  marks it paid themselves and the receipt fires from there. Sits
                  at the bottom, just above the Save/Activate button. */}
              {(t === 'venmo' || t === 'cashapp' || t === 'zelle' || t === 'cash' || t === 'check') && (
                <p style={{ margin: '.9rem 0 0', color: '#f5c451', fontSize: '.82rem', lineHeight: 1.55 }}>
                  {t === 'check'
                    ? 'Global DJ Connect can’t track Check payments off-app. When the check is received and has cleared, mark it paid in your booking dashboard and the receipt will auto-send.'
                    : t === 'cash'
                    ? 'Global DJ Connect can’t track Cash payments off-app. When cash has been received, mark it paid in your booking dashboard and the receipt will auto-send.'
                    : `Global DJ Connect can’t track ${cfg.label} payments off-app. When payment is complete, mark it paid in your booking dashboard and the receipt will auto-send.`}
                </p>
              )}
              <div style={{ display: 'flex', gap: '.6rem', marginTop: '.9rem', flexWrap: 'wrap' }}>
                {isSavedLive(t) && (
                  <button type="button" onClick={() => setConfirmingRemove(t)} style={btn(false)}>
                    Remove this payment option
                  </button>
                )}
                {/* Confirm pop-up — centered modal over a dark scrim. Portaled to
                    <body> so no parent overflow/transform can clip it. */}
                {mounted && confirmingRemove === t && createPortal(
                  <div
                    onClick={() => setConfirmingRemove(null)}
                    style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
                  >
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: '100%', maxWidth: 380, background: '#121317', border: '1px solid rgba(255,255,255,.14)', borderRadius: 12, padding: '1.3rem', boxShadow: '0 24px 60px rgba(0,0,0,.5)' }}
                    >
                      <div style={{ fontFamily: "'Bebas Neue', Impact, sans-serif", fontSize: '1.4rem', letterSpacing: '.03em', color: '#f4f6f8', marginBottom: '.5rem' }}>Remove this payment option?</div>
                      <p style={{ margin: '0 0 1.1rem', fontSize: '.85rem', color: '#8d95a0', lineHeight: 1.5 }}>This payment option will be removed and its details cleared. You can add it back any time.</p>
                      <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <button type="button" onClick={() => setConfirmingRemove(null)} style={btn(false)}>Cancel</button>
                        <button type="button" onClick={() => removeType(t)} style={{ ...btn(false), borderColor: '#ff6b6b', color: '#ff6b6b' }}>Yes, remove</button>
                      </div>
                    </div>
                  </div>,
                  document.body
                )}
                {/* Disabled until the rail would actually work. Before this,
                    Activate on an empty tile ran the save, dropped the empty
                    row on the floor (the save filters them out), and reported
                    "✓ Saved" — so the DJ walked away believing Zelle was on
                    when their clients would never see it. A button that lies
                    about succeeding is worse than one that won't press. */}
                {(() => {
                  // The button stays PRESSABLE even when required fields are
                  // empty — a greyed-out button just leaves the DJ wondering why
                  // nothing happens. Pressing it runs save(), which flips
                  // `attempted` and highlights the missing field(s) in red with
                  // an inline reason. It only goes truly inert when there's
                  // nothing to do: mid-save, already-saved-and-unchanged, or the
                  // PayPal manual rail overridden by Connect.
                  const actionable = !saving && !nothingToSave && !paypalManualDisabled;
                  return (
                    <button
                      type="button"
                      onClick={() => void save()}
                      disabled={saving || nothingToSave || paypalManualDisabled}
                      title={
                        paypalManualDisabled ? 'PayPal is connected via Option 1 — manual option not needed.'
                          : nothingToSave ? 'Already saved — nothing to update.'
                          : complete ? undefined
                          : 'Fill in the required fields — press to see what’s missing'
                      }
                      style={{
                        marginLeft: 'auto',
                        background: actionable ? 'var(--neon)' : 'transparent',
                        color: actionable ? '#04121a' : 'var(--muted)',
                        border: `1px solid ${actionable ? 'var(--neon)' : 'var(--border)'}`,
                        borderRadius: 7,
                        padding: '.55rem 1.2rem',
                        fontFamily: "'Space Mono', monospace",
                        fontSize: '.62rem',
                        fontWeight: 700,
                        letterSpacing: '.06em',
                        textTransform: 'uppercase',
                        cursor: actionable ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {saving ? 'Saving…' : !isSavedLive(t) ? 'Activate' : nothingToSave ? '✓ Saved' : 'Save'}
                    </button>
                  );
                })()}
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
