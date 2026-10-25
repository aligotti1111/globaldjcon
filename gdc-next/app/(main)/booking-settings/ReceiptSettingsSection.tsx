'use client';

// Receipt tab (Booking Settings, subscribed DJs). Controls what shows on the
// invoices and receipts emailed to clients — the business LOGO (shared with
// contracts/planner), a receipt-only ADDRESS entered as discrete fields
// (street + city + state + ZIP, with the same autocomplete the account edit
// page uses), and the receipt's accent COLOUR — with a live PDF sample.
//
// The address and colour are isolated: they only affect receipts, never the
// account address or anything derived from it.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import BusinessLogoSection from '../update-dj-profile/BusinessLogoSection';
import SectionBanner from '../update-dj-profile/SectionBanner';
import { searchAddresses, COUNTRIES, COUNTRY_CODES_ADDR, type AddressSuggestion } from '../account-settings/helpers';

// 2-letter ISO code → flag emoji (regional-indicator letters). Matches the
// booking request's country selector, which shows "🇺🇸 US" style options.
function flagEmoji(code: string): string {
  const cc = (code || '').trim().toUpperCase();
  if (cc.length !== 2 || !/^[A-Z]{2}$/.test(cc)) return '';
  const base = 0x1f1e6;
  return String.fromCodePoint(base + (cc.charCodeAt(0) - 65), base + (cc.charCodeAt(1) - 65));
}

// Format a phone number with dashes. US/Canada (NANP) get (###) ###-####; any
// other country just gets its digits grouped in threes with dashes, since digit
// counts vary. A leading "+" (country code) is kept. Formats progressively as
// the DJ types, and never drops digits beyond the format's capacity.
function formatPhone(raw: string, country: string): string {
  const hasPlus = raw.trim().startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (!digits) return hasPlus ? '+' : '';
  if (country === 'United States' || country === 'Canada') {
    const intl = digits.length === 11 && digits[0] === '1';
    const d = intl ? digits.slice(1) : digits;
    const a = d.slice(0, 3), b = d.slice(3, 6), c = d.slice(6, 10);
    let out = '';
    if (d.length > 6) out = `(${a}) ${b}-${c}`;
    else if (d.length > 3) out = `(${a}) ${b}`;
    else if (d.length > 0) out = d.length === 3 ? `(${a}) ` : `(${a}`;
    // Any extra digits beyond 10 just trail on so nothing is silently lost.
    if (d.length > 10) out += d.slice(10);
    return intl ? `+1 ${out}` : out;
  }
  const groups = digits.match(/.{1,3}/g) || [];
  return (hasPlus ? '+' : '') + groups.join('-');
}

const DEFAULT_COLOR = '#00e0a4';
const DEFAULT_COUNTRY = 'United States';

// US state/territory abbreviations for the State dropdown.
const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR',
];

type AddrFields = { street: string; city: string; state: string; zip: string; country: string };

function parseCityLine(s: string): { city: string; state: string; zip: string } {
  const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length === 0) return { city: '', state: '', zip: '' };
  const last = parts[parts.length - 1];
  const m = last.match(/^([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)?$/);
  if (m) return { city: parts.slice(0, parts.length - 1).join(', '), state: m[1].toUpperCase(), zip: m[2] || '' };
  return { city: parts.join(', '), state: '', zip: '' };
}

