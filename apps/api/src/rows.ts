/** Column sets + row mappers shared by lists, entity pages, AI tools and exports. */
import { fmt } from './lagos';
import { ONLINE_MS } from './geo';
import { SOURCE_LABEL, localTitle } from './incident-text';

export type Col = { key: string; label: string };
export type Row = Record<string, unknown> & { _id?: string; _links?: Record<string, string>; _ts?: Date | string };

export const USER_COLS: Col[] = [{ key: 'name', label: 'User' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'lga', label: 'LGA' }, { key: 'status', label: 'Status' }, { key: 'device', label: 'Current Device' }, { key: 'regDate', label: 'Reg Date' }, { key: 'lastLogin', label: 'Last Login' }];
export const AGENT_COLS: Col[] = [{ key: 'name', label: 'Agent' }, { key: 'tag', label: 'Government Tag' }, { key: 'phone', label: 'Phone' }, { key: 'lga', label: 'LGA' }, { key: 'group', label: 'Group' }, { key: 'status', label: 'Status' }, { key: 'online', label: 'Presence' }, { key: 'regDate', label: 'Onboarded' }];
export const INC_COLS: Col[] = [{ key: 'category', label: 'Category' }, { key: 'title', label: 'Report' }, { key: 'location', label: 'Location' }, { key: 'reporter', label: 'Reporter' }, { key: 'status', label: 'Status' }, { key: 'date', label: 'Report Date' }];
export const ALARM_COLS: Col[] = [{ key: 'sender', label: 'Sender' }, { key: 'phone', label: 'Phone' }, { key: 'location', label: 'Location' }, { key: 'type', label: 'Type' }, { key: 'status', label: 'Status' }, { key: 'date', label: 'Alarm Date' }];
export const ALERT_COLS: Col[] = [{ key: 'sender', label: 'Sender' }, { key: 'title', label: 'Title' }, { key: 'body', label: 'Security Alert' }, { key: 'receiver', label: 'Audience' }, { key: 'date', label: 'Posted' }];
export const GROUP_COLS: Col[] = [{ key: 'name', label: 'Homeland Group' }, { key: 'description', label: 'Description' }, { key: 'lga', label: 'Base LGA' }, { key: 'agents', label: 'Agents' }, { key: 'activeAgents', label: 'Active' }, { key: 'status', label: 'Status' }, { key: 'date', label: 'Created' }];
export const CAT_COLS: Col[] = [{ key: 'name', label: 'Category' }, { key: 'riskLevel', label: 'Risk Level' }, { key: 'sendAgentCount', label: 'Agents To Send' }, { key: 'reports', label: 'Reports' }, { key: 'status', label: 'Status' }, { key: 'date', label: 'Created' }];
export const ADMIN_COLS: Col[] = [{ key: 'name', label: 'Admin' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }, { key: 'role', label: 'Role' }, { key: 'status', label: 'Status' }, { key: 'lastLogin', label: 'Last Login' }];
export const DEVICE_COLS: Col[] = [{ key: 'label', label: 'Device' }, { key: 'os', label: 'OS' }, { key: 'users', label: 'Users' }, { key: 'agents', label: 'Agents' }, { key: 'date', label: 'First Seen' }];
export const AUDIT_COLS: Col[] = [{ key: 'date', label: 'When' }, { key: 'actor', label: 'Admin' }, { key: 'action', label: 'Action' }, { key: 'summary', label: 'Details' }, { key: 'ip', label: 'IP' }];

const clean = (o: Record<string, string | undefined | null>) => Object.fromEntries(Object.entries(o).filter(([, v]) => !!v)) as Record<string, string>;
export const isOnline = (d?: Date | null) => !!d && Date.now() - d.getTime() < ONLINE_MS();

export const userRow = (u: any, devIds?: Map<string, string>): Row => ({
  _id: u.publicId, name: u.name, phone: u.phone, email: u.email || '', lga: u.lga, status: u.status, device: u.device || '',
  regDate: fmt(u.createdAt), lastLogin: fmt(u.lastLogin), _ts: u.createdAt,
  _links: clean({ device: u.device && devIds?.get(u.device) ? `/e/${devIds.get(u.device)}` : null }),
});
export const agentRow = (a: any): Row => ({
  _id: a.publicId, name: a.name, tag: a.tag || '', phone: a.phone, lga: a.lga, group: a.group?.name || 'Un-assigned', status: a.status,
  online: isOnline(a.lastSeenAt) ? 'online' : 'offline', regDate: fmt(a.createdAt), _ts: a.createdAt, _groupId: a.group?.publicId || null,
  _links: clean({ group: a.group ? `/e/${a.group.publicId}` : null }),
});
/** Who filed it: the agent (source=agent), the app user, or the desk for call-centre/ECC intake. */
export const reporterOf = (i: any): { name: string; href: string | null } =>
  i.agentReporter ? { name: i.agentReporter.name, href: `/e/${i.agentReporter.publicId}` }
  : i.reporter ? { name: i.reporter.name, href: `/e/${i.reporter.publicId}` }
  : { name: i.source === 'call_centre' ? 'Call Centre Desk' : i.source === 'ecc' ? 'ECC Desk' : 'Anonymous', href: null };
