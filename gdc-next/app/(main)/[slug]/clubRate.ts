// Club-DJ rate calculation — shared between the visitor-side booking form
// (ClubBookingForm, for the live preview) and the server-side booking
// creation route (/api/bookings/create, where the STORED numbers are
// authoritatively recomputed). Extracted verbatim from ClubBookingForm.tsx
// so both sides can never drift apart. This module must stay a plain
// (non-'use client') module — the API route imports it on the server.

import { type BookingSettings, type DayData } from './bookingSettings';
import { currencySymbol } from '@/lib/constants';

// ─────────────────────────────────────────────────────────────────────────
// Rate calculation — figures out what to show in the rate area based on
// equipment selection, rate type (flat/hourly/offers), and per-day
// overrides if present.
// ─────────────────────────────────────────────────────────────────────────

export interface RateInfo {
  // Display rate (per booking for flat, per hour for hourly, base for offers)
  rate: number | null;
  // Rate type — drives what the visitor sees + what gets submitted
  rateType: 'flat' | 'hourly' | 'offers';
  // Currency symbol for display
  symbol: string;
  // Currency code for submit payload
  currency: string;
  // Hourly only — total when start + end are picked
  hourlyTotal: number | null;
  // Hourly only — number of hours computed
  hours: number | null;
  // Human label (e.g. "Rate with Sound System & Decks")
  label: string;
}

export function computeRate(
  bs: BookingSettings,
  dayData: DayData,
  equipment: string,
  startTime: string,
  endTime: string,
): RateInfo {
  const currency = bs.rate_currency || 'USD';
  const symbol = currencySymbol(currency);

  // Effective rate type — per-day rateType wins, else global
  // Note: DayData.rateType isn't in the type yet (deferred from day-editor
  // session) but vanilla writes it. Cast to access defensively.
  const dayRateType = (dayData as DayData & { rateType?: string }).rateType;
  const baseType: 'flat' | 'hourly' | 'offers' =
    (dayRateType as 'flat' | 'hourly' | 'offers') ||
    ((bs.global_rate_type as 'flat' | 'hourly' | 'offers') || 'flat');

  let label = '';
  let rate: number | null = null;

  // Equipment-specific label
  if (equipment === 'sound_system') {
    label = 'Rate with Sound System & Decks/Controller';
  } else if (equipment === 'decks_only') {
    label = 'Rate with Decks/Controller only';
  } else if (equipment === 'venue_provides') {
    label = 'Rate with venue providing all equipment';
  }

  // Pick the correct rate for this equipment AND rate type.
  // Day-level overrides win — when present, the day's rate fields take
  // priority over the DJ's universal rates. This lets the DJ promote a
  // special rate for a specific date (e.g. high-demand Saturday) without
  // changing their default rates.
  // Hourly mode reads the rate_hourly_* fields; flat mode reads the
  // rate_* (flat) fields. They're independent — a DJ who has flat values
  // set but switches to hourly without entering hourly values will show
  // no rate for hourly until they configure them.
  if (baseType !== 'offers') {
    let raw: number | string | null | undefined = null;
    const isHourly = baseType === 'hourly';
    // Day-level field name matching equipment + rateType
    const dayFlatKey = equipment === 'sound_system' ? 'rate_with_system'
      : equipment === 'decks_only' ? 'rate_with_decks'
      : equipment === 'venue_provides' ? 'rate_no_equip'
      : null;
    const dayHourlyKey = equipment === 'sound_system' ? 'rate_hourly_with_system'
      : equipment === 'decks_only' ? 'rate_hourly_with_decks'
      : equipment === 'venue_provides' ? 'rate_hourly_no_equip'
      : null;
    const dayKey = isHourly ? dayHourlyKey : dayFlatKey;
    const dayRaw = dayKey ? (dayData as DayData & Record<string, number | string | undefined>)[dayKey] : undefined;
    if (dayRaw != null && dayRaw !== '') {
      raw = dayRaw;
    } else {
      // Fall back to global rate
      if (equipment === 'sound_system') {
        raw = isHourly ? bs.rate_hourly_with_system : bs.rate_with_system;
      } else if (equipment === 'decks_only') {
        raw = isHourly ? bs.rate_hourly_with_decks : bs.rate_with_decks;
      } else if (equipment === 'venue_provides') {
        raw = isHourly ? bs.rate_hourly_no_equip : bs.rate_no_equip;
      }
    }

    if (raw != null && raw !== '') {
      const n = Number(raw);
      if (!isNaN(n) && n > 0) rate = n;
    }
  }

  // Hourly total
  let hourlyTotal: number | null = null;
  let hours: number | null = null;
  if (baseType === 'hourly' && rate != null && startTime && endTime) {
    const [sh, sm] = startTime.split(':').map(Number);
    let [eh, em] = endTime.split(':').map(Number);
    let totalMins = (eh * 60 + em) - (sh * 60 + sm);
    if (totalMins <= 0) totalMins += 24 * 60;
    hours = totalMins / 60;
    hourlyTotal = hours * rate;
  }

  return {
    rate,
    rateType: baseType,
    symbol,
    currency,
    hourlyTotal,
    hours,
    label,
  };
}
