// BrandMarks — the real payment logos.
//
// Path data from the simple-icons project, which tracks each brand's official
// mark. NOT drawn by hand: a reconstructed logo is subtly wrong, and a wrong
// mark is both a bad look and a breach of the brand guidelines it's meant to
// respect. Colours are each brand's own hex.
//
// Inlined rather than <img src="cdn...">: these sit on a payment screen, and a
// blocked CDN or an offline moment would leave a client staring at a broken
// image where the "pay $600" button should be. No network, no dependency, no
// flash.
//
// Trademark note: these are used nominatively — to say "you can pay with this"
// — which is what the brand centres publish them for. Don't recolour or
// restretch them; if a brand objects, swap the path here and nowhere else.
//
// Generated from simple-icons. To refresh: npm i simple-icons, read si.siVenmo
// .path / .hex etc.

interface MarkProps { size?: number; color?: string }


export const VENMO_HEX = '#008CFF';
/** Venmo — official mark. */
export function VenmoMark({ size = 20, color }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color || VENMO_HEX} aria-hidden="true">
      <path d="M21.772 13.119c-.267 0-.381-.251-.38-.655 0-.533.121-1.575.712-1.575.267 0 .357.243.357.598 0 .533-.13 1.632-.689 1.632Zm.502-3.377c-1.677 0-2.405 1.285-2.405 2.658 0 1.042.421 1.874 1.693 1.874 1.717 0 2.438-1.406 2.438-2.763 0-1.025-.462-1.769-1.726-1.769Zm-3.833 0c-.558 0-.964.17-1.393.477-.154-.275-.462-.477-.932-.477-.542 0-.947.219-1.247.437l-.04-.364H13.54l-.688 4.354h1.506l.479-3.053c.129-.065.323-.154.518-.154.145 0 .267.049.267.267 0 .056-.016.145-.024.218l-.429 2.722h1.498l.478-3.053c.138-.073.324-.154.51-.154.146 0 .268.049.268.267 0 .056-.017.145-.025.218l-.429 2.722h1.499l.461-2.908c.025-.153.049-.388.049-.549 0-.582-.267-.97-1.037-.97Zm-6.871 0c-.575 0-.98.219-1.287.421l-.017-.348H8.962l-.689 4.354H9.78l.478-3.053c.13-.065.324-.154.518-.154.147 0 .268.049.268.242 0 .081-.024.227-.032.299l-.422 2.666h1.499l.462-2.908c.024-.153.049-.388.049-.549 0-.582-.268-.97-1.03-.97Zm-5.631 1.834c.041-.485.413-.824.697-.824.162 0 .299.097.299.291 0 .404-.713.533-.996.533Zm.843-1.834c-1.604 0-2.382 1.39-2.382 2.698 0 1.01.478 1.817 1.814 1.817.527 0 1.07-.113 1.418-.282l.186-1.26c-.494.25-.874.347-1.271.347-.365 0-.64-.194-.64-.687.826-.008 2.252-.347 2.252-1.453 0-.687-.494-1.18-1.377-1.18Zm-4.239.267c.089.186.146.412.146.743 0 .606-.429 1.494-.777 2.06l-.373-2.989L0 9.969l.705 4.2h1.757c.77-1.01 1.718-2.448 1.718-3.554 0-.347-.073-.622-.235-.889l-1.402.283Z" />
    </svg>
  );
}

