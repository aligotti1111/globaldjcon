'use client';

// Receipt tab (Booking Settings, subscribed DJs). Controls what shows on the
// invoices and receipts emailed to clients — the business LOGO (shared with
// contracts/planner), a receipt-only ADDRESS entered as discrete fields
// (street + city + state + ZIP, with the same autocomplete the account edit
// page uses), and the receipt's accent COLOUR — with a live PDF sample.
//
// The address and colour are isolated: they only affect receipts, never the
// account address or anything derived from it.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import BusinessLogoSection from '../update-dj-profile/BusinessLogoSection';
import { searchAddresses, type AddressSuggestion } from '../account-settings/helpers';

const DEFAULT_COLOR = '#00e0a4';

// Best-effort split of a stored "street, city, ST zip" line back into fields.
function parseAddress(s: string): { street: string; city: string; state: string; zip: string } {
  const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length === 0) return { street: '', city: '', state: '', zip: '' };
  if (parts.length === 1) return { street: parts[0], city: '', state: '', zip: '' };
  const last = parts[parts.length - 1];
  const m = last.match(/^([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)?$/);
  if (m) {
    return {
      street: parts.slice(0, parts.length - 2).join(', ') || parts[0],
      city: parts.length >= 3 ? parts[parts.length - 2] : '',
      state: m[1].toUpperCase(),
      zip: m[2] || '',
    };
  }
  // No "ST zip" tail — treat the last comma part as the city.
  return { street: parts.slice(0, parts.length - 1).join(', '), city: last, state: '', zip: '' };
}

function composeAddress(f: { street: string; city: string; state: string; zip: string }): string {
  const stateZip = [f.state.trim(), f.zip.trim()].filter(Boolean).join(' ');
  return [f.street.trim(), f.city.trim(), stateZip].filter(Boolean).join(', ');
}

