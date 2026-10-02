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

interface Props {
  paymentId: string; amount: number; currency: string; kind: string;
  alreadySettled: boolean; eventDate: string | null; venueName: string | null; atEvent?: boolean;
  method?: 'cash' | 'check' | null; djName?: string | null; cashPhone?: string | null;
  // Cash-specific rules for the interactive BALANCE-by-cash flow. Cash can never
  // be mailed, so the only hand-off ahead of the event is an in-person drop-off.
  cashNightOf?: boolean;
  cashDeadline?: string | null;
  cashLeadWeeks?: number | null;
  cashCanText?: boolean;
  // Which cash hand-offs the DJ enabled: exchange in person (meet, with phone)
  // and drop off at the office (with address). The host only sees the ones on.
  cashMeet?: boolean;
  cashOffice?: boolean;
  // Optional office drop-off location (cash + check), with open hours.
  dropoffAddressLines?: string[];
  dropoffHours?: string | null;
  // Check-specific rules + contact, used for the interactive BALANCE-by-check flow.
  checkNightOf?: boolean;
  checkDeadline?: string | null;
  checkLeadWeeks?: number | null;
  checkPhone?: string | null;
  checkPayTo?: string | null;
  checkAddressLines?: string[];
  checkMemoLine?: string;
  checkContactVerb?: string;
  // Which ways the DJ accepts a check (default both true).
  checkCanMail?: boolean;
  checkCanDropoff?: boolean;
}

