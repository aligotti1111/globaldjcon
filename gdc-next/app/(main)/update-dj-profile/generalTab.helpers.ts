// Split the helper's "street, City, ST zip" display into parts for the
// structured columns. The display format is fixed by formatStructuredAddress
// in mobileBookingForm, so this parse is reliable rather than guesswork.
export function parseDisplayAddress(display: string): { city: string; state: string; zip: string } {
  const parts = display.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { city: '', state: '', zip: '' };
  const stateZip = parts[parts.length - 1];
  const zipMatch = stateZip.match(/(\d[\w-]{2,})\s*$/);
  const zip = zipMatch ? zipMatch[1] : '';
  const state = (zip ? stateZip.replace(zip, '') : stateZip).trim();
  const city = parts.length >= 2 ? parts[parts.length - 2] : '';
  return { city, state, zip };
}
