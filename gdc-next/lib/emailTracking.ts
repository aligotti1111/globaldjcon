// Email open tracking — shared helpers.
//
// Every client-facing send is tagged with the booking id and which stage it is,
// so the Resend "email.opened" webhook can stamp bookings.email_opens[stage].
// Resend tag values allow only [A-Za-z0-9_-] — a booking UUID and these fixed
// stage strings all qualify.

export type EmailStage = 'contract' | 'deposit' | 'balance' | 'planner' | 'guestlist' | 'rider';

export function emailTags(bookingId: string, stage: EmailStage): { name: string; value: string }[] {
  return [
    { name: 'booking_id', value: bookingId },
    { name: 'stage', value: stage },
  ];
}

// Pull our tags back out of a Resend webhook payload. Resend sends tags either
// as an array of {name,value} or (older shape) an object map — handle both.
export function readEmailTags(tags: unknown): { bookingId: string | null; stage: string | null } {
  let bookingId: string | null = null;
  let stage: string | null = null;
  if (Array.isArray(tags)) {
    for (const t of tags) {
      const name = (t as { name?: string })?.name;
      const value = (t as { value?: string })?.value;
      if (name === 'booking_id' && typeof value === 'string') bookingId = value;
      if (name === 'stage' && typeof value === 'string') stage = value;
    }
  } else if (tags && typeof tags === 'object') {
    const o = tags as Record<string, unknown>;
    if (typeof o.booking_id === 'string') bookingId = o.booking_id;
    if (typeof o.stage === 'string') stage = o.stage;
  }
  return { bookingId, stage };
}
