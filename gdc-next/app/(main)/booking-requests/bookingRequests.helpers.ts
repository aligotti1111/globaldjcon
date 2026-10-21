import type { BookingRow } from './page';
import type { BookingFilter } from './BookingRequestsClient';

// Re-snapshot tax/total/deposit to the price being accepted. The stored
// tax_amount / total_with_tax / deposit_amount were frozen at the ORIGINAL
// offer; a counter updated counter_rate but left those stale, so invoices
// billed the old total. Recompute from the accepted price (counter → quoted →
// offer) using the booking's frozen tax_pct / deposit_pct. Returns {} when
// there's no usable price so we never overwrite good data with zeros.
export function acceptedMoneyPatch(b: BookingRow | undefined): Record<string, number | null> {
  if (!b) return {};
  const bx = b as BookingRow & {
    counter_rate?: number | null;
    quoted_rate?: number | null;
    offer_amount?: number | null;
    tax_pct?: number | null;
    deposit_pct?: number | null;
  };
  const agreed = Number(bx.counter_rate ?? bx.quoted_rate ?? bx.offer_amount ?? 0);
  if (!Number.isFinite(agreed) || agreed <= 0) return {};
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const taxPct = Number(bx.tax_pct) || 0;
  const depPct = Number(bx.deposit_pct) || 0;
  const taxAmount = taxPct > 0 ? round2((agreed * taxPct) / 100) : 0;
  const totalWithTax = round2(agreed + taxAmount);
  return {
    tax_amount: taxPct > 0 ? taxAmount : null,
    total_with_tax: totalWithTax,
    deposit_amount: depPct > 0 ? round2((totalWithTax * depPct) / 100) : null,
  };
}

// Whose move is it on a booking? Reads negotiation_log (last entry's
// `from`) as the authority — that's set whenever either side counters or
// the DJ sends a mobile offer. Falls back to status when the log is
// empty (a fresh request that's never been countered).
//   Returns 'dj' if the DJ owes the next response, 'booker' if the
//   booker does, or null for terminal states (approved/denied/cancelled).
export function whoseMove(b: BookingRow): 'dj' | 'booker' | null {
  const status = b.status || 'pending';
  if (status === 'approved' || status === 'denied' || status === 'cancelled') {
    return null;
  }
  const log = b.negotiation_log;
  if (log && log.length > 0) {
    // Last actor made the most recent move → the OTHER side owes a reply.
    return log[log.length - 1].from === 'dj' ? 'booker' : 'dj';
  }
  // No negotiation history. A fresh 'pending' request is the booker's
  // submission awaiting the DJ; a bare 'counter' (shouldn't normally
  // happen without a log) is treated as the DJ having made the move.
  return status === 'counter' ? 'booker' : 'dj';
}

// Resolve a booking's overtime rate: prefer the value snapshotted onto the
// booking row; otherwise look it up live from the DJ's package definition by
// package_category + package_index (falling back to the general package at
// the same index). Returns null when there's no overtime rate.
export function resolveBookingOvertime(
  b: BookingRow,
  mobPackages?: Record<string, Array<{ overtime?: number | string | null }>> | null,
): number | null {
  const stored = (b as BookingRow & { overtime_rate?: number | null }).overtime_rate;
  if (stored != null) return Number(stored);
  const pkgIdx = (b as BookingRow & { package_index?: number | null }).package_index;
  if (pkgIdx == null || !mobPackages) return null;
  const cat = (b as BookingRow & { package_category?: string | null }).package_category || '';
  const ot = mobPackages[cat]?.[pkgIdx]?.overtime ?? mobPackages['general']?.[pkgIdx]?.overtime ?? null;
  const n = ot != null ? Number(ot) : NaN;
  return n > 0 ? n : null;
}

// Empty-state copy per tab — reads naturally for each filter name.
export function emptyLabel(tab: BookingFilter): string {
  switch (tab) {
    case 'respond': return 'Nothing needs your response right now.';
    case 'awaiting': return 'Nothing is awaiting a response.';
    case 'approved': return 'No approved bookings.';
    case 'denied': return 'No declined bookings.';
    case 'all': return 'No bookings yet.';
    default: return 'No bookings.';
  }
}
