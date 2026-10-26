import { titleCase as tc } from './api';
export type NavChild = { key: string; label: string; full: string; href: string };
export type NavParent = { key: string; short: string; full: string; icon: string; tone: 'blue' | 'green' | 'amber' | 'rose' | 'violet' | 'teal'; children: NavChild[] };

const c = (section: string, child: string, label: string, full?: string): NavChild => ({
  key: `${section}.${child}`, label: tc(label), full: tc(full || label), href: child === 'feed' ? '/alerts' : `/${section}/${child}`,
});

export const NAV: NavParent[] = [
  { key: 'users', short: 'Users', full: 'General Users', icon: 'users', tone: 'blue', children: [
    c('users', 'active', 'Active', 'Active users'), c('users', 'suspended', 'Suspended', 'Suspended users'),
    c('users', 'pending', 'Pending', 'Pending users'), c('users', 'generate', 'Generate list', 'Generate user list'),
    c('users', 'devices', 'App devices', 'App devices list'),
  ] },
  { key: 'agents', short: 'Agents', full: 'Abia Homeland Security Service', icon: 'shield', tone: 'green', children: [
    c('agents', 'groups', 'Groups', 'Homeland groups'), c('agents', 'admins', 'Admins', 'Homeland admin list'),
    c('agents', 'new', 'Add agent', 'Add new local agent'), c('agents', 'active', 'Active', 'Active local agents'),
    c('agents', 'suspended', 'Suspended', 'Suspended local agents'), c('agents', 'unassigned', 'Unassigned', 'Un-assigned local agents'),
    c('agents', 'map', 'Map', 'View agent location'),
  ] },
  { key: 'reports', short: 'Reports', full: 'Incident Reports', icon: 'file', tone: 'amber', children: [
    c('reports', 'categories', 'Categories', 'Report categories'), c('reports', 'map', 'Active map', 'Active incident map'),
    c('reports', 'new', 'New', 'New reports'), c('reports', 'dispatched', 'Dispatched', 'Dispatched reports'),
    c('reports', 'acted', 'Acted upon', 'Acted upon reports'), c('reports', 'resolved', 'Resolved', 'Resolved security reports'),
  ] },
  { key: 'alarms', short: 'Alarms', full: 'Alarms', icon: 'siren', tone: 'rose', children: [
    c('alarms', 'new', 'New', 'New alarms'), c('alarms', 'duress', 'Duress', 'Duress alarms'), c('alarms', 'panic', 'Panic', 'Panic alarms'),
  ] },
  { key: 'tips', short: 'Tips', full: 'Security Tips', icon: 'tips', tone: 'violet', children: [
    c('tips', 'send', 'Send alert', 'Send security alert'), c('tips', 'alerts', 'View alerts', 'View security alerts'),
  ] },
  { key: 'alerts', short: 'Alerts', full: 'Alerts & Notifications', icon: 'bell', tone: 'teal', children: [
    c('alerts', 'feed', 'Notification feed', 'All new-ins and activity'),
  ] },
];

/** Reachable via KPI / analytics drill-down only — not shown in the nav pane. */
export const DRILL_ONLY: NavChild[] = [
  c('reports', 'users', 'From users', 'Reports from users'),
  c('reports', 'agents', 'From agents', 'Reports from agents'),
  c('reports', 'call-centre', 'Call centre', 'Call centre reports'),
  c('reports', 'ecc', 'ECC', 'ECC reports'),
  // Analytics lives under the Dashboard button in the sidebar (not duplicated in the Reports pane).
  c('reports', 'analytics', 'Analytics', 'Generate analytics'),
];

export function findChild(section: string, child: string) {
  const p = NAV.find((n) => n.key === section);
  const ch = p?.children.find((x) => x.key === `${section}.${child}`)
    || DRILL_ONLY.find((x) => x.key === `${section}.${child}`);
  if (!ch) return null;
  const parent = p || NAV.find((n) => n.key === section) || { key: section, short: tc(section), full: tc(section), icon: 'file', tone: 'amber' as const, children: [] };
  return { parent, child: ch };
}
export function parentForPath(path: string) {
  if (path.startsWith('/alerts')) return 'alerts';
  const seg = path.split('/')[1];
  return NAV.find((n) => n.key === seg)?.key || null;
}
