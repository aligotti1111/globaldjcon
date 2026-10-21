'use client';

// UpcomingEventsClient — host/venue view of all their booked events,
// nearest first. Mirrors UpcomingBookingsClient (the DJ-side equivalent)
// but stripped down: no rate/package fields, no DJ-specific UI. Manual
// events are events the user added themselves (no DJ may be attached).
//
// Capabilities for any row the user authored (requester_id === userId):
//   - Edit details (manual only)
//   - Add/replace flyer (manual only, since flyer is for promo)
//   - Add/edit external link (any row owned by the user)
//   - Delete (manual only)

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { UpcomingEvent } from './page';
import styles from './upcomingEvents.module.css';
import EventManualForm from './EventManualForm';
import { slotToStage, groupByMonth, sortByDateTimeAsc } from './upcomingEvents.helpers';
import { EventRow } from './upcomingEvents.components';

interface Props {
  userId: string;
  userCountry: string;
  userName: string;
  initialEvents: UpcomingEvent[];
  /** Header + empty-state copy. Defaults suit the Upcoming Events page; the
      Past Events page passes its own. */
  title?: string;
  subtitle?: string;
  emptyText?: string;
  emptyHint?: string;
  /** Order events newest-first (past events) instead of soonest-first. */
  newestFirst?: boolean;
  /** Past-events view: no adding/replacing flyers or links (the event is over). */
  readOnly?: boolean;
}

