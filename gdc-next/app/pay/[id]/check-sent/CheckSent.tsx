'use client';

import { useState } from 'react';

function money(n: number, currency = 'USD'): string {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }
  catch { return `$${n.toFixed(2)}`; }
}

// " on May 31, 2028" (or '' when we have no usable date). Kept as a suffix so
// each message can drop it in mid-sentence.
function dateSuffix(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  if (isNaN(d.getTime())) return '';
  return ` on ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
}

export default function CheckSent({
  paymentId, amount, currency, kind, alreadySettled, eventDate, venueName, atEvent = false, method = null, djName = null, cashPhone = null,
}: {
  paymentId: string; amount: number; currency: string; kind: string;
  alreadySettled: boolean; eventDate: string | null; venueName: string | null; atEvent?: boolean;
  method?: 'cash' | 'check' | null; djName?: string | null; cashPhone?: string | null;
}) {
  const dj = djName?.trim() || 'your DJ';
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>(alreadySettled ? 'done' : 'idle');
  const isDeposit = kind === 'deposit';
  const amt = money(amount, currency);
  const when = dateSuffix(eventDate);
  const forVenue = venueName ? ` for ${venueName}` : '';

  async function notify() {
    setState('sending');
    try {
      const res = await fetch('/api/pay/check-sent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId, mode: atEvent ? 'at-event' : 'sent', method }),
      });
      setState(res.ok ? 'done' : 'error');
    } catch { setState('error'); }
  }

  // Four fully independent messages — deposit/balance × cash/check — plus a
  // generic fallback if the link never told us which method. A deposit is paid
  // AHEAD of the event; a balance is paid ON the day.
  type Copy = { heading: string; prompt: React.ReactNode; button: string; footnote: React.ReactNode | null; done: React.ReactNode };
  const bold = (s: string) => <strong style={{ color: '#fff' }}>{s}</strong>;
  const phoneEl = cashPhone ? <strong style={{ color: '#fff', whiteSpace: 'nowrap' }}>{cashPhone}</strong> : null;

  let copy: Copy;
  if (isDeposit && method === 'cash') {
    copy = {
      heading: 'Paying your deposit in cash?',
      prompt: <>Let {dj} know you&apos;ll pay your deposit of {bold(amt)} in cash before the event{when}, so they can arrange to collect it ahead of time.</>,
      button: 'Confirm cash deposit',
      footnote: <>This just gives {dj} a heads-up you&apos;ll pay your deposit in cash. It&apos;s only marked received once {dj} confirms it.{phoneEl ? <> Please arrange a drop-off time — call or text {phoneEl}.</> : <> Please arrange a drop-off time with them.</>}</>,
      done: <>We let {dj} know you&apos;ll pay your deposit of {bold(amt)} in cash before the event{when}. They&apos;ll confirm it once received. Thanks!</>,
    };
  } else if (isDeposit && method === 'check') {
    copy = {
      heading: 'Paying your deposit by check?',
      prompt: <>Let {dj} know your deposit check of {bold(amt)} is on the way, so they can watch for it before the event{when}.</>,
      button: 'Confirm check deposit',
      footnote: <>This just gives {dj} a heads-up you&apos;ll pay your deposit by check. It&apos;s only marked received once {dj} confirms the check has arrived.</>,
      done: <>We let {dj} know your deposit check of {bold(amt)} is on the way{forVenue}. They&apos;ll confirm it once it arrives. Thanks!</>,
    };
  } else if (!isDeposit && method === 'cash') {
    copy = {
      heading: 'Paying your balance in cash?',
      prompt: <>This just gives {dj} a heads-up you&apos;ll be paying in cash. Your payment is only marked received once {dj} confirms it. Balance can be paid day of event{phoneEl ? <> or arrange a drop-off time — call or text {phoneEl}.</> : ' or arrange a drop-off time with them.'}</>,
      button: 'Confirm Cash As Payment Of Choice',
      footnote: null,
      done: <>We let {dj} know you&apos;ll pay your balance of {bold(amt)} in cash at the event{when}. They&apos;ll collect it on the day. Thanks!</>,
    };
  } else if (!isDeposit && method === 'check') {
    copy = {
      heading: 'Paying your balance by check?',
      prompt: <>Let {dj} know you&apos;ll pay your balance of {bold(amt)} by check, so they know to expect it{when ? <> for the event{when}</> : null}.</>,
      button: 'Confirm check balance',
      footnote: <>This just gives {dj} a heads-up you&apos;ll pay your balance by check. It&apos;s only marked received once {dj} confirms it.</>,
      done: <>We let {dj} know you&apos;ll pay your balance of {bold(amt)} by check{forVenue}. They&apos;ll confirm it once received. Thanks!</>,
    };
  } else {
    // Generic fallback — the link didn't specify a method.
    const kindWord = isDeposit ? 'deposit' : 'balance';
    copy = {
      heading: isDeposit ? 'Arranging your deposit?' : 'Paying at the event?',
      prompt: isDeposit
        ? <>Let {dj} know you&apos;ll pay your deposit of {bold(amt)} before the event{when}, so they can arrange to collect it ahead of time.</>
        : <>Let {dj} know you&apos;ll pay your balance of {bold(amt)} in person at the event{when}, so they know to expect it on the day.</>,
      button: isDeposit ? "Let my DJ know I'll pay before the event" : "Let my DJ know I'll pay at the event",
      footnote: <>This just gives {dj} a heads-up. Your {kindWord} is only marked received once {dj} confirms it{isDeposit ? '' : ' at the event'}.</>,
      done: isDeposit
        ? <>We let {dj} know you&apos;ll pay your deposit of {bold(amt)} before the event{when}. They&apos;ll confirm it once received. Thanks!</>
        : <>We let {dj} know you&apos;ll pay {bold(amt)} at the event{when}. They&apos;ll collect it on the day. Thanks!</>,
    };
  }

  const wrap: React.CSSProperties = { minHeight: '100vh', background: '#0b0b0f', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif" };
  const card: React.CSSProperties = { maxWidth: 440, width: '100%', background: '#15151c', border: '1px solid #26263200', borderRadius: 16, padding: 28, textAlign: 'center', boxShadow: '0 8px 40px rgba(0,0,0,.5)' };

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ fontFamily: 'Impact,Arial,sans-serif', fontSize: 22, letterSpacing: '.06em', color: '#00f5c4', fontWeight: 700, marginBottom: 20 }}>GLOBAL DJ CONNECT</div>

        {state === 'done' ? (
          <>
            <div style={{ fontSize: 44, marginBottom: 10 }}>✓</div>
            <h1 style={{ fontSize: 20, margin: '0 0 10px' }}>Your DJ has been notified</h1>
            <p style={{ color: '#b7b7c6', fontSize: 14, lineHeight: 1.6, margin: 0 }}>{copy.done}</p>
          </>
        ) : (
          <>
            {/* Hero: the subject (Deposit / Balance) with the amount under it. */}
            <h1 style={{ fontFamily: 'Impact,Arial,sans-serif', fontSize: 34, letterSpacing: '.04em', textTransform: 'uppercase', margin: '0 0 2px', lineHeight: 1.05 }}>{isDeposit ? 'Deposit' : 'Balance'}</h1>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#00f5c4', margin: '0 0 16px' }}>{amt}</div>
            <p style={{ color: '#b7b7c6', fontSize: 14, lineHeight: 1.6, margin: '0 0 20px' }}>{copy.prompt}</p>
            <button
              type="button"
              onClick={notify}
              disabled={state === 'sending'}
              style={{ width: '100%', background: '#00e0a4', color: '#06231b', border: 'none', borderRadius: 10, padding: '14px 20px', fontWeight: 700, fontSize: 15, cursor: state === 'sending' ? 'default' : 'pointer', opacity: state === 'sending' ? 0.7 : 1 }}
            >
              {state === 'sending' ? 'Confirming…' : copy.button}
            </button>
            {state === 'error' && (
              <p style={{ color: '#ff8a8a', fontSize: 13, margin: '12px 0 0' }}>Something went wrong — please try again.</p>
            )}
            {copy.footnote && (
              <p style={{ color: '#b7b7c6', fontSize: 13, lineHeight: 1.65, margin: '18px 0 0' }}>{copy.footnote}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