// Parse a stored address. New format is newline-stacked (street / "city, ST zip"
// / country). Older rows are a single comma line — handled too.
function parseAddress(s: string): AddrFields {
  const text = (s || '').trim();
  if (!text) return { street: '', city: '', state: '', zip: '', country: DEFAULT_COUNTRY };
  // New exact format: a JSON object of the discrete fields. No guessing — the
  // street/city/state/zip round-trip exactly, including when any is cleared.
  if (text.startsWith('{')) {
    try {
      const o = JSON.parse(text) as Partial<AddrFields>;
      return {
        street: (o.street || '').trim(),
        city: (o.city || '').trim(),
        state: (o.state || '').trim(),
        zip: (o.zip || '').trim(),
        country: (o.country || '').trim() || DEFAULT_COUNTRY,
      };
    } catch { /* fall through to legacy string parsing */ }
  }
  // Stacked format (any newline present): line 0 = street (may be EMPTY when the
  // DJ cleared it), line 1 = "city, ST zip", optional trailing country line. We
  // do NOT drop empty lines here — an empty first line keeps the city from
  // sliding up into the street field on reload.
  if ((s || '').includes('\n')) {
    const lines = (s || '').split('\n').map((x) => x.trim());
    let country = DEFAULT_COUNTRY;
    // A trailing non-empty line with no digits is the country (city lines carry a ZIP).
    if (lines.length >= 2 && lines[lines.length - 1] && !/\d/.test(lines[lines.length - 1])) country = lines.pop() || DEFAULT_COUNTRY;
    const street = lines[0] || '';
    const { city, state, zip } = parseCityLine(lines.slice(1).join(', '));
    return { street, city, state, zip, country };
  }
  // Legacy single comma line: first part = street, the rest = city/state/zip.
  const parts = text.split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length === 1) {
    // A bare "ST ZIP" (street and city both cleared before the stacked format)
    // is state/zip, not a street — don't put it in the Street field.
    const m = parts[0].match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (m) return { street: '', city: '', state: m[1].toUpperCase(), zip: m[2], country: DEFAULT_COUNTRY };
    return { street: parts[0], city: '', state: '', zip: '', country: DEFAULT_COUNTRY };
  }
  // "City, ST ZIP" with no street (e.g. an address whose street was cleared and
  // saved before the stacked format) must NOT read the city as the street. If
  // the first part doesn't look like a street — no leading house number and no
  // common street suffix — and the rest is a clean "ST ZIP", treat it as the
  // city line with an empty street.
  if (parts.length === 2 && /^[A-Za-z]{2}\s*\d{5}(?:-\d{4})?$/.test(parts[1])
    && !/\d/.test(parts[0]) && !/\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place|pkwy|parkway|hwy|highway|ter|terrace|cir|circle)\b/i.test(parts[0])) {
    const { city, state, zip } = parseCityLine(parts.join(', '));
    return { street: '', city, state, zip, country: DEFAULT_COUNTRY };
  }
  const { city, state, zip } = parseCityLine(parts.slice(1).join(', '));
  return { street: parts[0], city, state, zip, country: DEFAULT_COUNTRY };
}

// The value PERSISTED to users.receipt_address: an exact JSON object of the
// discrete fields so street/city/state/zip round-trip with zero guessing. '' is
// stored when every field is blank (so "no address on receipts").
function storeAddress(f: AddrFields): string {
  const street = f.street.trim(), city = f.city.trim(), state = f.state.trim(), zip = f.zip.trim();
  const country = f.country.trim() || DEFAULT_COUNTRY;
  if (!street && !city && !state && !zip) return '';
  return JSON.stringify({ street, city, state, zip, country });
}

// The DISPLAY string for the live preview: newline-stacked street / "city, ST
// zip" / country (country only when it isn't the US default). Blank lines are
// dropped — this is for showing, not storing.
function displayAddress(f: AddrFields): string {
  const stateZip = [f.state.trim(), f.zip.trim()].filter(Boolean).join(' ');
  const cityLine = [f.city.trim(), stateZip].filter(Boolean).join(', ');
  const c = f.country.trim();
  const countryLine = (c && c !== DEFAULT_COUNTRY) ? c : '';
  return [f.street.trim(), cityLine, countryLine].filter(Boolean).join('\n');
}