export default function ReceiptSettingsSection() {
  const [accountAddress, setAccountAddress] = useState('');
  const [acctParts, setAcctParts] = useState<{ city: string; state: string; zip: string }>({ city: '', state: '', zip: '' });
  const [usingDefault, setUsingDefault] = useState(true); // receipt_address === null
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [stateVal, setStateVal] = useState('');
  const [zip, setZip] = useState('');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [colorIsDefault, setColorIsDefault] = useState(true);
  const [accountPhone, setAccountPhone] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneDefault, setPhoneDefault] = useState(true); // receipt_phone === null
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [nonce, setNonce] = useState(() => Date.now());

  // Address autocomplete state.
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSug, setShowSug] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshSample = useCallback(() => setNonce(Date.now()), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/dj/receipt-settings');
        const j = (await r.json().catch(() => ({}))) as { receiptAddress?: string | null; accountAddress?: string; accountCity?: string; accountState?: string; accountZip?: string; receiptColor?: string | null; receiptPhone?: string | null; accountPhone?: string };
        if (!alive) return;
        setAccountAddress(j.accountAddress || '');
        setAcctParts({ city: j.accountCity || '', state: j.accountState || '', zip: j.accountZip || '' });
        if (j.receiptAddress == null) {
          // Default (no custom receipt address): prefill from the account. City /
          // state / ZIP come from the reliable account columns (ZIP is required
          // at signup), so the ZIP field is never blank even if the stored
          // address line didn't include it. Street parsed from the line.
          const f = parseAddress(j.accountAddress || '');
          setStreet(f.street);
          setCity(j.accountCity || f.city);
          setStateVal(j.accountState || f.state);
          setZip(j.accountZip || f.zip);
        } else {
          const f = parseAddress(j.receiptAddress);
          setStreet(f.street); setCity(f.city); setStateVal(f.state); setZip(f.zip);
        }
        setUsingDefault(j.receiptAddress == null);
        if (j.receiptColor && /^#[0-9a-fA-F]{6}$/.test(j.receiptColor)) { setColor(j.receiptColor); setColorIsDefault(false); }
        else { setColor(DEFAULT_COLOR); setColorIsDefault(true); }
        setAccountPhone(j.accountPhone || '');
        setPhone(j.receiptPhone == null ? (j.accountPhone || '') : j.receiptPhone);
        setPhoneDefault(j.receiptPhone == null);
      } catch { /* optional */ }
      finally { if (alive) setLoaded(true); }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

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

  async function post(body: Record<string, string | null>, note: string) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/dj/receipt-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('save failed');
      setMsg(note); refreshSample();
    } catch { setMsg('Could not save — try again.'); }
    finally { setBusy(false); }
  }

  async function saveAddress() {
    const composed = composeAddress({ street, city, state: stateVal, zip });
    await post({ address: composed }, '✓ Receipt address saved.');
    setUsingDefault(false);
  }
  async function removeAddress() {
    setStreet(''); setCity(''); setStateVal(''); setZip('');
    await post({ address: '' }, '✓ Address removed from receipts.');
    setUsingDefault(false);
  }
  async function useAccountAddress() {
    const f = parseAddress(accountAddress);
    setStreet(f.street);
    setCity(acctParts.city || f.city);
    setStateVal(acctParts.state || f.state);
    setZip(acctParts.zip || f.zip);
    await post({ address: null }, '✓ Back to your account address.');
    setUsingDefault(true);
  }
  async function savePhone() { await post({ phone }, '✓ Receipt phone saved.'); setPhoneDefault(false); }
  async function removePhone() { setPhone(''); await post({ phone: '' }, '✓ Phone removed from receipts.'); setPhoneDefault(false); }
  async function useAccountPhone() { setPhone(accountPhone); await post({ phone: null }, '✓ Back to your account phone.'); setPhoneDefault(true); }
  async function saveColor() { await post({ color }, '✓ Receipt colour saved.'); setColorIsDefault(false); }
  async function resetColor() { setColor(DEFAULT_COLOR); await post({ color: '' }, '✓ Colour reset to default.'); setColorIsDefault(true); }

  const label: CSSProperties = { display: 'block', fontSize: '.95rem', fontWeight: 600, color: '#ececf3', margin: '0 0 .35rem' };
  const hint: CSSProperties = { fontSize: '.82rem', color: 'rgba(235,235,245,.55)', lineHeight: 1.5, margin: '0 0 .7rem' };
  const input: CSSProperties = {
    width: '100%', boxSizing: 'border-box', fontSize: '.9rem', color: '#fff', background: 'rgba(255,255,255,.04)',
    border: '1px solid rgba(255,255,255,.14)', borderRadius: 10, padding: '.55rem .75rem',
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
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '1.6rem', alignItems: 'start' }} className="gdcReceiptGrid">
      <style>{`@media (max-width: 760px){ .gdcReceiptGrid{ grid-template-columns: 1fr !important; } }`}</style>

      {/* ── Left: editable settings ── */}
      <div>
        <h2 style={{ fontSize: '1.05rem', color: '#fff', margin: '0 0 .3rem' }}>Receipts &amp; Invoices</h2>
        <p style={{ ...hint, margin: '0 0 1.2rem' }}>
          Your logo, business address and brand colour appear on every invoice and
          receipt your clients receive. Set them here and watch the sample update.
        </p>

        {/* Logo */}
        <BusinessLogoSection label="Add/Edit Logo" description={null} />
        <div style={{ margin: '.2rem 0 1.4rem' }}>
          <button type="button" style={linkBtn} disabled={busy} onClick={refreshSample}>
            Refresh sample after changing the logo
          </button>
        </div>

        {/* Address — discrete fields with autocomplete. */}
        <label style={label}>Business address on receipts</label>
        <p style={hint}>
          {usingDefault
            ? 'Currently using your account address. Edit the fields below to use a different one on receipts, or remove it.'
            : (composeAddress({ street, city, state: stateVal, zip }) ? 'Using a custom receipt address.' : '')}
        </p>

        <div style={{ position: 'relative' }}>
          <span style={fieldLabel}>Street address</span>
          <input
            type="text" value={street} disabled={!loaded || busy} autoComplete="off"
            placeholder="123 Main St"
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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr .6fr .7fr', gap: '.6rem', marginTop: '.7rem' }}>
          <div><span style={fieldLabel}>City</span><input type="text" value={city} disabled={!loaded || busy} onChange={(e) => setCity(e.target.value)} placeholder="Springfield" style={input} /></div>
          <div><span style={fieldLabel}>State</span><input type="text" value={stateVal} disabled={!loaded || busy} onChange={(e) => setStateVal(e.target.value)} placeholder="IL" style={input} /></div>
          <div><span style={fieldLabel}>ZIP</span><input type="text" value={zip} disabled={!loaded || busy} onChange={(e) => setZip(e.target.value)} placeholder="62701" style={input} /></div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.6rem', alignItems: 'center', marginTop: '.8rem' }}>
          <button type="button" style={btn('#00e0a4', '#06231b')} disabled={!loaded || busy} onClick={saveAddress}>Save address</button>
          <button type="button" style={btn('rgba(255,95,95,.14)', '#ff8a8a')} disabled={!loaded || busy} onClick={removeAddress}>Remove address</button>
          {!usingDefault && <button type="button" style={linkBtn} disabled={busy} onClick={useAccountAddress}>Use my account address</button>}
        </div>

        {/* Phone — receipt-only, independent of the account phone. */}
        <label style={{ ...label, margin: '1.6rem 0 .35rem' }}>Phone on receipts</label>
        <p style={hint}>
          {phoneDefault
            ? 'Currently using your account phone. Enter a different one for receipts, or remove it.'
            : (phone.trim() ? 'Using a custom receipt phone.' : 'No phone is shown on your receipts.')}
        </p>
        <input type="tel" value={phone} disabled={!loaded || busy} onChange={(e) => setPhone(e.target.value)}
          placeholder="(555) 123-4567" style={{ ...input, maxWidth: 260 }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.6rem', alignItems: 'center', marginTop: '.7rem' }}>
          <button type="button" style={btn('#00e0a4', '#06231b')} disabled={!loaded || busy} onClick={savePhone}>Save phone</button>
          <button type="button" style={btn('rgba(255,95,95,.14)', '#ff8a8a')} disabled={!loaded || busy} onClick={removePhone}>Remove phone</button>
          {!phoneDefault && <button type="button" style={linkBtn} disabled={busy} onClick={useAccountPhone}>Use my account phone</button>}
        </div>
        {accountPhone && <p style={{ ...hint, margin: '.7rem 0 0' }}>Account phone: {accountPhone}</p>}

        {/* Colour */}
        <label style={{ ...label, margin: '1.6rem 0 .35rem' }}>Receipt colour</label>
        <p style={hint}>The accent colour for the title, totals box and payment tiles on your receipts.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.7rem', alignItems: 'center' }}>
          <input type="color" value={color} disabled={!loaded || busy} onChange={(e) => setColor(e.target.value)}
            style={{ width: 46, height: 34, border: '1px solid rgba(255,255,255,.14)', borderRadius: 8, background: 'transparent', cursor: 'pointer', padding: 2 }} />
          <input type="text" value={color} disabled={!loaded || busy}
            onChange={(e) => { const v = e.target.value; setColor(v.startsWith('#') ? v : '#' + v); }}
            style={{ ...input, width: 120, fontFamily: 'monospace' }} maxLength={7} />
          <button type="button" style={btn('#00e0a4', '#06231b')} disabled={!loaded || busy || !/^#[0-9a-fA-F]{6}$/.test(color)} onClick={saveColor}>Save colour</button>
          {!colorIsDefault && <button type="button" style={linkBtn} disabled={busy} onClick={resetColor}>Reset to default</button>}
        </div>

        {msg && <div style={{ marginTop: '.8rem', fontSize: '.82rem', color: '#8a8aa0' }}>{msg}</div>}
      </div>

      {/* ── Right: live sample ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.5rem' }}>
          <span style={{ fontSize: '.7rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#8a8aa0' }}>Sample receipt</span>
          <button type="button" style={linkBtn} disabled={busy} onClick={refreshSample}>Refresh</button>
        </div>
        <iframe
          key={nonce}
          src={`/api/dj/receipt-sample?ts=${nonce}`}
          title="Sample receipt"
          style={{ width: '100%', height: 560, border: '1px solid rgba(255,255,255,.14)', borderRadius: 10, background: '#fff' }}
        />
        <p style={{ ...hint, margin: '.5rem 0 0' }}>
          Sample with placeholder event details — only your logo, address and colour reflect your real settings.
        </p>
      </div>
    </div>
  );
}
