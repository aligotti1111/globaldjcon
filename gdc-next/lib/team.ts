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

export interface RoleCap { label: string; admin: boolean; manager: boolean; assistant: boolean; }

export function roleMatrix(djType: string | null | undefined): RoleCap[] {
  // What documents an assistant may SEND (not contracts) depends on DJ type.
  const sendDocsLabel = djType === 'mobile'
    ? 'Send planners & playlists'
    : 'Update flyer, send riders & guest lists';
  return [
    { label: 'View bookings', admin: true, manager: true, assistant: true },
    { label: sendDocsLabel, admin: true, manager: true, assistant: true },
    { label: 'Send invoices', admin: true, manager: true, assistant: true },
    { label: 'Accept or deny bookings', admin: true, manager: true, assistant: false },
    { label: 'Send contracts', admin: true, manager: true, assistant: false },
    { label: 'Request deposits', admin: true, manager: true, assistant: false },
    { label: 'Manage team (invite & remove staff)', admin: true, manager: false, assistant: false },
    { label: 'Change billing or booking settings', admin: false, manager: false, assistant: false },
  ];
}

export function roleLabel(r: string): string {
  return TEAM_ROLES.find((x) => x.value === r)?.label || r;
}
export function isTeamRole(r: unknown): r is TeamRole {
  return r === 'admin' || r === 'manager' || r === 'assistant';
}