export default function ReceiptSettingsSection({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void } = {}) {
  const [accountAddress, setAccountAddress] = useState('');
  const [acctParts, setAcctParts] = useState<{ city: string; state: string; zip: string }>({ city: '', state: '', zip: '' });
  const [usingDefault, setUsingDefault] = useState(true); // receipt_address === null
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [stateVal, setStateVal] = useState('');
  const [zip, setZip] = useState('');
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [colorIsDefault, setColorIsDefault] = useState(true);
  const [accountPhone, setAccountPhone] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneDefault, setPhoneDefault] = useState(true); // receipt_phone === null
  // Auto-send-receipt toggles — on by default.
  const [autoDeposit, setAutoDeposit] = useState(true);
  const [autoBalance, setAutoBalance] = useState(true);
  // What sits behind the logo on the (always-white) documents, so a white, grey
  // or dark logo each stays visible. Defaults to a light-grey plate.
  const [logoBacking, setLogoBacking] = useState<'none' | 'light' | 'dark'>('light');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Live-preview inputs (logo + business name), so the HTML sample updates
  // instantly on every edit with no server round-trip.
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [bizName, setBizName] = useState('');
  // Which sample the preview shows — a deposit receipt or a balance receipt.
  const [sampleKind, setSampleKind] = useState<'deposit' | 'balance'>('deposit');

  // Address autocomplete state.
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSug, setShowSug] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Last-saved values, per field — used to detect unsaved edits so we can warn
  // the DJ before they leave the page with changes they didn't Save.
  const baseline = useRef<{ street: string; city: string; stateVal: string; zip: string; country: string; phone: string; color: string; autoDeposit: boolean; autoBalance: boolean; logoBacking: 'none' | 'light' | 'dark' }>({ street: '', city: '', stateVal: '', zip: '', country: DEFAULT_COUNTRY, phone: '', color: DEFAULT_COLOR, autoDeposit: true, autoBalance: true, logoBacking: 'light' });


  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/dj/receipt-settings');
        const j = (await r.json().catch(() => ({}))) as { receiptAddress?: string | null; accountAddress?: string; accountCity?: string; accountState?: string; accountZip?: string; receiptColor?: string | null; receiptPhone?: string | null; accountPhone?: string; businessName?: string; logoUrl?: string | null; autoDeposit?: boolean; autoBalance?: boolean; logoBacking?: string };
        if (!alive) return;
        const iAutoDep = j.autoDeposit !== false;
        const iAutoBal = j.autoBalance !== false;
        setAutoDeposit(iAutoDep); setAutoBalance(iAutoBal);
        const iLogoBacking: 'none' | 'light' | 'dark' = (j.logoBacking === 'none' || j.logoBacking === 'dark') ? j.logoBacking : 'light';
        setLogoBacking(iLogoBacking);
        setBizName(j.businessName || '');
        setLogoUrl(j.logoUrl ?? null);
        setAccountAddress(j.accountAddress || '');
        setAcctParts({ city: j.accountCity || '', state: j.accountState || '', zip: j.accountZip || '' });
        let iStreet: string, iCity: string, iState: string, iZip: string, iCountry: string;
        if (j.receiptAddress == null) {
          // Default (no custom receipt address): prefill from the account. City /
          // state / ZIP come from the reliable account columns (ZIP is required
          // at signup), so the ZIP field is never blank even if the stored
          // address line didn't include it. Street parsed from the line.
          const f = parseAddress(j.accountAddress || '');
          iStreet = f.street; iCity = j.accountCity || f.city; iState = j.accountState || f.state; iZip = j.accountZip || f.zip; iCountry = f.country;
        } else {
          const f = parseAddress(j.receiptAddress);
          iStreet = f.street; iCity = f.city; iState = f.state; iZip = f.zip; iCountry = f.country;
        }
        setStreet(iStreet); setCity(iCity); setStateVal(iState); setZip(iZip); setCountry(iCountry);
        setUsingDefault(j.receiptAddress == null);
        const iColor = (j.receiptColor && /^#[0-9a-fA-F]{6}$/.test(j.receiptColor)) ? j.receiptColor : DEFAULT_COLOR;
        if (j.receiptColor && /^#[0-9a-fA-F]{6}$/.test(j.receiptColor)) { setColor(j.receiptColor); setColorIsDefault(false); }
        else { setColor(DEFAULT_COLOR); setColorIsDefault(true); }
        setAccountPhone(j.accountPhone || '');
        const rawPhone = j.receiptPhone == null ? (j.accountPhone || '') : j.receiptPhone;
        const iPhone = formatPhone(rawPhone, iCountry);
        setPhone(iPhone);
        setPhoneDefault(j.receiptPhone == null);
        // Baseline = what's currently persisted, so nothing reads as "unsaved" on load.
        baseline.current = { street: iStreet, city: iCity, stateVal: iState, zip: iZip, country: iCountry, phone: iPhone, color: iColor, autoDeposit: iAutoDep, autoBalance: iAutoBal, logoBacking: iLogoBacking };
      } catch { /* optional */ }
      finally { if (alive) setLoaded(true); }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // Re-format the phone whenever the country changes, so switching country
  // adapts the existing number's dashes (US/Canada ↔ other). Idempotent, so it
  // no-ops when the format already matches.
  useEffect(() => {
    if (!loaded) return;
    setPhone((p) => formatPhone(p, country));
  }, [country, loaded]);

  function onStreetChange(val: string) {
    setStreet(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (val.trim().length < 5) { setSuggestions([]); setShowSug(false); return; }
    timerRef.current = setTimeout(async () => {
      const results = await searchAddresses(val.trim(), '');
      setSuggestions(results); setShowSug(results.length > 0);
    }, 600);
  }
  function onPick(s: AddressSuggestion) {
    setStreet(s.street); setCity(s.city); setStateVal(s.state); setZip(s.zip);
    setShowSug(false);
  }

  async function post(body: Record<string, string | null | boolean>, note: string) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/dj/receipt-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('save failed');
      setMsg(note);
    } catch { setMsg('Could not save — try again.'); }
    finally { setBusy(false); }
  }

  // One Save button persists EVERYTHING on the tab in a single request —
  // address, phone, colour and the two auto-send toggles.
  async function saveAll() {
    const composed = storeAddress({ street, city, state: stateVal, zip, country });
    const colorOk = /^#[0-9a-fA-F]{6}$/.test(color);
    await post({
      address: composed,
      phone,
      color: colorOk ? color : '',
      autoDeposit,
      autoBalance,
      logoBacking,
    }, '✓ Receipt settings saved.');
    setUsingDefault(composed === '');
    setPhoneDefault(false);
    setColorIsDefault(!colorOk);
    baseline.current = { street, city, stateVal, zip, country, phone, color: colorOk ? color : DEFAULT_COLOR, autoDeposit, autoBalance, logoBacking };
  }
  // Secondary resets — local only; the change is persisted by the Save button.
  function clearAddress() { setStreet(''); setCity(''); setStateVal(''); setZip(''); }
  function clearPhone() { setPhone(''); }
  function resetColor() { setColor(DEFAULT_COLOR); }

  // Unsaved-changes guard: true when any field differs from what's persisted.
  const dirty = loaded && (
    street !== baseline.current.street || city !== baseline.current.city ||
    stateVal !== baseline.current.stateVal || zip !== baseline.current.zip ||
    country !== baseline.current.country || phone !== baseline.current.phone ||
    color !== baseline.current.color ||
    autoDeposit !== baseline.current.autoDeposit || autoBalance !== baseline.current.autoBalance ||
    logoBacking !== baseline.current.logoBacking
  );
  // Report dirty state up so the tab bar shows its "unsaved" dot.
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  // Warn the DJ if they try to leave (close/refresh/navigate away) with edits
  // they haven't Saved. The browser shows its native "leave site?" prompt.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const label: CSSProperties = { display: 'block', fontSize: '.95rem', fontWeight: 600, color: '#ececf3', margin: '0 0 .35rem' };
  const hint: CSSProperties = { fontSize: '.82rem', color: 'rgba(235,235,245,.55)', lineHeight: 1.5, margin: '0 0 .7rem' };
  const input: CSSProperties = {
    width: '100%', boxSizing: 'border-box', fontSize: '.9rem', color: '#fff', background: 'rgba(255,255,255,.04)',
    border: '1px solid rgba(255,255,255,.14)', borderRadius: 10,
    // Fixed height + vertical-centered text so <input> and <select> fields line
    // up at the same height (selects render shorter than inputs by default).
    height: 40, padding: '0 .75rem', lineHeight: '38px',
  };
  const fieldLabel: CSSProperties = { fontSize: '.72rem', color: 'rgba(235,235,245,.6)', margin: '0 0 .25rem', display: 'block' };
  const btn = (bg: string, fg: string): CSSProperties => ({
    background: bg, color: fg, border: 'none', borderRadius: 8, padding: '.55rem 1rem',
    fontWeight: 700, fontSize: '.85rem', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
  });
  const linkBtn: CSSProperties = {
    background: 'none', border: 'none', color: '#00e0a4', fontSize: '.82rem', fontWeight: 600,
    cursor: busy ? 'default' : 'pointer', padding: 0, textDecoration: 'underline',
  };

  return (
    <>
      <SectionBanner
        icon="payments"
        title="Receipts"
        subtitle="Your logo, address, colour and automatic-receipt settings for every invoice and receipt."
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '1.6rem', alignItems: 'start', marginTop: '1.2rem' }} className="gdcReceiptGrid">
      <style>{`@media (max-width: 760px){ .gdcReceiptGrid{ grid-template-columns: 1fr !important; } }`}</style>

      {/* ── Left: editable settings ── */}
      <div>
        <p style={{ ...hint, margin: '0 0 1.2rem' }}>
          Your logo, business address and brand colour appear on every invoice and
          receipt your clients receive. Set them here and watch the sample update.
        </p>

        {/* Logo + its backing choice, side by side: logo LEFT, the three backing
            radios (colour labels only) to its RIGHT. */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '1.4rem' }}>
          <BusinessLogoSection label="Add/Edit Logo" description={null} onLogoChange={setLogoUrl} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {([
              { v: 'none' as const, label: 'None' },
              { v: 'light' as const, label: 'Light grey' },
              { v: 'dark' as const, label: 'Dark' },
            ]).map((o) => (
              <label key={o.v} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: (!loaded || busy) ? 'default' : 'pointer' }}>
                <input
                  type="radio"
                  name="receiptLogoBacking"
                  checked={logoBacking === o.v}
                  disabled={!loaded || busy}
                  onChange={() => setLogoBacking(o.v)}
                  style={{ accentColor: '#00e0a4', cursor: 'inherit' }}
                />
                <span style={{ fontSize: '.9rem', fontWeight: 600, color: '#ececf3' }}>{o.label}</span>
              </label>
            ))}
          </div>

          {/* Receipt accent colour — sits beside the logo + backing options. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
            <span style={{ fontSize: '.8rem', fontWeight: 600, color: 'rgba(235,235,245,.75)' }}>Receipt accent color</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
              <input type="color" value={color} disabled={!loaded || busy} onChange={(e) => setColor(e.target.value)}
                style={{ width: 46, height: 34, border: '1px solid rgba(255,255,255,.14)', borderRadius: 8, background: 'transparent', cursor: 'pointer', padding: 2 }} />
              <input type="text" value={color} disabled={!loaded || busy}
                onChange={(e) => { const v = e.target.value; setColor(v.startsWith('#') ? v : '#' + v); }}
                style={{ ...input, width: 110, fontFamily: 'monospace' }} maxLength={7} />
              {color.toLowerCase() !== DEFAULT_COLOR && <button type="button" style={linkBtn} disabled={busy} onClick={resetColor}>Reset</button>}
            </div>
          </div>
        </div>

        {/* Address — discrete fields with autocomplete. */}
        <label style={label}>Business address on receipts</label>

        {/* Street address + Country on one line. Country shows flag + ISO code,
            matching the booking request's selector. */}
        <div style={{ display: 'flex', gap: '.6rem', alignItems: 'flex-start' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
            <span style={fieldLabel}>Street address</span>
            <input
              type="text" value={street} disabled={!loaded || busy} autoComplete="off"
              onChange={(e) => onStreetChange(e.target.value)}
              onBlur={() => setTimeout(() => setShowSug(false), 150)}
              onFocus={() => { if (suggestions.length > 0) setShowSug(true); }}
              style={input}
            />
            {showSug && suggestions.length > 0 && (
              <div style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%', marginTop: 4, background: '#14141f', border: '1px solid rgba(255,255,255,.16)', borderRadius: 10, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,.5)' }}>
                {suggestions.map((sg, i) => (
                  <div key={i} onMouseDown={(e) => { e.preventDefault(); onPick(sg); }}
                    style={{ padding: '8px 12px', fontSize: '.82rem', color: '#e8e8f0', cursor: 'pointer', borderBottom: i < suggestions.length - 1 ? '1px solid rgba(255,255,255,.07)' : 'none' }}>
                    {sg.display.length > 60 ? sg.display.slice(0, 60) + '…' : sg.display}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ width: 96, flexShrink: 0 }}>
            <span style={fieldLabel}>Country</span>
            <select value={country} disabled={!loaded || busy} onChange={(e) => setCountry(e.target.value)} style={input} aria-label="Country">
              {country && !COUNTRIES.includes(country) && <option value={country}>{country}</option>}
              {COUNTRIES.filter((c) => c !== 'Other').map((c) => {
                const code = (COUNTRY_CODES_ADDR[c] || '').toUpperCase();
                const flag = flagEmoji(code);
                return <option key={c} value={c}>{flag ? `${flag} ` : ''}{code || c}</option>;
              })}
            </select>
          </div>
        </div>

        {/* City / State / ZIP — equal-width columns. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '.6rem', marginTop: '.7rem' }}>
          <div><span style={fieldLabel}>City</span><input type="text" value={city} disabled={!loaded || busy} onChange={(e) => setCity(e.target.value)} style={input} /></div>
          <div>
            <span style={fieldLabel}>State</span>
            {country === DEFAULT_COUNTRY ? (
              <select value={stateVal} disabled={!loaded || busy} onChange={(e) => setStateVal(e.target.value)} style={input}>
                <option value="">—</option>
                {stateVal && !US_STATES.includes(stateVal) && <option value={stateVal}>{stateVal}</option>}
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <input type="text" value={stateVal} disabled={!loaded || busy} onChange={(e) => setStateVal(e.target.value)} placeholder="Region" style={input} />
            )}
          </div>
          <div><span style={fieldLabel}>ZIP</span><input type="text" value={zip} disabled={!loaded || busy} onChange={(e) => setZip(e.target.value)} style={input} /></div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', marginTop: '.6rem' }}>
          <button type="button" style={linkBtn} disabled={!loaded || busy} onClick={clearAddress}>Clear address</button>
        </div>

        {/* Phone — receipt-only, independent of the account phone. */}
        <label style={{ ...label, margin: '1.6rem 0 .35rem' }}>Phone on receipts</label>
        <input type="tel" value={phone} disabled={!loaded || busy} onChange={(e) => setPhone(formatPhone(e.target.value, country))}
          style={{ ...input, maxWidth: 260 }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', marginTop: '.6rem' }}>
          <button type="button" style={linkBtn} disabled={!loaded || busy} onClick={clearPhone}>Clear phone</button>
        </div>

        {/* Auto-send receipt toggles — on by default. */}
        <label style={{ ...label, margin: '1.6rem 0 .35rem' }}>Automatic receipts</label>
        <p style={hint}>Email the host a receipt automatically when a payment is marked paid. Turn either off to send receipts only by hand.</p>
        <Toggle checked={autoDeposit} disabled={!loaded || busy} onChange={setAutoDeposit} label="Auto-send receipt after deposit is paid" />
        <div style={{ height: 8 }} />
        <Toggle checked={autoBalance} disabled={!loaded || busy} onChange={setAutoBalance} label="Auto-send receipt after balance is paid" />

        {msg && <div style={{ marginTop: '.8rem', fontSize: '.82rem', color: '#8a8aa0' }}>{msg}</div>}
      </div>

      {/* ── Right: live HTML sample (instant — mirrors the receipt PDF) ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.5rem' }}>
          <span style={{ fontSize: '.7rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#8a8aa0' }}>Sample receipt</span>
          <a href={`/api/dj/receipt-sample?kind=${sampleKind}`} target="_blank" rel="noopener noreferrer" style={{ ...linkBtn, textDecoration: 'underline' }}>View exact PDF</a>
        </div>
        {/* Deposit / Balance sample switch. */}
        <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 999, padding: 3, marginBottom: '.6rem' }}>
          {(['deposit', 'balance'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setSampleKind(k)}
              style={{
                border: 'none', cursor: 'pointer', borderRadius: 999, padding: '.3rem .9rem',
                fontSize: '.72rem', fontWeight: 700, letterSpacing: '.02em', textTransform: 'capitalize',
                background: sampleKind === k ? '#00e0a4' : 'transparent',
                color: sampleKind === k ? '#06231b' : '#aab',
              }}>
              {k}
            </button>
          ))}
        </div>
        <ReceiptPreview
          logoUrl={logoUrl}
          name={bizName || 'Your Business Name'}
          address={displayAddress({ street, city, state: stateVal, zip, country })}
          phone={phone.trim()}
          accent={/^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_COLOR}
          kind={sampleKind}
          logoBacking={logoBacking}
        />
        <p style={{ ...hint, margin: '.5rem 0 0' }}>
          Live preview with placeholder event details — your logo, address, phone and colour update instantly.
          &ldquo;View exact PDF&rdquo; opens the real generated receipt.
        </p>
      </div>
      </div>

      {/* One Save button for the whole tab — full width, right-aligned. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'flex-end', marginTop: '1.4rem' }}>
        {dirty && <span style={{ fontSize: '.8rem', color: '#f0b64a', display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f0b64a', display: 'inline-block' }} />Unsaved changes</span>}
        <button type="button" style={{ ...btn('#00e0a4', '#06231b'), opacity: (!loaded || busy || !dirty) ? 0.4 : 1, cursor: (!loaded || busy || !dirty) ? 'not-allowed' : 'pointer' }} disabled={!loaded || busy || !dirty} onClick={saveAll}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </>
  );
}

// Small pill switch used for the auto-send-receipt toggles.
function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '.7rem', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
      <button
        type="button" role="switch" aria-checked={checked} disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        style={{
          width: 40, height: 22, borderRadius: 999, border: 'none', flexShrink: 0, position: 'relative',
          background: checked ? '#00e0a4' : 'rgba(255,255,255,.18)', cursor: disabled ? 'default' : 'pointer',
          transition: 'background .15s',
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: checked ? 20 : 2, width: 18, height: 18, borderRadius: '50%',
          background: '#fff', transition: 'left .15s',
        }} />
      </button>
      <span style={{ fontSize: '.88rem', color: '#ececf3' }}>{label}</span>
    </label>
  );
}

// ── Live HTML receipt preview — mirrors the generated PDF layout, updates
// instantly from props. Placeholder event details; logo/address/phone/colour
// are the DJ's real settings. ────────────────────────────────────────────────
function ReceiptPreview({ logoUrl, name, address, phone, accent, kind, logoBacking }: {
  logoUrl: string | null; name: string; address: string; phone: string; accent: string; kind: 'deposit' | 'balance'; logoBacking: 'none' | 'light' | 'dark';
}) {
  const ink = '#1a1a2e';
  const muted = '#777';
  const line = '1px solid #e5e5e5';
  const row: CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 12.5, color: ink };
  const sec: CSSProperties = { fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: '#999', margin: '0 0 4px' };
  // On a DARK header band the business text must flip to light to stay legible;
  // on a light-grey (or no) band the normal dark ink reads fine.
  const headerInk = logoBacking === 'dark' ? '#ffffff' : ink;
  const headerMuted = logoBacking === 'dark' ? '#c9c9d2' : muted;
  return (
    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid rgba(255,255,255,.14)', padding: '26px 28px', color: ink, minHeight: 540 }}>
      {/* Header: left business block, right title/date/reference. The chosen
          backing colours the WHOLE header band — not just behind the logo — so
          on a dark band the business text flips to white to stay legible. */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16,
        ...(logoBacking === 'none' ? {} : {
          background: logoBacking === 'dark' ? '#1c1c22' : '#dedee4',
          padding: '16px 18px', borderRadius: 8,
        }),
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, minWidth: 0 }}>
          {logoUrl
            /* eslint-disable-next-line @next/next/no-img-element */
            ? <img src={logoUrl} alt="logo" style={{ maxWidth: 150, maxHeight: 64, objectFit: 'contain', display: 'block', flexShrink: 0 }} />
            : null}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: headerInk }}>{name}</div>
            {address.split('\n').filter(Boolean).map((ln, i) => (
              <div key={i} style={{ color: headerMuted, fontSize: 11, marginTop: i === 0 ? 3 : 1 }}>{ln}</div>
            ))}
            {phone && <div style={{ color: headerMuted, fontSize: 11, marginTop: 2 }}>{phone}</div>}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: accent, letterSpacing: '.02em' }}>RECEIPT</div>
          <div style={{ color: headerMuted, fontSize: 11, marginTop: 4 }}>June 20, 2026</div>
          <div style={{ color: headerMuted, fontSize: 11 }}>Reference: GDC-SAMPLE</div>
        </div>
      </div>
      <hr style={{ border: 'none', borderTop: line, margin: '16px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}>
        <div><div style={sec}>Received From</div><div style={{ fontWeight: 700, fontSize: 12.5 }}>Sample Client</div><div style={{ color: muted, fontSize: 12 }}>client@example.com</div></div>
        <div style={{ textAlign: 'right' }}><div style={sec}>Event</div><div style={{ fontSize: 12.5 }}>Wedding Reception</div><div style={{ color: muted, fontSize: 12 }}>Sat, Jun 20, 2026<br />The Grand Ballroom<br />6:00 PM – 11:00 PM</div></div>
      </div>
      <hr style={{ border: 'none', borderTop: line, margin: '16px 0' }} />
      <div style={sec}>Details</div>
      <div style={{ ...row, color: muted }}><span>Event Type</span><span style={{ color: ink }}>Wedding</span></div>
      <div style={{ ...row, color: muted }}><span>Package Name</span><span style={{ color: ink }}>Signature DJ Package</span></div>
      <div style={{ ...row, color: muted }}><span>Package Includes</span><span style={{ color: ink }}>DJ &amp; MC · premium sound · dance lighting</span></div>
      <hr style={{ border: 'none', borderTop: line, margin: '14px 0 2px' }} />
      {kind === 'deposit' ? (
        <>
          <div style={row}><span>Event total (incl. tax)</span><span>$2,400.00</span></div>
          <div style={{ ...row, fontWeight: 700 }}><span>Deposit Received (25%)</span><span>$600.00</span></div>
          <div style={{ ...row, color: muted, borderTop: line, marginTop: 4, paddingTop: 9 }}><span>Remaining balance</span><span>$1,800.00</span></div>
          <div style={{ marginTop: 16, background: '#f4fbf8', border: `1px solid ${accent}`, borderRadius: 8, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', fontWeight: 800, color: accent }}>
            <span style={{ color: ink }}>DEPOSIT RECEIVED</span><span>$600.00</span>
          </div>
        </>
      ) : (
        <>
          <div style={{ ...row, color: muted }}><span>Event Total</span><span>$2,204.13</span></div>
          <div style={{ ...row, color: muted }}><span>Tax</span><span>$195.87</span></div>
          <div style={{ ...row, fontWeight: 700 }}><span>Total Cost</span><span>$2,400.00</span></div>
          <div style={{ ...row, fontWeight: 700, borderTop: line, marginTop: 4, paddingTop: 9 }}><span>Deposit Received</span><span>$600.00</span></div>
          <div style={{ ...row, fontWeight: 700 }}><span>Balance Received</span><span>$1,800.00</span></div>
          <div style={{ marginTop: 16, background: '#f4fbf8', border: `1px solid ${accent}`, borderRadius: 8, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', fontWeight: 800, color: accent }}>
            <span style={{ color: ink }}>PAID IN FULL</span><span>$2,400.00</span>
          </div>
        </>
      )}
    </div>
  );
}
