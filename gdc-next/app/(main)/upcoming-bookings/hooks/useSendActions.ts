'use client';

// useSendActions — the planner-send and rider-send cluster lifted out of
// BookingRow (refactor phase 1). Owns the send/chooser modal open state, the
// DJ's saved named riders + whether a rider was already sent, and the three
// fire-and-forget actions (send planner, resend rider, quick-send a named
// rider). Behaviour is identical; it just lives here now.

import { useEffect, useState } from 'react';
import { normalizeRiderMode, type NamedRider } from '@/lib/rider';
import type { UpcomingBooking, BookingPlannerSummary } from '../page';

interface Args {
  booking: UpcomingBooking;
  riderEnabled: boolean;
  archive: boolean;
  planner: BookingPlannerSummary | undefined;
  onPlannerChange: (bookingId: string, row: BookingPlannerSummary) => void;
}

export function useSendActions({ booking, riderEnabled, archive, planner, onPlannerChange }: Args) {
  const [plannerBusy, setPlannerBusy] = useState(false);
  const [plannerErr, setPlannerErr] = useState<string | null>(null);
  // Request opens the modal; the modal does the sending. Resend still fires
  // directly — there's nothing to confirm about "send that same link again".
  const [sendOpen, setSendOpen] = useState(false);
  const [riderChooserOpen, setRiderChooserOpen] = useState(false);
  // The DJ's saved NAMED riders → one quick-send action each in the Rider slot.
  const [savedRiders, setSavedRiders] = useState<NamedRider[]>([]);
  const [riderSent, setRiderSent] = useState(false); // Resend only appears once a rider was sent

  useEffect(() => {
    if (booking.booking_type !== 'club' || !riderEnabled || archive) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/rider/library');
        const d = (await r.json().catch(() => ({}))) as { ok?: boolean; riders?: NamedRider[] };
        if (alive && d.ok && Array.isArray(d.riders)) setSavedRiders(d.riders);
        const rb = await fetch(`/api/rider/for-booking/${booking.id}`);
        const db = (await rb.json().catch(() => ({}))) as { ok?: boolean; status?: string };
        if (alive && db.ok && db.status === 'sent') setRiderSent(true);
      } catch { /* no saved riders — the Rider portal still opens */ }
    })();
    return () => { alive = false; };
  }, [booking.booking_type, booking.id, riderEnabled, archive]);

  async function resendRider() {
    try {
      const rb = await fetch(`/api/rider/for-booking/${booking.id}`);
      const db = (await rb.json().catch(() => ({}))) as { ok?: boolean; items?: unknown; mode?: unknown; pdfUrl?: string | null; name?: string | null };
      if (!rb.ok || !db.ok) return;
      const m = normalizeRiderMode(db.mode);
      const items = Array.isArray(db.items) ? db.items : [];
      const pdfUrl = db.pdfUrl || null;
      if ((m === 'upload' ? !!pdfUrl : items.length > 0) === false) return;
      await fetch('/api/rider/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId: booking.id, items, mode: m, pdfUrl, name: db.name || undefined }) });
    } catch { /* ignore */ }
  }

  async function sendNamedRider(r: NamedRider) {
    try {
      await fetch('/api/rider/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, items: r.items, mode: r.mode, pdfUrl: r.pdfUrl, name: r.name }),
      });
    } catch { /* best-effort quick send */ }
  }

  async function requestPlanner() {
    if (plannerBusy) return;
    setPlannerBusy(true);
    setPlannerErr(null);
    try {
      const res = await fetch('/api/planner/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPlannerErr(j?.error || 'Could not send the planner.');
        return;
      }
      onPlannerChange(booking.id, {
        id: j.id,
        status: (j.status as BookingPlannerSummary['status']) || 'sent',
        answered: planner?.answered ?? 0,
        total: planner?.total ?? 0,
      });
      if (j.warning) setPlannerErr(j.warning);
    } catch {
      setPlannerErr('Could not send the planner.');
    } finally {
      setPlannerBusy(false);
    }
  }

  return {
    plannerBusy, plannerErr, setPlannerErr,
    sendOpen, setSendOpen,
    riderChooserOpen, setRiderChooserOpen,
    savedRiders, riderSent,
    requestPlanner, resendRider, sendNamedRider,
  };
}