export default function UpcomingEventsClient({
  userId, userCountry, userName, initialEvents,
  title = 'Upcoming Events',
  subtitle = 'All your confirmed events, nearest first.',
  emptyText = "You don't have any upcoming events yet.",
  emptyHint = 'Approved booking requests will appear here automatically.',
  newestFirst = false,
  readOnly = false,
}: Props) {
  const [events, setEvents] = useState<UpcomingEvent[]>(initialEvents);
  const [editing, setEditing] = useState<UpcomingEvent | null>(null);
  const searchParams = useSearchParams();
  // Deep-link from the notification bell: /upcoming-events?open=<bookingId>
  // expands and scrolls to that event so clicking a notification lands somewhere.
  const openId = searchParams.get('open');
  // Focused single-card view (?card=<id>) — the bell links here so a tap opens
  // just that one event, not the whole list.
  const focusId = searchParams?.get('card') || null;

  // "New activity" view — the host equivalent of the DJ's ?filter=activity.
  // sortMode 'activity' filters to events the DJ recently acted on (newest
  // first), fed by the same /api/host/new-activity feed the bell uses.
  const [sortMode, setSortMode] = useState<'date' | 'activity'>('date');
  // bookingId → most recent activity timestamp (ISO), for sorting + filtering.
  const [activityAt, setActivityAt] = useState<Record<string, string>>({});
  // bookingId → the PIPELINE STAGE of that most recent activity, so the card
  // can show a NEW tag next to the exact icon that changed.
  const [activityStage, setActivityStage] = useState<Record<string, string>>({});
  // "Seen" moment for the NEW tags — like the bell's badge, a stage is only
  // tagged NEW while its activity is newer than the last time the host opened
  // the activity view. Loaded once (the PRIOR view time); a fresh view stamps a
  // new time for next visit without clearing this session's tags.
  const SEEN_KEY = 'gdc_host_activity_seen';
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const wroteSeen = useRef(false);
  useEffect(() => {
    try { setSeenAt(localStorage.getItem(SEEN_KEY)); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (sortMode === 'activity' && !wroteSeen.current) {
      wroteSeen.current = true;
      try { localStorage.setItem(SEEN_KEY, new Date().toISOString()); } catch { /* ignore */ }
    }
  }, [sortMode]);
  const seenT = seenAt ? Date.parse(seenAt) : Number.NEGATIVE_INFINITY;
  // The stage to tag NEW for an event — only when its activity is newer than
  // the host last viewed the activity list.
  const newStageFor = (id: string): string | null =>
    activityStage[id] && Date.parse(activityAt[id] || '') > seenT ? activityStage[id] : null;

  // Switch to the activity view whenever ?filter=activity appears (fires on
  // every URL change, so the bell's "View more" works even when already on the
  // page), then strip the param so a later re-sort isn't overridden.
  useEffect(() => {
    if (searchParams?.get('filter') === 'activity') {
      setSortMode('activity');
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.delete('filter');
        window.history.replaceState(null, '', url.toString());
      }
    }
  }, [searchParams]);

  // Pull the activity feed once so we know which events have recent DJ activity
  // and when — the same data the bell shows, reused here to order the view.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/host/new-activity', { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        const map: Record<string, string> = {};
        const stage: Record<string, string> = {};
        for (const it of (Array.isArray(j.items) ? j.items : []) as { bookingId: string; at: string; slot: string }[]) {
          if (!map[it.bookingId] || Date.parse(it.at) > Date.parse(map[it.bookingId])) {
            map[it.bookingId] = it.at;
            const st = slotToStage(it.slot);
            if (st) stage[it.bookingId] = st; else delete stage[it.bookingId];
          }
        }
        if (!cancelled) { setActivityAt(map); setActivityStage(stage); }
      } catch { /* non-fatal — activity view just falls back to date order */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Events the DJ recently acted on, newest activity first (a filter, not just
  // a sort — an event with no activity doesn't belong in this view).
  const activityList = events
    .filter((e) => activityAt[e.id])
    .sort((a, b) => Date.parse(activityAt[b.id]) - Date.parse(activityAt[a.id]));

  // Group events by year-month for "Aug 2026" / "Sep 2026" section headers.
  const grouped = groupByMonth(events);

  async function handleUpdated(updated: UpcomingEvent) {
    setEvents((prev) => {
      const next = prev.map((e) => (e.id === updated.id ? updated : e));
      next.sort((a, b) => newestFirst ? sortByDateTimeAsc(b, a) : sortByDateTimeAsc(a, b));
      return next;
    });
    setEditing(null);
  }
  async function handleDeleted(id: string) {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }

  // One row — reused by the date (grouped) and activity (flat) views.
  const renderRow = (ev: UpcomingEvent) => (
    <EventRow
      key={ev.id}
      event={ev}
      userId={userId}
      readOnly={readOnly}
      autoOpen={(!!openId && ev.id === openId) || ev.id === focusId}
      newStage={newStageFor(ev.id)}
      onEdit={() => setEditing(ev)}
      onDeleted={() => handleDeleted(ev.id)}
      onLinkSaved={(url, label) => {
        setEvents((prev) => prev.map((e) => (
          e.id === ev.id ? { ...e, link_url: url, link_label: label } : e
        )));
      }}
      onFlyerSaved={(url) => {
        setEvents((prev) => prev.map((e) => (
          e.id === ev.id ? { ...e, flyer_url: url } : e
        )));
      }}
    />
  );

  const activityCount = activityList.length;
  const focusedEvent = focusId ? events.find((e) => e.id === focusId) || null : null;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>
      </div>

      {focusedEvent ? (
        /* Focused single-card view (from a notification) — just this event. */
        <>
          <div style={{ padding: '0 0 .6rem' }}>
            <Link href="/upcoming-events" style={{ color: 'var(--neon,#00e0a4)', fontSize: '.8rem', fontWeight: 700, textDecoration: 'none' }}>← All events</Link>
          </div>
          <div className={styles.eventList}>
            {renderRow(focusedEvent)}
          </div>
        </>
      ) : (
      <>
      {/* By date / New activity toggle — mirrors the DJ dashboard. Shown once
          there's any activity (or the activity view is already open). */}
      {(activityCount > 0 || sortMode === 'activity') && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          {([['date', 'By date'], ['activity', `New activity${activityCount ? ` (${activityCount})` : ''}`]] as const).map(([mode, text]) => {
            const on = sortMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setSortMode(mode)}
                style={{
                  position: 'relative',
                  background: on ? 'var(--neon,#00e0a4)' : 'transparent',
                  color: on ? '#06231b' : 'var(--muted,#8a8aa0)',
                  border: `1px solid ${on ? 'var(--neon,#00e0a4)' : 'rgba(255,255,255,.18)'}`,
                  borderRadius: 8, padding: '.4rem .9rem', fontSize: '.8rem', fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {text}
              </button>
            );
          })}
        </div>
      )}

      {events.length === 0 ? (
        <div className={styles.empty}>
          <p>{emptyText}</p>
          <p className={styles.emptyHint}>{emptyHint}</p>
        </div>
      ) : sortMode === 'activity' ? (
        activityCount === 0 ? (
          <div className={styles.empty}>
            <p>No new activity.</p>
            <p className={styles.emptyHint}>Updates from your DJ show up here.</p>
          </div>
        ) : (
          <section className={styles.monthGroup}>
            <h2 className={styles.monthHeading}>New activity</h2>
            <div className={styles.eventList}>
              {activityList.map(renderRow)}
            </div>
          </section>
        )
      ) : (
        grouped.map(({ key, label, items }) => (
          <section key={key} className={styles.monthGroup}>
            <h2 className={styles.monthHeading}>{label}</h2>
            <div className={styles.eventList}>
              {items.map(renderRow)}
            </div>
          </section>
        ))
      )}
      </>
      )}

      {editing && (
        <EventManualForm
          userId={userId}
          userCountry={userCountry}
          userName={userName}
          existing={editing}
          existingEvents={events}
          onClose={() => setEditing(null)}
          onAdded={() => { /* unused — Add Event flow removed */ }}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  );
}
