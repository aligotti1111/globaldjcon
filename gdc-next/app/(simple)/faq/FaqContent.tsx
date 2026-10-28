'use client';

// Two FAQ sets on one page, toggled between Hosts and DJs. Each set is a list
// of accordion items (click a question to expand its answer). Answers are kept
// deliberately free of specific prices (those live on /subscribe) so this page
// never goes stale when plans change.

import { useState } from 'react';
import Link from 'next/link';
import styles from './faq.module.css';

type Audience = 'host' | 'dj';

interface QA {
  q: string;
  // Answer as a render function so we can embed links where useful.
  a: React.ReactNode;
}

const HOST_FAQ: QA[] = [
  {
    q: 'What is Global DJ Connect?',
    a: (
      <>
        It&rsquo;s a directory and booking platform that connects party hosts, venues, and event organizers with
        professional DJs. You find a DJ, send a booking request with your event details, and the DJ reviews and
        accepts it — all in one place, without the endless back-and-forth.
      </>
    ),
  },
  {
    q: 'How do I book a DJ?',
    a: (
      <>
        Browse the <Link href="/djs">DJ directory</Link>, open the profile of a DJ you like, and submit a booking
        request with your date, times, venue, and the kind of event you&rsquo;re throwing. The DJ gets your request,
        reviews the details, and accepts it. Your booking is confirmed once the DJ accepts.
      </>
    ),
  },
  {
    q: 'How long does the DJ have to respond, and how long do I have to approve?',
    a: (
      <>
        The DJ has up to <strong>5 days</strong> to respond to your request — or until your event date, whichever comes
        first. If they send back a quote or offer, you&rsquo;ll then have <strong>5 days</strong> to approve or decline
        it (again, or until the event date, whichever is sooner). If a request or offer isn&rsquo;t answered in time, it
        automatically declines and you&rsquo;re welcome to send a new request anytime.
      </>
    ),
  },
  {
    q: 'Does it cost anything for me as a host?',
    a: (
      <>
        No. There&rsquo;s no platform fee for hosts. You pay your DJ directly for their services — Global DJ Connect
        just keeps the booking, planning, and payment details organized for both of you.
      </>
    ),
  },
  {
    q: 'Do I need an account?',
    a: (
      <>
        You&rsquo;ll create a quick account (with your email or phone number) so you can track your booking, fill out
        your event planner, review a contract, and see your payment status in one spot.
      </>
    ),
  },
  {
    q: 'How do I pay my DJ?',
    a: (
      <>
        Your DJ sets how they accept payment — that can include Venmo, Cash App, Zelle, PayPal, or card, and many DJs
        also accept cash or check on the day of the event. Payments typically come in two parts: a deposit to
        lock in the date and the remaining balance before or at the event. You&rsquo;ll see exactly what&rsquo;s been paid
        and what&rsquo;s still due on your booking.
      </>
    ),
  },
  {
    q: 'What is a deposit, and when is the balance due?',
    a: (
      <>
        A deposit is an upfront portion of the total that secures your date. The remaining balance is due on the
        schedule your DJ sets — often before or on the day of the event. Your booking shows the deposit amount,
        the balance, and the status of each so there are no surprises.
      </>
    ),
  },
  {
    q: 'What is the event planner?',
    a: (
      <>
        For mobile DJ bookings (weddings, parties, and other private events), the planner is where you share the
        details that make your night yours — the timeline, must-play songs, do-not-play list, announcements, and
        special moments. Your DJ sends you a planner to fill out, and what you enter flows straight to them so
        everyone&rsquo;s working from the same plan.
      </>
    ),
  },
  {
    q: 'Is there a contract?',
    a: (
      <>
        Some DJs send a contract for you to review and sign electronically. If yours does, you&rsquo;ll get a link to
        read it and e-sign — no printing or scanning required.
      </>
    ),
  },
  {
    q: 'How do I know my booking is confirmed?',
    a: (
      <>
        Your booking is confirmed once the DJ accepts your request. You&rsquo;ll be notified by email (and by text, if
        you opt in), and your booking will show as confirmed in your account. If the DJ doesn&rsquo;t respond, the
        request automatically expires after 5 days — or sooner if your event date is coming up fast — and you&rsquo;re
        free to request another DJ. Your request card shows how many days are left before it expires.
      </>
    ),
  },
  {
    q: 'Can I change or cancel my booking?',
    a: (
      <>
        You can request a change or cancellation through your booking, but it&rsquo;s subject to your DJ agreeing —
        any change has to be approved by them, since the booking agreement is directly between the two of you.
        If a DJ makes a change on their end, it&rsquo;s sent to you so you&rsquo;re always in the loop. Cancellation and
        refund terms are whatever you and your DJ agreed to.
      </>
    ),
  },
  {
    q: 'What if my DJ cancels?',
    a: (
      <>
        Global DJ Connect is a facilitator, not a party to your booking, so your agreement is directly with the
        DJ. If your DJ cancels, any refund and your recourse are handled directly with them, under whatever you
        agreed to. We always recommend using a contract and keeping your communication on the platform. See our{' '}
        <Link href="/terms">Terms</Link> for details.
      </>
    ),
  },
];

