// lib/team.ts — team seats (extra logins with restricted roles).
export type TeamRole = 'admin' | 'manager' | 'assistant';

export const TEAM_ROLES: { value: TeamRole; label: string; blurb: string }[] = [
  { value: 'admin', label: 'Admin', blurb: 'Full access, including team. Not billing or account deletion.' },
  { value: 'manager', label: 'Manager', blurb: 'Bookings, contracts, deposits & invoices, settings. No billing or team.' },
  { value: 'assistant', label: 'Assistant', blurb: 'View bookings; send contracts, planners, riders & guest lists. No money or settings.' },
];

export function roleLabel(r: string): string {
  return TEAM_ROLES.find((x) => x.value === r)?.label || r;
}
export function isTeamRole(r: unknown): r is TeamRole {
  return r === 'admin' || r === 'manager' || r === 'assistant';
}
