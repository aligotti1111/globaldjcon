// Does this look like a person's full name — first AND last?
//
// WHY THIS EXISTS
// A contract needs both names. "Jane" is not a party to an agreement; "Jane
// Smith" is. Hosts were signing up with a first name only, and the gap didn't
// surface until a DJ went to generate a contract weeks later — at which point
// the host is gone and the DJ is chasing them for a surname.
//
// So it's checked at the two moments the host is actually present: when they
// create the account, and when they request a booking. The second one matters
// as much as the first, because it's the only thing that catches the hosts who
// already signed up with one word.
//
// WHY IT'S DELIBERATELY LOOSE
// Name validation is where software is most confidently wrong about people.
// This rule asserts exactly one thing — there are two or more words — and
// nothing else. No alphabet restrictions, no minimum length per word, no
// title-casing, no "must not contain numbers." Mononyms exist, particles like
// "van der" exist, non-Latin scripts exist, and a rule clever enough to reject
// a typo is clever enough to reject a real person's real name. Two words is
// the weakest check that still does the job it was added for.
//
// NOT USED FOR DJ OR VENUE NAMES. Those are business names — "Skrillex" and
// "Pulse" are complete and correct answers. Only a host signs as an individual.

/** True when `raw` contains at least two whitespace-separated words. */
export function isFullName(raw: string | null | undefined): boolean {
  return splitName(raw).length >= 2;
}

/** The words of a name, with runs of whitespace collapsed. */
export function splitName(raw: string | null | undefined): string[] {
  return (raw || '').trim().split(/\s+/).filter(Boolean);
}

/** Collapses internal whitespace so "Jane   Smith" stores as "Jane Smith". */
export function normalizeName(raw: string | null | undefined): string {
  return splitName(raw).join(' ');
}

/** The one message every caller shows, so the wording can't drift apart. */
export const FULL_NAME_ERROR = 'Please enter your first and last name — contracts need both.';
