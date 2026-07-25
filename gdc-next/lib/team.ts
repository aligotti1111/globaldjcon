// lib/team.ts — team seats (extra logins with restricted roles).
export type TeamRole = 'admin' | 'manager' | 'assistant';

export interface RolePerm { text: string; allowed: boolean; }
export const TEAM_ROLES: { value: TeamRole; label: string; blurb: string; perms: RolePerm[] }[] = [
  {
    value: 'admin', label: 'Admin',
    blurb: 'Top teammate role — bookings, payments, and all documents.',
    perms: [
      { text: 'View & manage bookings', allowed: true },
      { text: 'Send contracts, planners, riders & guest lists', allowed: true },
      { text: 'Take deposits & send invoices', allowed: true },
      { text: 'Change billing or booking settings', allowed: false },
    ],
  },
  {
    value: 'manager', label: 'Manager',
    blurb: 'Bookings, payments, and all documents.',
    perms: [
      { text: 'View & manage bookings', allowed: true },
      { text: 'Send contracts, planners, riders & guest lists', allowed: true },
      { text: 'Take deposits & send invoices', allowed: true },
      { text: 'Change billing or booking settings', allowed: false },
    ],
  },
  {
    value: 'assistant', label: 'Assistant',
    blurb: 'Bookings and documents only — no payments.',
    perms: [
      { text: 'View bookings', allowed: true },
      { text: 'Send contracts, planners, riders & guest lists', allowed: true },
      { text: 'Take deposits or send invoices', allowed: false },
      { text: 'Change billing or booking settings', allowed: false },
    ],
  },
];

export function roleLabel(r: string): string {
  return TEAM_ROLES.find((x) => x.value === r)?.label || r;
}
export function isTeamRole(r: unknown): r is TeamRole {
  return r === 'admin' || r === 'manager' || r === 'assistant';
}
