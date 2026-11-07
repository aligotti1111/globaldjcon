// lib/team.ts — team seats (extra logins with restricted roles).
export type TeamRole = 'admin' | 'manager' | 'assistant';

export const TEAM_ROLES: { value: TeamRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'assistant', label: 'Assistant' },
];

// The "send documents" capability wording depends on the DJ type: mobile DJs
// send planners & playlists; club/bar DJs send riders & guest lists.
export function docCapabilityLabel(djType: string | null | undefined): string {
  return djType === 'mobile'
    ? 'Send contracts, planners & playlists'
    : 'Send contracts, riders & guest lists';
}

export interface RoleCap {
  label: string;
  admin: boolean;
  manager: boolean;
  assistant: boolean;
  // Optional second line of detail under the label (e.g. what "Edit the DJ
  // profile" actually covers), and an icon key the UI maps to an SVG.
  sub?: string;
  icon?: string;
}

export function roleMatrix(djType: string | null | undefined): RoleCap[] {
  // What documents an assistant may SEND (not contracts) depends on DJ type.
  const isMobile = djType === 'mobile';
  const sendDocsLabel = isMobile
    ? 'Send planners & playlists'
    : 'Update flyer, send riders & guest lists';
  const tmplLabel = isMobile
    ? 'Edit planner & playlist templates'
    : 'Edit rider & guest-list templates';
  return [
    { label: 'View bookings', admin: true, manager: true, assistant: true, icon: 'eye' },
    { label: sendDocsLabel, admin: true, manager: true, assistant: true, icon: 'send' },
    // Edit the public DJ profile — every seat may do this; only the Owner can
    // change the DJ's displayed NAME and account settings.
    {
      label: 'Edit the DJ profile',
      sub: 'Photos & albums · bio & about · banner & logo · tabs · FAQs · staff · affiliates · press',
      admin: true, manager: true, assistant: true, icon: 'profile',
    },
    { label: 'Send invoices & receipts', admin: true, manager: true, assistant: true, icon: 'receipt' },
    { label: 'Accept or deny bookings', admin: true, manager: true, assistant: false, icon: 'check' },
    { label: 'Create manual bookings', admin: true, manager: true, assistant: false, icon: 'plus' },
    { label: 'Send & sign contracts', admin: true, manager: true, assistant: false, icon: 'contract' },
    { label: 'Request deposit & balance', admin: true, manager: true, assistant: false, icon: 'money' },
    { label: tmplLabel, admin: true, manager: true, assistant: false, icon: 'template' },
    { label: 'Create discounts & promo codes', admin: true, manager: true, assistant: false, icon: 'tag' },
    { label: 'Manage team (invite & remove staff)', admin: true, manager: false, assistant: false, icon: 'team' },
    { label: 'Change billing/subscription, account settings or booking settings', admin: false, manager: false, assistant: false, icon: 'lock' },
  ];
}

export function roleLabel(r: string): string {
  return TEAM_ROLES.find((x) => x.value === r)?.label || r;
}
export function isTeamRole(r: unknown): r is TeamRole {
  return r === 'admin' || r === 'manager' || r === 'assistant';
}
