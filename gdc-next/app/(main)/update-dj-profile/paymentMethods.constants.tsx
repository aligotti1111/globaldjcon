import {
  CardNetworksMark, VenmoMark, CashAppMark, PaypalMark, ZelleMark, CashMark, CheckMark,
} from './BrandMarks';
import {
  TYPE_ORDER,
  type PaymentMethodType,
} from '@/lib/paymentMethods';

export function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `m${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
}

/** Card is a tile like the rest, but it isn't a payment_methods row. */
export type TileKey = 'card' | PaymentMethodType;

/**
 * What /api/stripe/connect?action=status reports back.
 *
 * `actionNeeded` is the important one: charges_enabled:false means cards are
 * off, but it does NOT mean the DJ did something wrong. Stripe may simply be
 * verifying. Conflating those two produced a "Finish setup" button that
 * looped forever on an account with nothing left to finish.
 */
export interface CardState {
  connected: boolean;
  ready: boolean;
  detailsSubmitted: boolean;
  actionNeeded: boolean;
  currentlyDue: string[];
  pastDue: string[];
  pendingVerification: string[];
  disabledReason: string | null;
  payoutsEnabled: boolean;
}

export const DISCONNECTED: CardState = {
  connected: false, ready: false, detailsSubmitted: false, actionNeeded: false,
  currentlyDue: [], pastDue: [], pendingVerification: [], disabledReason: null,
  payoutsEnabled: false,
};

/**
 * Stripe names requirements for engineers: "individual.verification.document".
 * A DJ reading that has no idea they need to photograph a driving licence.
 */
export function prettyRequirement(field: string): string {
  const MAP: Record<string, string> = {
    'external_account': 'Bank account for payouts',
    'individual.verification.document': 'Photo ID',
    'individual.verification.additional_document': 'A second proof of identity',
    'individual.id_number': 'Social Security number',
    'individual.ssn_last_4': 'Last 4 of your SSN',
    'individual.dob.day': 'Date of birth',
    'individual.dob.month': 'Date of birth',
    'individual.dob.year': 'Date of birth',
    'individual.address.line1': 'Home address',
    'individual.address.city': 'Home address',
    'individual.address.postal_code': 'Home address',
    'individual.address.state': 'Home address',
    'individual.first_name': 'Your first name',
    'individual.last_name': 'Your last name',
    'individual.email': 'Email address',
    'individual.phone': 'Phone number',
    'business_profile.url': 'Your website (your Global DJ Connect profile URL works)',
    'business_profile.mcc': 'What kind of business you run',
    'business_profile.product_description': 'A description of what you sell',
    'tos_acceptance.date': 'Accept Stripe’s terms',
    'tos_acceptance.ip': 'Accept Stripe’s terms',
    'settings.dashboard.display_name': 'A public business name',
  };
  if (MAP[field]) return MAP[field];
  const tail = field.split('.').pop() || field;
  const words = tail.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Tile faces — the real marks, in each brand's own colour.
 *
 * A DJ scanning this grid recognises the Venmo blue before they've read a word;
 * that's the entire job of the tile. Emoji stand-ins made them all read as
 * generic coloured dots, which is the opposite.
 */
export const TILE_MARK: Partial<Record<TileKey, (p: { size?: number }) => React.ReactElement>> = {
  card: CardNetworksMark,
  venmo: VenmoMark,
  cashapp: CashAppMark,
  paypal: PaypalMark,
  zelle: ZelleMark,
  cash: CashMark,
  check: CheckMark,
};

/**
 * The tiles, in order. 'other' is deliberately NOT here: a free-text "describe
 * how to pay me" box is the one rail we can't validate, can't link, can't QR
 * and can't explain to a client — every other tile earns its place by doing at
 * least one of those. Existing 'other' rows are still saved and still shown to
 * clients; they just can't be created any more.
 */
export const TILE_ORDER: TileKey[] = ['card', ...TYPE_ORDER.filter((t) => t !== 'other')];

export const TILE_LABEL: Record<TileKey, string> = {
  card: 'Credit Cards',
  venmo: 'Venmo',
  cashapp: 'Cash App',
  paypal: 'PayPal',
  zelle: 'Zelle',
  cash: 'Cash',
  check: 'Check',
  other: 'Other',
};

/**
 * Only Card gets a subtitle, because only Card needs one: four network logos
 * don't say where the money goes, and "via Stripe Connect" is the answer to
 * the question they raise.
 *
 * The rest had blurbs describing their quirks — "Phone only", "Copy by hand".
 * True, but that's a caveat, and a grid of caveats reads as a list of reasons
 * not to bother. The quirks belong in the expanded panel, where the DJ has
 * actually chosen the rail and the hint can be a full sentence instead of two
 * words. A logo and a name is all a tile owes anyone.
 */
export const TILE_BLURB: Partial<Record<TileKey, string>> = {
  card: 'via Stripe Connect',
};

/**
 * Per-tile mark size. Not one number: these are different KINDS of mark.
 * Venmo's is a wordmark — five letters squeezed into the same 24px box that
 * holds Cash App's single $ glyph, so at a shared size it renders half as
 * legible. Card is four marks in a row and needs the opposite treatment.
 */
export const TILE_MARK_SIZE: Partial<Record<TileKey, number>> = {
  card: 14,
  venmo: 40,
  paypal: 30,
};
export const DEFAULT_MARK_SIZE = 24;

// Deposit lead-time choices, shown in order: short day options, then weeks.
// Stored verbatim as the label so "7 days" and "1 week" stay distinct.
export const DEPOSIT_LEAD_OPTIONS = [
  '2 days', '3 days', '4 days', '5 days', '6 days', '7 days',
  '1 week', '2 weeks', '3 weeks', '4 weeks', '5 weeks', '6 weeks',
];