export const CASHAPP_HEX = '#00C244';
/** Cash App — official mark. */
export function CashAppMark({ size = 20, color }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color || CASHAPP_HEX} aria-hidden="true">
      <path d="M23.59 3.475a5.1 5.1 0 00-3.05-3.05c-1.31-.42-2.5-.42-4.92-.42H8.36c-2.4 0-3.61 0-4.9.4a5.1 5.1 0 00-3.05 3.06C0 4.765 0 5.965 0 8.365v7.27c0 2.41 0 3.6.4 4.9a5.1 5.1 0 003.05 3.05c1.3.41 2.5.41 4.9.41h7.28c2.41 0 3.61 0 4.9-.4a5.1 5.1 0 003.06-3.06c.41-1.3.41-2.5.41-4.9v-7.25c0-2.41 0-3.61-.41-4.91zm-6.17 4.63l-.93.93a.5.5 0 01-.67.01 5 5 0 00-3.22-1.18c-.97 0-1.94.32-1.94 1.21 0 .9 1.04 1.2 2.24 1.65 2.1.7 3.84 1.58 3.84 3.64 0 2.24-1.74 3.78-4.58 3.95l-.26 1.2a.49.49 0 01-.48.39H9.63l-.09-.01a.5.5 0 01-.38-.59l.28-1.27a6.54 6.54 0 01-2.88-1.57v-.01a.48.48 0 010-.68l1-.97a.49.49 0 01.67 0c.91.86 2.13 1.34 3.39 1.32 1.3 0 2.17-.55 2.17-1.42 0-.87-.88-1.1-2.54-1.72-1.76-.63-3.43-1.52-3.43-3.6 0-2.42 2.01-3.6 4.39-3.71l.25-1.23a.48.48 0 01.48-.38h1.78l.1.01c.26.06.43.31.37.57l-.27 1.37c.9.3 1.75.77 2.48 1.39l.02.02c.19.2.19.5 0 .68z" />
    </svg>
  );
}

export const PAYPAL_HEX = '#002991';
/** PayPal — official mark. */
export function PaypalMark({ size = 20, color }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color || PAYPAL_HEX} aria-hidden="true">
      <path d="M15.607 4.653H8.941L6.645 19.251H1.82L4.862 0h7.995c3.754 0 6.375 2.294 6.473 5.513-.648-.478-2.105-.86-3.722-.86m6.57 5.546c0 3.41-3.01 6.853-6.958 6.853h-2.493L11.595 24H6.74l1.845-11.538h3.592c4.208 0 7.346-3.634 7.153-6.949a5.24 5.24 0 0 1 2.848 4.686M9.653 5.546h6.408c.907 0 1.942.222 2.363.541-.195 2.741-2.655 5.483-6.441 5.483H8.714Z" />
    </svg>
  );
}

export const ZELLE_HEX = '#6D1ED4';
/** Zelle — official mark. */
export function ZelleMark({ size = 20, color }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color || ZELLE_HEX} aria-hidden="true">
      <path d="M13.559 24h-2.841a.483.483 0 0 1-.483-.483v-2.765H5.638a.667.667 0 0 1-.666-.666v-2.234a.67.67 0 0 1 .142-.412l8.139-10.382h-7.25a.667.667 0 0 1-.667-.667V3.914c0-.367.299-.666.666-.666h4.23V.483c0-.266.217-.483.483-.483h2.841c.266 0 .483.217.483.483v2.765h4.323c.367 0 .666.299.666.666v2.137a.67.67 0 0 1-.141.41l-8.19 10.481h7.665c.367 0 .666.299.666.666v2.477a.667.667 0 0 1-.666.667h-4.32v2.765a.483.483 0 0 1-.483.483Z" />
    </svg>
  );
}


/** A generic card. No brand — it stands for "any card", not Visa or Amex. */
export const CARD_HEX = '#635BFF';
export function CardMark({ size = 20, color }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || CARD_HEX} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1" y="4" width="22" height="16" rx="3" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}

export const CASH_HEX = '#2FA36B';
export function CashMark({ size = 20, color }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || CASH_HEX} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

export const CHECK_HEX = '#8a8aa0';
export function CheckMark({ size = 20, color }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || CHECK_HEX} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="6" y1="10" x2="14" y2="10" />
      <line x1="6" y1="14" x2="10" y2="14" />
    </svg>
  );
}

export const OTHER_HEX = '#8a8aa0';
export function OtherMark({ size = 20, color }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || OTHER_HEX} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="21" x2="21" y2="21" />
      <path d="M3 10h18L12 3 3 10z" />
      <line x1="6" y1="10" x2="6" y2="21" />
      <line x1="12" y1="10" x2="12" y2="21" />
      <line x1="18" y1="10" x2="18" y2="21" />
    </svg>
  );
}