const WRAP: React.CSSProperties = { minHeight: '100vh', background: '#0b0b0f', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif" };
const CARD: React.CSSProperties = { maxWidth: 440, width: '100%', background: '#15151c', border: '1px solid #26263200', borderRadius: 16, padding: 28, textAlign: 'center', boxShadow: '0 8px 40px rgba(0,0,0,.5)' };
const PRIMARY_BTN: React.CSSProperties = { width: '100%', background: '#00e0a4', color: '#06231b', border: 'none', borderRadius: 10, padding: '14px 20px', fontWeight: 700, fontSize: 15, cursor: 'pointer' };
const CHOICE_BTN: React.CSSProperties = { width: '100%', background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,.22)', borderRadius: 10, padding: '13px 18px', fontWeight: 600, fontSize: 14, cursor: 'pointer', marginTop: 10, textAlign: 'left', lineHeight: 1.4 };

function Brand() {
  return <div style={{ fontFamily: 'Impact,Arial,sans-serif', fontSize: 22, letterSpacing: '.06em', color: '#00f5c4', fontWeight: 700, marginBottom: 20 }}>GLOBAL DJ CONNECT</div>;
}

export default function CheckSent(props: Props) {
  const {
    paymentId, amount, currency, kind, alreadySettled, eventDate, venueName, atEvent = false, method = null,
    djName = null, cashPhone = null,
    cashNightOf = false, cashDeadline = null, cashLeadWeeks = null, cashCanText = false,
    cashMeet = false, cashOffice = false,
    dropoffAddressLines = [], dropoffHours = null,
    checkNightOf = false, checkDeadline = null, checkLeadWeeks = null,
    checkPhone = null, checkPayTo = null, checkAddressLines = [], checkMemoLine = '', checkContactVerb = 'call or text',
    checkCanMail = true, checkCanDropoff = true,
  } = props;

  const dj = djName?.trim() || 'your DJ';
  const isDeposit = kind === 'deposit';
  const amt = money(amount, currency);
  const when = dateSuffix(eventDate);
  const forVenue = venueName ? ` for ${venueName}` : '';
  const subject = isDeposit ? 'Deposit' : 'Balance';

  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>(alreadySettled ? 'done' : 'idle');
  // Check/cash flows: which arrangement the host picked. 'meet' = exchange in
  // person, 'office' = drop off at the DJ's office.
  const [choice, setChoice] = useState<'none' | 'nightof' | 'early' | 'dropoff' | 'mail' | 'meet' | 'office'>('none');
  const [doneMsg, setDoneMsg] = useState<React.ReactNode>(null);

  async function notify(mode: 'at-event' | 'sent', done: React.ReactNode, handoff?: 'dropoff' | 'mail' | 'meet' | 'office') {
    setState('sending');
    try {
      const res = await fetch('/api/pay/check-sent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId, mode, method: method || 'check', ...(handoff ? { handoff } : {}) }),
      });
      if (res.ok) { setDoneMsg(done); setState('done'); } else { setState('error'); }
    } catch { setState('error'); }
  }

  const Hero = () => (
    <>
      <h1 style={{ fontFamily: 'Impact,Arial,sans-serif', fontSize: 34, letterSpacing: '.04em', textTransform: 'uppercase', margin: '0 0 2px', lineHeight: 1.05 }}>{subject}</h1>
      <div style={{ fontSize: 26, fontWeight: 700, color: '#00f5c4', margin: '0 0 16px' }}>{amt}</div>
    </>
  );

  // Always-shown "make it payable to + memo" block (check flows).
  const PayableMemo = () => (
    <div style={{ textAlign: 'left', background: '#0f0f15', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: 14, margin: '0 0 16px' }}>
      {checkPayTo && (
        <>
          <div style={{ color: '#8a8a98', fontSize: 12 }}>Make the check payable to</div>
          <div style={{ color: '#fff', fontSize: 15, marginBottom: checkMemoLine ? 10 : 0 }}>{checkPayTo}</div>
        </>
      )}
      {checkMemoLine && (
        <>
          <div style={{ color: '#8a8a98', fontSize: 12 }}>Include this memo on the check</div>
          <div style={{ fontFamily: 'monospace', color: '#fff', fontSize: 13.5 }}>{checkMemoLine}</div>
        </>
      )}
    </div>
  );
  // Optional office where the host can bring cash / a check, with hours.
  const OfficeBlock = () => (
    dropoffAddressLines.length > 0 ? (
      <>
        <div style={{ color: '#8a8a98', fontSize: 12, marginTop: 12 }}>Drop-off location</div>
        {dropoffAddressLines.map((l, i) => <div key={i} style={{ color: '#fff', fontSize: 14, lineHeight: 1.45 }}>{l}</div>)}
        {dropoffHours && <div style={{ color: '#d5d5df', fontSize: 13, marginTop: 4 }}>{dropoffHours}</div>}
      </>
    ) : null
  );
  // Detail shown after the host picks how they'll get the check to the DJ.
  const DropoffDetail = () => (
    <div style={{ textAlign: 'left', background: '#0f0f15', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: 14, margin: '0 0 18px' }}>
      {checkPhone
        ? <p style={{ margin: 0, color: '#d5d5df', fontSize: 13.5, lineHeight: 1.5 }}>{checkContactVerb.charAt(0).toUpperCase() + checkContactVerb.slice(1)} <strong style={{ color: '#fff', whiteSpace: 'nowrap' }}>{checkPhone}</strong> to arrange dropping off your check to {dj}.</p>
        : <p style={{ margin: 0, color: '#d5d5df', fontSize: 13.5, lineHeight: 1.5 }}>Reach out to {dj} to arrange dropping off your check.</p>}
      <OfficeBlock />
    </div>
  );
  const MailDetail = () => (
    <div style={{ textAlign: 'left', background: '#0f0f15', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: 14, margin: '0 0 18px' }}>
      <div style={{ color: '#8a8a98', fontSize: 12 }}>Mail your check to</div>
      {checkPayTo && <div style={{ color: '#fff', fontSize: 14 }}>{checkPayTo}</div>}
      {checkAddressLines.length > 0
        ? checkAddressLines.map((l, i) => <div key={i} style={{ color: '#d5d5df', fontSize: 13.5 }}>{l}</div>)
        : <div style={{ color: '#d5d5df', fontSize: 13.5 }}>Ask {dj} for the mailing address.</div>}
    </div>
  );

  // ─────────────── BALANCE paid by CHECK — interactive ───────────────
  // Deposits can never be brought to the event (paid ahead), so night-of only
  // ever applies to the BALANCE, and only when the DJ allows it. When the DJ
  // requires the check ahead, show the deadline. Either way the host picks HOW
  // it reaches the DJ: drop off (call/text) or mail.
  const isBalanceCheck = !isDeposit && method === 'check';
  if (isBalanceCheck) {
    const mustPrior = checkNightOf === false;
    const bannerDeadline = checkDeadline || (checkLeadWeeks ? `${checkLeadWeeks} week${checkLeadWeeks === 1 ? '' : 's'} before the event` : 'the deadline');
    return (
      <div style={WRAP}>
        <div style={CARD}>
          <Brand />
          {state === 'done' ? (
            <>
              <div style={{ fontSize: 44, marginBottom: 10 }}>✓</div>
              <h1 style={{ fontSize: 20, margin: '0 0 10px' }}>Your DJ has been notified</h1>
              <p style={{ color: '#b7b7c6', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
                {doneMsg || <>We let {dj} know about your balance of <strong style={{ color: '#fff' }}>{amt}</strong> by check{forVenue}. They&apos;ll confirm it once received. Thanks!</>}
              </p>
            </>
          ) : (
            <>
              <Hero />
              <PayableMemo />
              {mustPrior && (
                <div style={{ background: 'rgba(245,180,74,.1)', border: '1px solid rgba(245,180,74,.4)', borderRadius: 10, padding: 12, margin: '0 0 16px', textAlign: 'left' }}>
                  <p style={{ margin: 0, color: '#f0b64a', fontSize: 13.5, lineHeight: 1.5, fontWeight: 600 }}>{dj} needs your check received by {bannerDeadline}, not the day of the event.</p>
                </div>
              )}
              {choice === 'none' ? (
                <>
                  <p style={{ color: '#b7b7c6', fontSize: 14, lineHeight: 1.6, margin: '0 0 8px' }}>How will you get your check to {dj}?</p>
                  {checkNightOf && (
                    <button type="button" style={CHOICE_BTN} onClick={() => setChoice('nightof')}>I&apos;ll bring it the day of the event{when}</button>
                  )}
                  {checkPhone && checkCanDropoff && (
                    <button type="button" style={CHOICE_BTN} onClick={() => setChoice('dropoff')}>I&apos;ll drop it off (arrange with {dj})</button>
                  )}
                  {checkCanMail && (
                    <button type="button" style={CHOICE_BTN} onClick={() => setChoice('mail')}>I&apos;ll mail it{mustPrior ? ` — arriving by ${bannerDeadline}` : ''}</button>
                  )}
                </>
              ) : choice === 'nightof' ? (
                <>
                  <p style={{ color: '#b7b7c6', fontSize: 14, lineHeight: 1.6, margin: '0 0 18px' }}>You&apos;ll bring your check for <strong style={{ color: '#fff' }}>{amt}</strong> the day of the event{when}. It&apos;s only marked received once {dj} confirms it.</p>
                  <button type="button" style={{ ...PRIMARY_BTN, opacity: state === 'sending' ? 0.7 : 1 }} disabled={state === 'sending'}
                    onClick={() => notify('at-event', <>We let {dj} know you&apos;ll pay your balance of <strong style={{ color: '#fff' }}>{amt}</strong> by check the day of the event{when}. Thanks!</>)}>
                    {state === 'sending' ? 'Confirming…' : 'Confirm — bringing it the day of'}
                  </button>
                  <BackLink onClick={() => setChoice('none')} />
                </>
              ) : choice === 'dropoff' ? (
                <>
                  <DropoffDetail />
                  <button type="button" style={{ ...PRIMARY_BTN, opacity: state === 'sending' ? 0.7 : 1 }} disabled={state === 'sending'}
                    onClick={() => notify('sent', <>We let {dj} know you&apos;ll drop off your balance check of <strong style={{ color: '#fff' }}>{amt}</strong>. They&apos;ll confirm it once received. Thanks!</>, 'dropoff')}>
                    {state === 'sending' ? 'Confirming…' : "Confirm — I'll drop it off"}
                  </button>
                  <BackLink onClick={() => setChoice('none')} />
                </>
              ) : (
                <>
                  <MailDetail />
                  <button type="button" style={{ ...PRIMARY_BTN, opacity: state === 'sending' ? 0.7 : 1 }} disabled={state === 'sending'}
                    onClick={() => notify('sent', <>We let {dj} know your balance check of <strong style={{ color: '#fff' }}>{amt}</strong> is in the mail{mustPrior ? ` — to arrive by ${bannerDeadline}` : ''}. They&apos;ll confirm it once it arrives. Thanks!</>, 'mail')}>
                    {state === 'sending' ? 'Confirming…' : "Confirm — it's in the mail"}
                  </button>
                  <BackLink onClick={() => setChoice('none')} />
                </>
              )}
              {state === 'error' && <p style={{ color: '#ff8a8a', fontSize: 13, margin: '12px 0 0' }}>Something went wrong — please try again.</p>}
            </>
          )}
        </div>
      </div>
    );
  }

  // ─────────────── DEPOSIT paid by CHECK — drop off or mail ───────────────
  const isDepositCheck = isDeposit && method === 'check';
  if (isDepositCheck) {
    return (
      <div style={WRAP}>
        <div style={CARD}>
          <Brand />
          {state === 'done' ? (
            <>
              <div style={{ fontSize: 44, marginBottom: 10 }}>✓</div>
              <h1 style={{ fontSize: 20, margin: '0 0 10px' }}>Your DJ has been notified</h1>
              <p style={{ color: '#b7b7c6', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
                {doneMsg || <>We let {dj} know your deposit check of <strong style={{ color: '#fff' }}>{amt}</strong> is on the way. They&apos;ll confirm it once received. Thanks!</>}
              </p>
            </>
          ) : (
            <>
              <Hero />
              <PayableMemo />
              {choice === 'none' ? (
                <>
                  <p style={{ color: '#b7b7c6', fontSize: 14, lineHeight: 1.6, margin: '0 0 8px' }}>Will you drop off your check or mail it?</p>
                  {checkCanDropoff && <button type="button" style={CHOICE_BTN} onClick={() => setChoice('dropoff')}>Drop it off in person</button>}
                  {checkCanMail && <button type="button" style={CHOICE_BTN} onClick={() => setChoice('mail')}>Mail it</button>}
                </>
              ) : choice === 'dropoff' ? (
                <>
                  <div style={{ textAlign: 'left', background: '#0f0f15', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: 14, margin: '0 0 18px' }}>
                    {checkPhone
                      ? <p style={{ margin: 0, color: '#d5d5df', fontSize: 13.5, lineHeight: 1.5 }}>{checkContactVerb.charAt(0).toUpperCase() + checkContactVerb.slice(1)} <strong style={{ color: '#fff', whiteSpace: 'nowrap' }}>{checkPhone}</strong> to arrange dropping off your check to {dj}.</p>
                      : <p style={{ margin: 0, color: '#d5d5df', fontSize: 13.5, lineHeight: 1.5 }}>Reach out to {dj} to arrange dropping off your check.</p>}
                  </div>
                  <button type="button" style={{ ...PRIMARY_BTN, opacity: state === 'sending' ? 0.7 : 1 }} disabled={state === 'sending'}
                    onClick={() => notify('sent', <>We let {dj} know you&apos;ll drop off your deposit check of <strong style={{ color: '#fff' }}>{amt}</strong>. They&apos;ll confirm it once received. Thanks!</>, 'dropoff')}>
                    {state === 'sending' ? 'Confirming…' : "Confirm — I'll drop it off"}
                  </button>
                  <BackLink onClick={() => setChoice('none')} />
                </>
              ) : (
                <>
                  <div style={{ textAlign: 'left', background: '#0f0f15', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: 14, margin: '0 0 18px' }}>
                    <div style={{ color: '#8a8a98', fontSize: 12 }}>Mail your check to</div>
                    {checkPayTo && <div style={{ color: '#fff', fontSize: 14 }}>{checkPayTo}</div>}
                    {checkAddressLines.length > 0
                      ? checkAddressLines.map((l, i) => <div key={i} style={{ color: '#d5d5df', fontSize: 13.5 }}>{l}</div>)
                      : <div style={{ color: '#d5d5df', fontSize: 13.5 }}>Ask {dj} for the mailing address.</div>}
                  </div>
                  <button type="button" style={{ ...PRIMARY_BTN, opacity: state === 'sending' ? 0.7 : 1 }} disabled={state === 'sending'}
                    onClick={() => notify('sent', <>We let {dj} know your deposit check of <strong style={{ color: '#fff' }}>{amt}</strong> is in the mail. They&apos;ll confirm it once it arrives. Thanks!</>, 'mail')}>
                    {state === 'sending' ? 'Confirming…' : "Confirm — it's in the mail"}
                  </button>
                  <BackLink onClick={() => setChoice('none')} />
                </>
              )}
              {state === 'error' && <p style={{ color: '#ff8a8a', fontSize: 13, margin: '12px 0 0' }}>Something went wrong — please try again.</p>}
            </>
          )}
        </div>
      </div>
    );
  }

  // ─────────────── CASH (deposit or balance) — radios + one Confirm ───────
  // The host sees ONLY the hand-off options the DJ enabled on the cash tile, as
  // radio buttons. Day-of only applies to the balance, and only when the DJ
  // allows it. Picking "day of" needs nothing arranged; picking in-person or
  // office shows the number/address and, on confirm, emails the host the details.
  const cashVerb = cashCanText ? 'call or text' : 'call';
  // Exchange-in-person detail: the number the host calls/texts to arrange it.
  const MeetDetail = () => (
    <div style={{ textAlign: 'left', background: '#0f0f15', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: 14 }}>
      {cashPhone
        ? <p style={{ margin: 0, color: '#d5d5df', fontSize: 13.5, lineHeight: 1.5 }}>{cashVerb.charAt(0).toUpperCase() + cashVerb.slice(1)} <strong style={{ color: '#fff', whiteSpace: 'nowrap' }}>{cashPhone}</strong> to arrange handing your cash to {dj} in person.</p>
        : <p style={{ margin: 0, color: '#d5d5df', fontSize: 13.5, lineHeight: 1.5 }}>Reach out to {dj} to arrange handing over your cash in person.</p>}
    </div>
  );
  // Drop-off-at-office detail: the office address + hours.
  const CashOfficeDetail = () => (
    <div style={{ textAlign: 'left', background: '#0f0f15', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: 14 }}>
      {dropoffAddressLines.length > 0 ? (
        <>
          <div style={{ color: '#8a8a98', fontSize: 12 }}>Drop your cash off at</div>
          {dropoffAddressLines.map((l, i) => <div key={i} style={{ color: '#fff', fontSize: 14, lineHeight: 1.45 }}>{l}</div>)}
          {dropoffHours && <div style={{ color: '#d5d5df', fontSize: 13, marginTop: 4 }}>{dropoffHours}</div>}
        </>
      ) : (
        <p style={{ margin: 0, color: '#d5d5df', fontSize: 13.5, lineHeight: 1.5 }}>Reach out to {dj} for the drop-off address.</p>
      )}
    </div>
  );

  // The cash options the DJ turned on, only.
  const cashMeetOn = cashMeet && !!cashPhone;
  const cashOfficeOn = cashOffice && dropoffAddressLines.length > 0;

  const isCash = method === 'cash';
  if (isCash) {
    const kindWord = isDeposit ? 'deposit' : 'balance';
    // Day-of cash is a balance-only option, shown only when the DJ allows it.
    const nightOfOn = !isDeposit && cashNightOf;
    // The cash must arrive ahead of time when there's no day-of option to fall
    // back on (always true for a deposit; for a balance, when day-of is off).
    const mustPrior = !nightOfOn;
    const bannerDeadline = cashDeadline || (cashLeadWeeks ? `${cashLeadWeeks} week${cashLeadWeeks === 1 ? '' : 's'} before the event` : 'before the event');

    // Labels match the wording of the options on the DJ's cash tab.
    type OptKey = 'nightof' | 'meet' | 'office';
    const opts: { key: OptKey; label: string }[] = [];
    if (nightOfOn) opts.push({ key: 'nightof', label: 'Pay The Day Of The Event' });
    if (cashMeetOn) opts.push({ key: 'meet', label: 'Exchange In Person Prior To Event' });
    if (cashOfficeOn) opts.push({ key: 'office', label: 'Drop Off At Office' });

    const selected: OptKey | null = (choice === 'nightof' || choice === 'meet' || choice === 'office') ? choice : null;

    const confirm = () => {
      if (selected === 'nightof') {
        return notify('at-event', <>We let {dj} know you&apos;ll pay your {kindWord} of <strong style={{ color: '#fff' }}>{amt}</strong> in cash the day of the event{when}. Thanks!</>);
      }
      if (selected === 'meet') {
        return notify('sent', <>We let {dj} know you&apos;ll hand over your {kindWord} of <strong style={{ color: '#fff' }}>{amt}</strong> in cash in person{mustPrior ? ` — by ${bannerDeadline}` : ''}. They&apos;ll confirm it once received. We&apos;ve emailed you the details. Thanks!</>, 'meet');
      }
      if (selected === 'office') {
        return notify('sent', <>We let {dj} know you&apos;ll drop off your {kindWord} of <strong style={{ color: '#fff' }}>{amt}</strong> in cash at the office{mustPrior ? ` — by ${bannerDeadline}` : ''}. They&apos;ll confirm it once received. We&apos;ve emailed you the details. Thanks!</>, 'office');
      }
    };

    return (
      <div style={WRAP}>
        <div style={CARD}>
          <Brand />
          {state === 'done' ? (
            <>
              <div style={{ fontSize: 44, marginBottom: 10 }}>✓</div>
              <h1 style={{ fontSize: 20, margin: '0 0 10px' }}>Your DJ has been notified</h1>
              <p style={{ color: '#b7b7c6', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
                {doneMsg || <>We let {dj} know about your {kindWord} of <strong style={{ color: '#fff' }}>{amt}</strong> in cash{forVenue}. They&apos;ll confirm it once received. Thanks!</>}
              </p>
            </>
          ) : (
            <>
              <Hero />
              {/* Deadline note — only when the cash must arrive ahead AND there's a
                  hand-off option to meet it. Reads as a helpful heads-up. */}
              {mustPrior && (cashMeetOn || cashOfficeOn) && (
                <div style={{ background: 'rgba(245,180,74,.1)', border: '1px solid rgba(245,180,74,.4)', borderRadius: 10, padding: 12, margin: '0 0 16px', textAlign: 'left' }}>
                  <p style={{ margin: 0, color: '#f0b64a', fontSize: 13.5, lineHeight: 1.5, fontWeight: 600 }}>Please get your cash to {dj} by {bannerDeadline}, ahead of the event day.</p>
                </div>
              )}
              {opts.length === 0 ? (
                <p style={{ color: '#b7b7c6', fontSize: 13.5, lineHeight: 1.6, margin: '0 0 8px' }}>Reach out to {dj} to arrange handing over your cash.</p>
              ) : (
                <>
                  <p style={{ color: '#b7b7c6', fontSize: 14, lineHeight: 1.6, margin: '0 0 10px', textAlign: 'left' }}>How will you get the cash {kindWord} to {dj}?</p>
                  {opts.map((o) => (
                    <RadioRow key={o.key} label={o.label} checked={selected === o.key} onClick={() => setChoice(o.key)} />
                  ))}
                  {/* Detail for the picked option. Day-of needs nothing arranged. */}
                  {selected === 'meet' && <div style={{ marginTop: 14 }}><MeetDetail /></div>}
                  {selected === 'office' && <div style={{ marginTop: 14 }}><CashOfficeDetail /></div>}
                  {selected === 'nightof' && (
                    <p style={{ color: '#b7b7c6', fontSize: 13, lineHeight: 1.6, margin: '14px 0 0', textAlign: 'left' }}>Nothing to arrange ahead of time — just have it ready the day of. It&apos;s only marked received once {dj} confirms it.</p>
                  )}
                  <button type="button" disabled={!selected || state === 'sending'}
                    style={{ ...PRIMARY_BTN, marginTop: 18, opacity: (!selected || state === 'sending') ? 0.5 : 1, cursor: (!selected || state === 'sending') ? 'default' : 'pointer' }}
                    onClick={() => void confirm()}>
                    {state === 'sending' ? 'Confirming…' : 'Confirm'}
                  </button>
                </>
              )}
              {state === 'error' && <p style={{ color: '#ff8a8a', fontSize: 13, margin: '12px 0 0' }}>Something went wrong — please try again.</p>}
            </>
          )}
        </div>
      </div>
    );
  }

  // ─────────────── Generic (method-less) link — simple copy ───────────────
  // Cash and check are both fully handled by the interactive flows above, so
  // this only runs for a generic at-event link with no method specified.
  type Copy = { prompt: React.ReactNode; button: string; footnote: React.ReactNode | null; done: React.ReactNode };
  const bold = (s: string) => <strong style={{ color: '#fff' }}>{s}</strong>;
  const kindWord = isDeposit ? 'deposit' : 'balance';
  const copy: Copy = {
    prompt: isDeposit
      ? <>Let {dj} know you&apos;ll pay your deposit of {bold(amt)} before the event{when}, so they can arrange to collect it ahead of time.</>
      : <>Let {dj} know you&apos;ll pay your balance of {bold(amt)} in person at the event{when}, so they know to expect it on the day.</>,
    button: isDeposit ? "Let my DJ know I'll pay before the event" : "Let my DJ know I'll pay at the event",
    footnote: <>This just gives {dj} a heads-up. Your {kindWord} is only marked received once {dj} confirms it{isDeposit ? '' : ' at the event'}.</>,
    done: isDeposit
      ? <>We let {dj} know you&apos;ll pay your deposit of {bold(amt)} before the event{when}. They&apos;ll confirm it once received. Thanks!</>
      : <>We let {dj} know you&apos;ll pay {bold(amt)} at the event{when}. They&apos;ll collect it on the day. Thanks!</>,
  };

  return (
    <div style={WRAP}>
      <div style={CARD}>
        <Brand />
        {state === 'done' ? (
          <>
            <div style={{ fontSize: 44, marginBottom: 10 }}>✓</div>
            <h1 style={{ fontSize: 20, margin: '0 0 10px' }}>Your DJ has been notified</h1>
            <p style={{ color: '#b7b7c6', fontSize: 14, lineHeight: 1.6, margin: 0 }}>{copy.done}</p>
          </>
        ) : (
          <>
            <Hero />
            <p style={{ color: '#b7b7c6', fontSize: 14, lineHeight: 1.6, margin: '0 0 20px' }}>{copy.prompt}</p>
            <button
              type="button"
              onClick={() => notify(atEvent ? 'at-event' : 'sent', copy.done)}
              disabled={state === 'sending'}
              style={{ ...PRIMARY_BTN, opacity: state === 'sending' ? 0.7 : 1, cursor: state === 'sending' ? 'default' : 'pointer' }}
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

// A single radio option row — circle + label, the whole row is clickable.
function RadioRow({ label, checked, onClick }: { label: string; checked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 11, width: '100%',
        background: checked ? 'rgba(0,224,164,.08)' : 'transparent',
        border: `1px solid ${checked ? '#00e0a4' : 'rgba(255,255,255,.22)'}`,
        borderRadius: 10, padding: '13px 16px', cursor: 'pointer', marginTop: 10, textAlign: 'left',
      }}
    >
      <span style={{
        flex: '0 0 auto', width: 18, height: 18, borderRadius: '50%',
        border: `2px solid ${checked ? '#00e0a4' : 'rgba(255,255,255,.4)'}`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {checked && <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#00e0a4' }} />}
      </span>
      <span style={{ color: '#fff', fontSize: 14, fontWeight: 600, lineHeight: 1.35 }}>{label}</span>
    </button>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ background: 'transparent', border: 'none', color: '#8a8a98', fontSize: 12.5, cursor: 'pointer', marginTop: 14, textDecoration: 'underline' }}>
      ← choose a different option
    </button>
  );
}