export const incidentRow = (i: any): Row => {
  const rep = reporterOf(i);
  return {
    _id: i.publicId, category: i.category, title: i.aiTitle || localTitle(i.details, i.category), details: i.details, location: i.location, lga: i.lga,
    reporter: rep.name, _reporterRole: SOURCE_LABEL[i.source] || 'User', source: SOURCE_LABEL[i.source] || 'User', _source: i.source || 'user',
    status: i.status, date: fmt(i.createdAt), _ts: i.createdAt, _aiTitle: !!i.aiTitle,
    _links: clean({ reporter: rep.href, category: undefined }),
  };
};
export const alarmRow = (a: any): Row => ({
  _id: a.publicId, sender: a.sender, phone: a.phone, location: a.location || '', type: a.type, status: a.status, date: fmt(a.createdAt), _ts: a.createdAt,
  _links: clean({ sender: a.user ? `/e/${a.user.publicId}` : null }),
});
export const alertRow = (a: any): Row => ({ _id: a.publicId, sender: a.sender, title: a.title, body: a.body, receiver: `LGA: ${a.lga} · User: ${a.userType} · Group: ${a.group}`, date: fmt(a.createdAt), _ts: a.createdAt });
export const groupRow = (g: any): Row => ({ _id: g.publicId, name: g.name, description: g.description || '', lga: g.lga || '', agents: g._count?.agents ?? 0, activeAgents: g.activeAgents ?? '', status: g.status, date: fmt(g.createdAt), _ts: g.createdAt });
export const categoryRow = (c: any): Row => ({ _id: c.publicId, name: c.name, riskLevel: c.riskLevel, sendAgentCount: c.sendAgentCount, reports: c._count?.incidents ?? 0, status: c.status, date: fmt(c.createdAt), _ts: c.createdAt, description: c.description || '' });
export const adminRow = (a: any): Row => ({ _id: a.publicId, name: a.name, email: a.email, phone: a.phone || '', role: a.role, status: a.status, lastLogin: fmt(a.lastLoginAt), _groupId: a.group?.publicId || null });
/** `names`: actorId → admin display name (falls back to the email recorded on the log line). */
export const auditRow = (l: any, names?: Map<string, string>): Row => ({ _id: l.entityId || undefined, date: fmt(l.createdAt), actor: (names instanceof Map && l.actorId && names.get(l.actorId)) || l.actorEmail || 'System', _actorEmail: l.actorEmail || '', action: actionLabel(l.action), _action: l.action, summary: l.summary, ip: l.ip || '', _ts: l.createdAt, _auditId: l.id, _entityType: l.entityType });

/** Short human label for an audit action code: incident.dispatch → "Dispatch", auth.login → "Login". */
const VERB: Record<string, string> = { create: 'Add', update: 'Edit', delete: 'Delete', send: 'Send', resolve: 'Resolve', upload: 'Upload', link: 'Link', approve: 'Approve', activate: 'Activate', suspend: 'Suspend', reset_password: 'Reset Password' };
const NOUN: Record<string, string> = { user: 'User', agent: 'Agent', admin: 'Admin', group: 'Group', category: 'Category', alert: 'Alert', alarm: 'Alarm', media: 'Media' };
const FIXED: Record<string, string> = {
  'incident.dispatch': 'Dispatch', 'incident.vigilante': 'Send to Vigilante', 'incident.ai': 'AI Summary', 'incident.acted': 'Acted Upon', 'incident.resolved': 'Resolve', 'incident.fake': 'Mark Fake',
  'auth.login': 'Login', 'auth.logout': 'Logout', 'auth.login_failed': 'Failed Login', 'settings.site': 'Site Settings', 'admin.reset_password': 'Reset Password',
};
const title = (s: string) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export function actionLabel(code: string): string {
  if (!code) return '';
  if (code.endsWith('.undo')) return `Undo ${actionLabel(code.slice(0, -5))}`;
  if (FIXED[code]) return FIXED[code];
  const [ent, verb = ''] = code.split('.');
  if (ent === 'import') return `Import ${title(verb)}`;
  if (VERB[verb] && NOUN[ent]) return `${VERB[verb]} ${NOUN[ent]}`;
  return title(verb || ent);
}