const DJ_FAQ: QA[] = [
  {
    q: 'What do I get as a DJ on Global DJ Connect?',
    a: (
      <>
        A public profile in the directory plus a full back office: online booking requests, manual bookings for
        gigs you land offline, contracts with e-signature, deposit and balance collection, event planners and
        riders, a calendar, and a dashboard that keeps every event&rsquo;s details and payment history in one place.
      </>
    ),
  },
  {
    q: 'Where do I find the QR code for my profile?',
    a: (
      <>
        Go to <Link href="/update-dj-profile">Edit Profile</Link> and look in the <b>Account</b> section — your
        downloadable QR code sits right under your public profile link. It encodes your profile so anyone can scan
        it to open your page; print it on a business card, flyer, or booth sign, or save it to share online. The QR
        code is a paid feature — on a free account you&rsquo;ll see it locked with an option to upgrade.
      </>
    ),
  },
  {
    q: 'How much does it cost?',
    a: (
      <>
        You can start with a free account — get a profile and take bookings at no cost, no card required. From
        there, paid tiers unlock contracts, deposits, and the full planning suite as you grow. See the free plan
        and current pricing on the <Link href="/subscribe">subscribe page</Link>.
      </>
    ),
  },
  {
    q: 'Does Global DJ Connect take a cut of my bookings?',
    a: (
      <>
        No. We&rsquo;re a subscription tool, not a middleman. You stay the merchant of record on every booking and
        keep your full fee — what your clients pay for your services goes to you.
      </>
    ),
  },
  {
    q: 'How do payments work?',
    a: (
      <>
        You connect the payment methods you want to accept — Venmo, Cash App, Zelle, PayPal, and/or card — and set your
        deposit and tax terms. Clients pay you directly; you can mark cash or check payments as received, and
        receipts can be sent automatically. You&rsquo;re always the merchant of record.
      </>
    ),
  },
  {
    q: 'Can I add bookings I took offline?',
    a: (
      <>
        Yes. Add a manual booking for any gig you booked outside the platform, with all the same event, pricing,
        and payment details. You can optionally add the host&rsquo;s email so they get the booking details, their
        planner, and payment requests — and they&rsquo;re notified by email of any change you make.
      </>
    ),
  },
  {
    q: 'What are planners and riders?',
    a: (
      <>
        Which one you use depends on your account type. If you&rsquo;re a <b>Mobile DJ</b> account (weddings, parties,
        private events), you get planners — your clients give you the timeline, song requests, and special
        moments, and you can customize the questions per event type. If you&rsquo;re a <b>Club/Bar DJ</b> account, you
        get riders — you send your technical and hospitality requirements to the venue. Each can be sent out and
        viewed on its own page.
      </>
    ),
  },
  {
    q: 'Can I change my DJ account type after signing up?',
    a: (
      <>
        No. The account type you choose at signup — <b>Mobile DJ</b> or <b>Club/Bar DJ</b> — is locked once your
        account is created, because it shapes your whole setup: your booking form, packages and pricing, and
        whether you use planners or riders. Choose carefully when you sign up. If you picked the wrong type or
        your business changes, reach out at <a href="mailto:info@globaldjconnect.com">info@globaldjconnect.com</a>{' '}
        and we&rsquo;ll help.
      </>
    ),
  },
  {
    q: 'Can I send contracts and collect signatures?',
    a: (
      <>
        Yes. Build a contract from the booking details (or your own text), send it for electronic signature, and
        track its status right from the booking. You sign first, then your client signs — no paperwork.
      </>
    ),
  },
  {
    q: 'Can I add my team?',
    a: (
      <>
        Yes. You can bring on teammates with roles — for example a manager who can handle bookings and billing —
        so your crew can help run the business while you stay in control of the account.
      </>
    ),
  },
  {
    q: 'Can I sync my bookings to my calendar?',
    a: (
      <>
        Yes. You get a private calendar feed you can subscribe to in Google Calendar, Apple Calendar, or Outlook,
        and confirmed bookings include an &ldquo;Add to Calendar&rdquo; option so your schedule stays in sync.
      </>
    ),
  },
  {
    q: 'Will I and my clients get notifications?',
    a: (
      <>
        Yes — key moments like a new request, an accepted booking, a sent contract, and a received payment are
        sent by email, and clients can opt in to text notifications for their booking too.
      </>
    ),
  },
  {
    q: 'Can I upgrade or downgrade my plan later?',
    a: (
      <>
        Yes. Open the <Link href="/subscribe">subscribe page</Link> and use the <b>Manage Subscription</b> toolbar
        to switch plans anytime — move up to unlock more features, or down to a smaller plan (including back to the
        free tier). Upgrades take effect right away; a downgrade keeps your current features until the end of the
        billing period you&rsquo;ve already paid for. Your profile, bookings, and history stay intact when you change
        plans.
      </>
    ),
  },
  {
    q: 'How do I cancel my subscription?',
    a: (
      <>
        Open the <Link href="/subscribe">subscribe page</Link> and use the <b>Manage Subscription</b> toolbar at
        the top — from there you can update billing, change your plan, or cancel anytime. If you have any trouble,
        reach us at <a href="mailto:info@globaldjconnect.com">info@globaldjconnect.com</a>.
      </>
    ),
  },
];

