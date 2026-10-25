/** Column sets + row mappers shared by lists, entity pages, AI tools and exports. */
import { fmt } from './lagos';
import { ONLINE_MS } from './geo';

export type Col = { key: string; label: string };
export type Row = Record<string, unknown> & { _id?: string; _links?: Record<string, string>; _ts?: Date | string };

export const USER_COLS: Col[] = [{ key: 'name', label: 'User' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'lga', label: 'LGA' }, { key: 'status', label: 'Status' }, { key: 'device', label: 'Current device' }, { key: 'regDate', label: 'Reg date' }, { key: 'lastLogin', label: 'Last login' }];
export const AGENT_COLS: Col[] = [{ key: 'name', label: 'Agent' }, { key: 'phone', label: 'Phone' }, { key: 'lga', label: 'LGA' }, { key: 'group', label: 'Group' }, { key: 'status', label: 'Status' }, { key: 'online', label: 'Presence' }, { key: 'regDate', label: 'Onboarded' }];
export const INC_COLS: Col[] = [{ key: 'category', label: 'Category' }, { key: 'details', label: 'Report' }, { key: 'location', label: 'Location' }, { key: 'reporter', label: 'Reporter' }, { key: 'status', label: 'Status' }, { key: 'date', label: 'Report date' }];
export const ALARM_COLS: Col[] = [{ key: 'sender', label: 'Sender' }, { key: 'phone', label: 'Phone' }, { key: 'location', label: 'Location' }, { key: 'type', label: 'Type' }, { key: 'status', label: 'Status' }, { key: 'date', label: 'Alarm date' }];
export const ALERT_COLS: Col[] = [{ key: 'sender', label: 'Sender' }, { key: 'title', label: 'Title' }, { key: 'body', label: 'Security alert' }, { key: 'receiver', label: 'Audience' }, { key: 'date', label: 'Posted' }];
export const GROUP_COLS: Col[] = [{ key: 'name', label: 'Homeland group' }, { key: 'description', label: 'Description' }, { key: 'lga', label: 'Base LGA' }, { key: 'agents', label: 'Agents' }, { key: 'activeAgents', label: 'Active' }, { key: 'status', label: 'Status' }, { key: 'date', label: 'Created' }];
export const CAT_COLS: Col[] = [{ key: 'name', label: 'Category' }, { key: 'riskLevel', label: 'Risk level' }, { key: 'sendAgentCount', label: 'Agents to send' }, { key: 'reports', label: 'Reports' }, { key: 'status', label: 'Status' }, { key: 'date', label: 'Created' }];
export const ADMIN_COLS: Col[] = [{ key: 'name', label: 'Admin' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }, { key: 'role', label: 'Role' }, { key: 'status', label: 'Status' }, { key: 'lastLogin', label: 'Last login' }];
export const DEVICE_COLS: Col[] = [{ key: 'label', label: 'Device' }, { key: 'os', label: 'OS' }, { key: 'users', label: 'Users' }, { key: 'agents', label: 'Agents' }, { key: 'date', label: 'First seen' }];
export const AUDIT_COLS: Col[] = [{ key: 'date', label: 'When' }, { key: 'actor', label: 'Admin' }, { key: 'action', label: 'Action' }, { key: 'summary', label: 'Details' }, { key: 'ip', label: 'IP' }];

const clean = (o: Record<string, string | undefined | null>) => Object.fromEntries(Object.entries(o).filter(([, v]) => !!v)) as Record<string, string>;
export const isOnline = (d?: Date | null) => !!d && Date.now() - d.getTime() < ONLINE_MS();

export const userRow = (u: any, devIds?: Map<string, string>): Row => ({
  _id: u.publicId, name: u.name, phone: u.phone, email: u.email || '', lga: u.lga, status: u.status, device: u.device || '',
  regDate: fmt(u.createdAt), lastLogin: fmt(u.lastLogin), _ts: u.createdAt,
  _links: clean({ device: u.device && devIds?.get(u.device) ? `/e/${devIds.get(u.device)}` : null }),
});
export const agentRow = (a: any): Row => ({
  _id: a.publicId, name: a.name, phone: a.phone, lga: a.lga, group: a.group?.name || 'Un-assigned', status: a.status,
  online: isOnline(a.lastSeenAt) ? 'online' : 'offline', regDate: fmt(a.createdAt), _ts: a.createdAt, _groupId: a.group?.publicId || null,
  _links: clean({ group: a.group ? `/e/${a.group.publicId}` : null }),
});
export const incidentRow = (i: any): Row => ({
  _id: i.publicId, category: i.category, details: i.details, location: i.location, lga: i.lga, reporter: i.reporter?.name || 'Anonymous',
  status: i.status, date: fmt(i.createdAt), _ts: i.createdAt,
  _links: clean({ reporter: i.reporter ? `/e/${i.reporter.publicId}` : null, category: undefined }),
});
export const alarmRow = (a: any): Row => ({
  _id: a.publicId, sender: a.sender, phone: a.phone, location: a.location || '', type: a.type, status: a.status, date: fmt(a.createdAt), _ts: a.createdAt,
  _links: clean({ sender: a.user ? `/e/${a.user.publicId}` : null }),
});
export const alertRow = (a: any): Row => ({ _id: a.publicId, sender: a.sender, title: a.title, body: a.body, receiver: `LGA: ${a.lga} · User: ${a.userType} · Group: ${a.group}`, date: fmt(a.createdAt), _ts: a.createdAt });
export const groupRow = (g: any): Row => ({ _id: g.publicId, name: g.name, description: g.description || '', lga: g.lga || '', agents: g._count?.agents ?? 0, activeAgents: g.activeAgents ?? '', status: g.status, date: fmt(g.createdAt), _ts: g.createdAt });
export const categoryRow = (c: any): Row => ({ _id: c.publicId, name: c.name, riskLevel: c.riskLevel, sendAgentCount: c.sendAgentCount, reports: c._count?.incidents ?? 0, status: c.status, date: fmt(c.createdAt), _ts: c.createdAt, description: c.description || '' });
export const adminRow = (a: any): Row => ({ _id: a.publicId, name: a.name, email: a.email, phone: a.phone || '', role: a.role, status: a.status, lastLogin: fmt(a.lastLoginAt), _groupId: a.group?.publicId || null });
export const auditRow = (l: any): Row => ({ _id: l.entityId || undefined, date: fmt(l.createdAt), actor: l.actorEmail, action: l.action, summary: l.summary, ip: l.ip || '', _ts: l.createdAt, _auditId: l.id, _entityType: l.entityType });