function FaqList({ items }: { items: QA[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className={styles.list}>
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={i} className={`${styles.item} ${isOpen ? styles.itemOpen : ''}`}>
            <button
              type="button"
              className={styles.question}
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : i)}
            >
              <span dangerouslySetInnerHTML={{ __html: item.q }} />
              <span className={styles.chev} aria-hidden>{isOpen ? '−' : '+'}</span>
            </button>
            {isOpen && <div className={styles.answer}>{item.a}</div>}
          </div>
        );
      })}
    </div>
  );
}

export default function FaqContent() {
  const [audience, setAudience] = useState<Audience>('host');
  return (
    <div>
      <div className={styles.toggle} role="tablist" aria-label="Choose FAQ audience">
        <button
          type="button"
          role="tab"
          aria-selected={audience === 'host'}
          className={`${styles.toggleBtn} ${audience === 'host' ? styles.toggleActive : ''}`}
          onClick={() => setAudience('host')}
        >
          For Hosts
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={audience === 'dj'}
          className={`${styles.toggleBtn} ${audience === 'dj' ? styles.toggleActive : ''}`}
          onClick={() => setAudience('dj')}
        >
          For DJs
        </button>
      </div>

      <h2 className={styles.sectionHeading}>
        {audience === 'host' ? 'Booking a DJ (Hosts)' : 'Running your business (DJs)'}
      </h2>

      {audience === 'host' ? <FaqList items={HOST_FAQ} /> : <FaqList items={DJ_FAQ} />}

      <p className={styles.footLine}>
        Still have a question?{' '}
        <a href="mailto:info@globaldjconnect.com">info@globaldjconnect.com</a>
      </p>
    </div>
  );
}
