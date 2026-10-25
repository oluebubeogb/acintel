import { BadRequestException, Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { dayKey, dayLabel, fmt, lagosDayRange, lagosDayStart, longDay, rangeFor } from './lagos';
import { LGAS, LGA_GEO, ONLINE_MS } from './geo';
import {
  ADMIN_COLS, AGENT_COLS, ALARM_COLS, ALERT_COLS, AUDIT_COLS, CAT_COLS, DEVICE_COLS, GROUP_COLS, INC_COLS, USER_COLS,
  adminRow, agentRow, alarmRow, reporterOf, alertRow, auditRow, categoryRow, groupRow, incidentRow, isOnline, userRow,
} from './rows';
import { SOURCE_LABEL, localSummary, localTitle, normSource } from './incident-text';
export { fmt } from './lagos';
/** Nav page → incident source. */
export const SOURCE_PAGES: Record<string, string> = { 'reports.users': 'user', 'reports.agents': 'agent', 'reports.call-centre': 'call_centre', 'reports.ecc': 'ecc' };

type Q = Record<string, string | undefined>;
const ACTIVE_INC = ['new', 'dispatched', 'acted'];
const TASK_FILTER: Record<string, string[] | null> = { all: null, assigned: ['assigned'], responded: ['responded', 'completed'], open: ['assigned', 'responded'], completed: ['completed'] };
const TASK_LABEL: Record<string, string> = { assigned: 'Assigned', responded: 'Responded', completed: 'Completed', declined: 'Declined' };
const TASK_COLS = [{ key: 'category', label: 'Category' }, { key: 'location', label: 'Location' }, { key: 'lga', label: 'LGA' }, { key: 'task', label: 'Agent Status' }, { key: 'status', label: 'Report Status' }, { key: 'assigned', label: 'Assigned' }, { key: 'responded', label: 'Responded' }];
const taskRow = (t: any) => ({ ...incidentRow(t.incident), task: TASK_LABEL[t.status] || t.status, assigned: fmt(t.createdAt), responded: fmt(t.respondedAt), _ts: t.createdAt });
type Stat = { label: string; value: string | number; accent: string; icon: string; tip: string; drill?: { kind: string; query?: Record<string, string>; title: string; href?: string } };
/** 30 Lagos days ending today, zero-filled. */
const thirtyDays = <T extends object>(init: () => T) => {
  const since = lagosDayStart(dayKey(new Date(Date.now() - 29 * 86400000)));
  const days: ({ day: string; label: string } & T)[] = [];
  for (let k = 0; k < 30; k++) { const d = new Date(since.getTime() + k * 86400000 + 3600000); days.push({ day: dayKey(d), label: dayLabel(d), ...init() }); }
  return { days, idx: new Map(days.map((d, i) => [d.day, i])) };
};

@Controller()
export class RecordsController {
  constructor(private prisma: PrismaService) {}

  async adminNames() {
    const a = await this.prisma.adminUser.findMany({ select: { id: true, name: true } });
    return new Map(a.map((x) => [x.id, x.name]));
  }
  async deviceIds() {
    const d = await this.prisma.device.findMany({ select: { label: true, publicId: true } });
    return new Map(d.map((x) => [x.label, x.publicId]));
  }

  /** Generic list for nav children. kind = "users.active", "reports.new", ... Supports lga/status/group/category/period/from/to filters. */
  @Get('records/:kind')
  async list(@Param('kind') kind: string, @Query() q: Q) {
    const take = Math.min(Math.max(Number(q.take) || 500, 1), 10000);
    const p = this.prisma;
    let created: { gte?: Date; lt?: Date } | undefined;
    try { created = rangeFor(q.period, q.from, q.to); } catch { throw new BadRequestException('Dates must be YYYY-MM-DD'); }
    const common = { ...(q.lga && q.lga !== 'All' ? { lga: q.lga } : {}), ...(created ? { createdAt: created } : {}) };

    const users = async (status?: string) => {
      const where: Prisma.UserWhereInput = { ...common, ...(status ? { status } : q.status && q.status !== 'All' ? { status: q.status } : {}) };
      const [rows, total, dev] = await Promise.all([p.user.findMany({ where, take, orderBy: { createdAt: 'desc' } }), p.user.count({ where }), this.deviceIds()]);
      return { columns: USER_COLS, total, rows: rows.map((u) => userRow(u, dev)) };
    };
    const agents = async (where: Prisma.AgentWhereInput) => {
      const groupF: Prisma.AgentWhereInput = q.group ? (q.group === 'none' ? { groupId: null } : { group: { publicId: q.group } }) : {};
      const w = { ...common, ...groupF, ...where };
      const [rows, total] = await Promise.all([p.agent.findMany({ where: w, take, orderBy: { createdAt: 'desc' }, include: { group: true } }), p.agent.count({ where: w })]);
      return { columns: AGENT_COLS, total, rows: rows.map(agentRow) };
    };
    const src = normSource(q.source);
    const incidents = async (status: string[] | null, extra: Prisma.IncidentWhereInput = {}) => {
      const where: Prisma.IncidentWhereInput = { ...common, ...(src ? { source: src } : {}), ...extra, ...(status ? { status: { in: status } } : q.status && q.status !== 'All' ? { status: { in: q.status.split(',') } } : {}), ...(q.category && q.category !== 'All' ? { category: q.category } : {}), ...(q.dispatched === '1' ? { dispatches: { some: {} } } : {}) };
      const [rows, total] = await Promise.all([p.incident.findMany({ where, take, orderBy: { createdAt: 'desc' }, include: { reporter: true, agentReporter: true } }), p.incident.count({ where })]);
      return { columns: INC_COLS, total, rows: rows.map(incidentRow) };
    };
    const alarms = async (where: Prisma.AlarmWhereInput) => {
      const w = { ...(created ? { createdAt: created } : {}), ...(q.lga && q.lga !== 'All' ? { lga: q.lga } : {}), ...where };
      const [rows, total] = await Promise.all([p.alarm.findMany({ where: w, take, orderBy: { createdAt: 'desc' }, include: { user: true } }), p.alarm.count({ where: w })]);
      return { columns: ALARM_COLS, total, rows: rows.map(alarmRow) };
    };

    switch (kind) {
      case 'users.active': return users('active');
      case 'users.suspended': return users('suspended');
      case 'users.pending': return users('pending');
      case 'users.generate': return users();
      case 'users.devices': {
        const [devs, ug, ag] = await Promise.all([p.device.findMany({ orderBy: { label: 'asc' } }), p.user.groupBy({ by: ['device'], _count: true }), p.agent.groupBy({ by: ['device'], _count: true })]);
        const um = new Map(ug.map((g) => [g.device, g._count])); const am = new Map(ag.map((g) => [g.device, g._count]));
        const rows = devs.map((d) => ({ _id: d.publicId, label: d.label, os: d.os || d.label.split('·')[0].trim(), users: um.get(d.label) || 0, agents: am.get(d.label) || 0, date: fmt(d.createdAt), _ts: d.createdAt }))
          .sort((a, b) => (b.users + b.agents) - (a.users + a.agents));
        return { columns: DEVICE_COLS, total: rows.length, rows };
      }
      case 'agents.active': return agents({ status: 'active' });
      case 'agents.suspended': return agents({ status: 'suspended' });
      case 'agents.unassigned': return agents({ groupId: null });
      case 'agents.new': return agents({});
      case 'agents.map': return agents({ status: 'active' });
      case 'agents.online': return agents({ status: 'active', lastSeenAt: { gte: new Date(Date.now() - ONLINE_MS()) } });
      case 'agents.all': return agents({});
      case 'agents.groups': {
        const [gs, act] = await Promise.all([p.homelandGroup.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { agents: true } } } }), p.agent.groupBy({ by: ['groupId'], where: { status: 'active' }, _count: true })]);
        const am = new Map(act.map((a) => [a.groupId, a._count]));
        return { columns: GROUP_COLS, total: gs.length, rows: gs.map((g) => groupRow({ ...g, activeAgents: am.get(g.id) || 0 })) };
      }
      case 'agents.admins': {
        const rows = await p.adminUser.findMany({ orderBy: { createdAt: 'asc' }, include: { group: true } });
        return { columns: ADMIN_COLS, total: rows.length, rows: rows.map(adminRow) };
      }
      case 'reports.new': return incidents(['new']);
      case 'reports.dispatched': return incidents(['dispatched']);
      case 'reports.acted': return incidents(['acted']);
      case 'reports.resolved': return incidents(['resolved', 'fake']);
      case 'reports.map': return incidents(ACTIVE_INC);
      case 'reports.all': case 'reports.analytics': return incidents(null);
      case 'reports.users': case 'reports.agents': case 'reports.call-centre': case 'reports.ecc': return incidents(null, { source: SOURCE_PAGES[kind] });
      case 'agent.reports': {
        const ag = q.agent ? await p.agent.findUnique({ where: { publicId: q.agent } }) : null;
        if (!ag) throw new NotFoundException('Unknown agent');
        const r = await incidents(null, { agentReporterId: ag.id });
        return { ...r, columns: INC_COLS.filter((c) => c.key !== 'reporter') };
      }
      case 'reports.categories': {
        const cs = await p.reportCategory.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { incidents: true } } } });
        return { columns: CAT_COLS, total: cs.length, rows: cs.map(categoryRow) };
      }
      case 'alarms.new': return alarms({ status: 'new' });
      // Duress/Panic lists are the handled history — brand-new alarms live under Alarms → New.
      case 'alarms.duress': case 'alarms.panic': return alarms({ type: kind.slice(7), status: q.status && q.status !== 'All' && q.status !== 'new' ? q.status : { not: 'new' } });
      case 'alarms.all': return alarms({ ...(q.type ? { type: q.type } : {}), ...(q.status && q.status !== 'All' ? { status: q.status } : {}) });
      case 'agent.incidents': {
        const ag = q.agent ? await p.agent.findUnique({ where: { publicId: q.agent } }) : null;
        if (!ag) throw new NotFoundException('Unknown agent');
        const st = TASK_FILTER[q.state || 'all'];
        const where: Prisma.AgentTaskWhereInput = { agentId: ag.id, ...(st ? { status: { in: st } } : {}), ...(created ? { createdAt: created } : {}) };
        const [ts, total] = await Promise.all([p.agentTask.findMany({ where, take, orderBy: { createdAt: 'desc' }, include: { incident: { include: { reporter: true, agentReporter: true } } } }), p.agentTask.count({ where })]);
        return { columns: TASK_COLS, total, rows: ts.map(taskRow) };
      }
      case 'user.incidents': case 'user.alarms': {
        const u = q.user ? await p.user.findUnique({ where: { publicId: q.user } }) : null;
        if (!u) throw new NotFoundException('Unknown user');
        if (kind === 'user.incidents') {
          const where: Prisma.IncidentWhereInput = { reporterId: u.id, ...(q.status && q.status !== 'All' ? { status: { in: q.status.split(',') } } : {}) };
          const [rows, total] = await Promise.all([p.incident.findMany({ where, take, orderBy: { createdAt: 'desc' }, include: { reporter: true, agentReporter: true } }), p.incident.count({ where })]);
          return { columns: INC_COLS.filter((c) => c.key !== 'reporter'), total, rows: rows.map(incidentRow) };
        }
        return alarms({ userId: u.id, ...(q.type ? { type: q.type } : {}) });
      }
      case 'tips.alerts': case 'tips.send': {
        const where = created ? { createdAt: created } : {};
        const [rows, total] = await Promise.all([p.securityAlert.findMany({ where, take, orderBy: { createdAt: 'desc' } }), p.securityAlert.count({ where })]);
        return { columns: ALERT_COLS, total, rows: rows.map(alertRow) };
      }
      case 'audit.log': {
        const where: Prisma.AuditLogWhereInput = { ...(created ? { createdAt: created } : {}), ...(q.action ? { action: { startsWith: q.action } } : {}), ...(q.actor ? { actorEmail: q.actor } : {}) };
        const [rows, total, names] = await Promise.all([p.auditLog.findMany({ where, take, orderBy: { createdAt: 'desc' } }), p.auditLog.count({ where }), this.adminNames()]);
        return { columns: AUDIT_COLS, total, rows: rows.map((l) => auditRow(l, names)) };
      }
      default: throw new NotFoundException(`Unknown list ${kind}`);
    }
  }

  /** Opaque entity lookup for /e/<publicId>. */
  @Get('entity/:id')
  async entity(@Param('id') id: string) {
    const p = this.prisma;
    const names = await this.adminNames();
    const timeline = async () => (await p.auditLog.findMany({ where: { entityId: id }, orderBy: { createdAt: 'desc' }, take: 50 })).map((l) => auditRow(l, names));
    const devIds = await this.deviceIds();

    const u = await p.user.findUnique({ where: { publicId: id }, include: { incidents: { orderBy: { createdAt: 'desc' }, include: { reporter: true, agentReporter: true } }, alarms: { orderBy: { createdAt: 'desc' } } } });
    if (u) {
      // 30-day engagement strip (reports + alarms per Lagos day) — click a day for the full picture.
      const { days, idx } = thirtyDays(() => ({ reports: 0, alarms: 0 }));
      u.incidents.forEach((i) => { const k = idx.get(dayKey(i.createdAt)); if (k !== undefined) days[k].reports++; });
      u.alarms.forEach((a) => { const k = idx.get(dayKey(a.createdAt)); if (k !== undefined) days[k].alarms++; });
      return { type: 'user', tag: 'Users', title: u.name, subtitle: `${u.lga} · ${u.status}`, status: u.status,
        fields: { Phone: u.phone, Email: u.email || '—', LGA: u.lga, Status: u.status, Device: u.device || '—', 'Reg Date': fmt(u.createdAt), 'Last Login': fmt(u.lastLogin), Approved: fmt(u.approvedAt), Incidents: String(u.incidents.length), Alarms: String(u.alarms.length) },
        links: { Device: u.device && devIds.get(u.device) ? `/e/${devIds.get(u.device)}` : undefined, LGA: `/users/generate?lga=${encodeURIComponent(u.lga)}` },
        dates: { 'Reg Date': u.createdAt, 'Last Login': u.lastLogin, Approved: u.approvedAt },
        activity: days, activityKeys: [{ key: 'reports', label: 'reports' }, { key: 'alarms', label: 'alarms' }], raw: { status: u.status, lga: u.lga },
        stats: [
          { label: 'Reports Filed', value: u.incidents.length, accent: '#2563eb', icon: 'doc', tip: 'Every security report this user has filed', drill: { kind: 'user.incidents', query: { user: u.publicId }, title: `Reports by ${u.name}` } },
          { label: 'Open Reports', value: u.incidents.filter((i) => ACTIVE_INC.includes(i.status)).length, accent: '#f59e0b', icon: 'pending', tip: 'Reports still new, dispatched or being acted upon', drill: { kind: 'user.incidents', query: { user: u.publicId, status: ACTIVE_INC.join(',') }, title: `Open reports by ${u.name}` } },
          { label: 'Resolved', value: u.incidents.filter((i) => i.status === 'resolved').length, accent: '#10b981', icon: 'seal', tip: 'Reports closed as resolved', drill: { kind: 'user.incidents', query: { user: u.publicId, status: 'resolved' }, title: `Resolved reports by ${u.name}` } },
          { label: 'Alarms Raised', value: u.alarms.length, accent: '#e11d48', icon: 'siren', tip: 'Panic and duress alarms from this user', drill: { kind: 'user.alarms', query: { user: u.publicId }, title: `Alarms raised by ${u.name}` } },
        ] as Stat[],
        related: [
          { title: 'Incidents Reported', columns: INC_COLS.filter((c) => c.key !== 'reporter'), rows: u.incidents.map(incidentRow), linkKey: 'category' },
          { title: 'Alarms Raised', columns: ALARM_COLS.filter((c) => c.key !== 'sender'), rows: u.alarms.map((a) => alarmRow(a)), linkKey: 'type' },
        ], timeline: await timeline() };
    }
    const a = await p.agent.findUnique({ where: { publicId: id }, include: { group: true, tasks: { orderBy: { createdAt: 'desc' }, include: { incident: { include: { reporter: true, agentReporter: true } } } } } });
    if (a) {
      const { days, idx } = thirtyDays(() => ({ assigned: 0, responded: 0 }));
      a.tasks.forEach((t) => {
        const k = idx.get(dayKey(t.createdAt)); if (k !== undefined) days[k].assigned++;
        const r = t.respondedAt ? idx.get(dayKey(t.respondedAt)) : undefined; if (r !== undefined) days[r].responded++;
      });
      const responded = a.tasks.filter((t) => t.status === 'responded' || t.status === 'completed');
      const open = a.tasks.filter((t) => t.status === 'assigned' || t.status === 'responded');
      const rt = responded.filter((t) => t.respondedAt).map((t) => t.respondedAt!.getTime() - t.createdAt.getTime());
      const avgH = rt.length ? rt.reduce((x, y) => x + y, 0) / rt.length / 3600000 : null;
      const q = (state: string) => ({ agent: a.publicId, state });
      const sent = await p.incident.findMany({ where: { agentReporterId: a.id }, orderBy: { createdAt: 'desc' }, take: 500, include: { reporter: true, agentReporter: true } });
      const sentTotal = await p.incident.count({ where: { agentReporterId: a.id } });
      const stats: Stat[] = [
        { label: 'Sent Reports', value: sentTotal, accent: '#0d9488', icon: 'send', tip: 'Incident reports this agent filed from the field', drill: { kind: 'agent.reports', query: { agent: a.publicId }, title: `Reports sent by ${a.name}` } },
        { label: 'Incidents Assigned', value: a.tasks.length, accent: '#2563eb', icon: 'doc', tip: 'Reports this agent was sent to verify', drill: { kind: 'agent.incidents', query: q('all'), title: `Incidents assigned to ${a.name}` } },
        { label: 'Responded To', value: responded.length, accent: '#10b981', icon: 'checklist', tip: 'Incidents the agent acted on or completed', drill: { kind: 'agent.incidents', query: q('responded'), title: `Incidents ${a.name} responded to` } },
        { label: 'Open Tasks', value: open.length, accent: '#f59e0b', icon: 'pending', tip: 'Assigned or in progress, not yet completed', drill: { kind: 'agent.incidents', query: q('open'), title: `Open tasks for ${a.name}` } },
        { label: 'Avg Response', value: avgH == null ? '—' : avgH < 1 ? `${Math.round(avgH * 60)}m` : `${avgH.toFixed(1)}h`, accent: '#8b5cf6', icon: 'clock', tip: 'Average time from assignment to response', drill: { kind: 'agent.incidents', query: q('responded'), title: `Response times for ${a.name}` } },
      ];
      return { type: 'agent', tag: 'Agents', title: a.name, subtitle: `${a.group?.name || 'Un-assigned'} · ${a.lga}`, status: a.status,
        fields: { 'Government Tag': a.tag || '—', 'First Name': a.firstName || a.name.split(' ')[0], 'Last Name': a.lastName || a.name.split(' ').slice(1).join(' ') || '—', Phone: a.phone, Email: a.email || '—', LGA: a.lga, Group: a.group?.name || 'Un-assigned', Status: a.status, Presence: isOnline(a.lastSeenAt) ? 'online' : 'offline', 'Last Seen': fmt(a.lastSeenAt), Device: a.device || '—', Onboarded: fmt(a.createdAt) },
        links: { Group: a.group ? `/e/${a.group.publicId}` : '/agents/unassigned', Device: a.device && devIds.get(a.device) ? `/e/${devIds.get(a.device)}` : undefined, LGA: `/agents/active?lga=${encodeURIComponent(a.lga)}` },
        dates: { Onboarded: a.createdAt, 'Last Seen': a.lastSeenAt },
        geo: a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng, label: a.name, online: isOnline(a.lastSeenAt) } : null,
        activity: days, activityKeys: [{ key: 'assigned', label: 'assigned' }, { key: 'responded', label: 'responded' }], stats,
        raw: { status: a.status, name: a.name, firstName: a.firstName || a.name.split(' ')[0], lastName: a.lastName || a.name.split(' ').slice(1).join(' '), phone: a.phone, email: a.email, tag: a.tag, lga: a.lga, device: a.device, groupId: a.group?.publicId || null },
        related: [{ title: 'Incidents Responded To', columns: TASK_COLS, rows: a.tasks.slice(0, 500).map(taskRow), linkKey: 'category' },
          ...(sent.length ? [{ title: 'Reports Sent By This Agent', columns: INC_COLS.filter((c) => c.key !== 'reporter'), rows: sent.map(incidentRow), linkKey: 'category' }] : [])],
        timeline: await timeline() };
    }
    const i = await p.incident.findUnique({ where: { publicId: id }, include: { reporter: true, agentReporter: true, categoryRef: true, media: { orderBy: { createdAt: 'desc' } }, dispatches: { orderBy: { createdAt: 'desc' } }, tasks: { orderBy: { createdAt: 'desc' }, include: { agent: { include: { group: true } } } } } });
    if (i) { const rep = reporterOf(i); const vig = i.tasks; const byEmail = new Map((await p.adminUser.findMany({ select: { email: true, name: true } })).map((x) => [x.email, x.name])); const who = (e?: string | null) => (!e || e === 'seed' ? 'System' : byEmail.get(e) || e); return { type: 'incident', tag: 'Reports', title: i.category, subtitle: `${i.lga} · ${i.status}`, status: i.status,
      fields: { 'Report Title': i.aiTitle || localTitle(i.details, i.category), Location: i.location, LGA: i.lga, Status: i.status, Category: i.category, 'Risk Level': i.categoryRef?.riskLevel || '—', Source: SOURCE_LABEL[i.source] || 'User', Reporter: rep.name, 'Agents Sent': vig.length, 'Report Date': fmt(i.createdAt), 'Acted Upon': fmt(i.actedAt), Resolved: fmt(i.resolvedAt), 'Resolved By': i.resolvedBy || '—', Note: i.note || '—' },
      links: { Reporter: rep.href || undefined, Source: `/reports/${{ user: 'users', agent: 'agents', call_centre: 'call-centre', ecc: 'ecc' }[i.source] || 'users'}`, Category: i.categoryRef ? `/e/${i.categoryRef.publicId}` : undefined, LGA: `/reports/analytics?lga=${encodeURIComponent(i.lga)}` },
      dates: { 'Report Date': i.createdAt, 'Acted Upon': i.actedAt, Resolved: i.resolvedAt },
      geo: i.lat != null && i.lng != null ? { lat: i.lat, lng: i.lng, label: i.category } : null,
      media: i.media.map((m) => ({ id: m.publicId, kind: m.kind, url: m.storage === 'local' ? `/api/media/${m.publicId}` : m.url, filename: m.filename, by: m.uploadedBy, date: fmt(m.createdAt), storage: m.storage })),
      raw: { status: i.status, category: i.category, title: i.aiTitle || localTitle(i.details, i.category), details: i.details, location: `${i.location}`, lga: i.lga, date: fmt(i.createdAt), sendAgentCount: i.categoryRef?.sendAgentCount ?? null, agencies: [...new Set(i.dispatches.flatMap((d) => d.agencies))],
        source: i.source, sourceLabel: SOURCE_LABEL[i.source] || 'User', reporter: rep.name, reporterHref: rep.href, aiTitle: i.aiTitle, aiSummary: i.aiSummary, aiAt: i.aiAt ? fmt(i.aiAt) : null, localSummary: localSummary(i.details), hasGeo: i.lat != null },
      related: [
        ...(vig.length ? [{ title: 'Vigilantes Sent', linkKey: 'agent', columns: [{ key: 'agent', label: 'Agent' }, { key: 'phone', label: 'Phone' }, { key: 'group', label: 'Agency / Group' }, { key: 'purpose', label: 'Purpose' }, { key: 'task', label: 'Agent Status' }, { key: 'by', label: 'Sent By' }, { key: 'date', label: 'When' }],
          rows: vig.map((t) => ({ _id: t.agent.publicId, agent: t.agent.name, phone: t.agent.phone, group: t.agent.group?.name || 'Un-assigned', purpose: t.purpose ? t.purpose[0].toUpperCase() + t.purpose.slice(1) : 'Auto (dispatch)', task: TASK_LABEL[t.status] || t.status, by: who(t.assignedBy), note: t.note || '', date: fmt(t.createdAt), _ts: t.createdAt })) }] : []),
        { title: 'Dispatch History', columns: [{ key: 'agencies', label: 'Agencies' }, { key: 'by', label: 'By' }, { key: 'note', label: 'Note' }, { key: 'date', label: 'When' }], rows: i.dispatches.map((d) => ({ agencies: d.agencies.join(', '), by: who(d.byAdmin), note: d.note || '', date: fmt(d.createdAt), _ts: d.createdAt })) }],
      timeline: await timeline() }; }
    const al = await p.alarm.findUnique({ where: { publicId: id }, include: { user: true } });
    if (al) return { type: 'alarm', tag: 'Alarms', title: `${al.type === 'panic' ? 'Panic' : 'Duress'} alarm — ${al.sender}`, subtitle: al.status, status: al.status,
      fields: { Sender: al.sender, Phone: al.phone, Location: al.location || '—', LGA: al.lga || '—', Type: al.type, Status: al.status, 'Alarm Date': fmt(al.createdAt), Resolved: fmt(al.resolvedAt), 'Resolved By': al.resolvedBy || '—' },
      links: { Sender: al.user ? `/e/${al.user.publicId}` : undefined }, dates: { 'Alarm Date': al.createdAt, Resolved: al.resolvedAt },
      geo: al.lat != null && al.lng != null ? { lat: al.lat, lng: al.lng, label: al.sender } : null, raw: { status: al.status, type: al.type }, related: [], timeline: await timeline() };
    const ad = await p.adminUser.findUnique({ where: { publicId: id }, include: { group: true } });
    if (ad) {
      const acts = await p.auditLog.findMany({ where: { actorId: ad.id }, orderBy: { createdAt: 'desc' }, take: 100 });
      return { type: 'admin', tag: 'Admins', title: ad.name, subtitle: `${ad.role} · ${ad.status}`, status: ad.status,
        fields: { Email: ad.email, Phone: ad.phone || '—', Role: ad.role, Status: ad.status, Group: ad.group?.name || '—', 'Last Login': fmt(ad.lastLoginAt), Created: fmt(ad.createdAt) },
        links: { Group: ad.group ? `/e/${ad.group.publicId}` : undefined }, dates: { 'Last Login': ad.lastLoginAt, Created: ad.createdAt },
        raw: { name: ad.name, email: ad.email, phone: ad.phone, role: ad.role, status: ad.status, groupId: ad.group?.publicId || null },
        related: [{ title: 'Recent Actions By This Admin', columns: AUDIT_COLS.filter((c) => c.key !== 'actor'), rows: acts.map((l) => auditRow(l, names)) }], timeline: await timeline() };
    }
    const s = await p.securityAlert.findUnique({ where: { publicId: id } });
    if (s) return { type: 'alert', tag: 'Tips', title: s.title, subtitle: `Sent by ${s.sender}`, status: 'sent', fields: { Alert: s.body, LGA: s.lga, 'User Type': s.userType, Group: s.group, Sender: s.sender, Posted: fmt(s.createdAt) }, links: {}, dates: { Posted: s.createdAt }, raw: {}, related: [], timeline: await timeline() };
    const g = await p.homelandGroup.findUnique({ where: { publicId: id }, include: { agents: { include: { group: true }, orderBy: { name: 'asc' } }, admins: true } });
    if (g) return { type: 'group', tag: 'Groups', title: g.name, subtitle: `${g.agents.length} agents · ${g.status}`, status: g.status,
      fields: { Description: g.description || '—', 'Base LGA': g.lga || '—', Status: g.status, Agents: String(g.agents.length), Active: String(g.agents.filter((x) => x.status === 'active').length), Online: String(g.agents.filter((x) => isOnline(x.lastSeenAt)).length), Created: fmt(g.createdAt) },
      links: {}, dates: { Created: g.createdAt }, raw: { name: g.name, description: g.description, lga: g.lga, status: g.status },
      related: [{ title: 'Agents In This Group', columns: AGENT_COLS, rows: g.agents.map(agentRow), linkKey: 'name', kind: 'group-agents' },
        ...(g.admins.length ? [{ title: 'Group Admins', columns: ADMIN_COLS, rows: g.admins.map(adminRow), linkKey: 'name' }] : [])], timeline: await timeline() };
    const c = await p.reportCategory.findUnique({ where: { publicId: id }, include: { incidents: { orderBy: { createdAt: 'desc' }, take: 500, include: { reporter: true, agentReporter: true } } } });
    if (c) return { type: 'category', tag: 'Categories', title: c.name, subtitle: `Risk ${c.riskLevel} · send ${c.sendAgentCount} agents`, status: c.status,
      fields: { Description: c.description || '—', 'Risk Level': c.riskLevel, 'Agents To Send': String(c.sendAgentCount), Status: c.status, Reports: String(c.incidents.length), Created: fmt(c.createdAt) },
      links: {}, dates: { Created: c.createdAt }, raw: { name: c.name, description: c.description, riskLevel: c.riskLevel, sendAgentCount: c.sendAgentCount, status: c.status },
      related: [{ title: 'Reports In This Category', columns: INC_COLS, rows: c.incidents.map(incidentRow), linkKey: 'category' }], timeline: await timeline() };
    const d = await p.device.findUnique({ where: { publicId: id } });
    if (d) {
      const [us, ags] = await Promise.all([p.user.findMany({ where: { device: d.label }, orderBy: { createdAt: 'desc' } }), p.agent.findMany({ where: { device: d.label }, include: { group: true }, orderBy: { createdAt: 'desc' } })]);
      return { type: 'device', tag: 'Devices', title: d.label, subtitle: `${us.length} users · ${ags.length} agents`, status: 'active',
        fields: { OS: d.os || d.label.split('·')[0].trim(), Model: d.model || d.label.split('·')[1]?.trim() || '—', Users: String(us.length), Agents: String(ags.length), 'First Seen': fmt(d.createdAt) },
        links: {}, dates: { 'First Seen': d.createdAt }, raw: {},
        related: [{ title: 'Users On This Device', columns: USER_COLS.filter((x) => x.key !== 'device'), rows: us.map((x) => userRow(x)), linkKey: 'name' },
          { title: 'Agents On This Device', columns: AGENT_COLS, rows: ags.map(agentRow), linkKey: 'name' }], timeline: [] };
    }
    throw new NotFoundException();
  }

  /** Dashboard. `days` sets the chart period (7/14/30/90); KPI tiles are live pipeline state. */
  @Get('dashboard/summary')
  async summary(@Query('days') daysQ = '14') {
    const nDays = [7, 14, 30, 90].includes(Number(daysQ)) ? Number(daysQ) : 14;
    const p = this.prisma;
    const by = async (model: 'incident' | 'agent' | 'user' | 'alarm', field: string, where: object = {}) =>
      Object.fromEntries((await (p[model] as any).groupBy({ by: [field], where, _count: true })).map((g: any) => [g[field] ?? 'unassigned', g._count]));
    const since = lagosDayStart(dayKey(new Date(Date.now() - (nDays - 1) * 86400000)));
    const [incidents, agents, users, alarms, alarmsNew, unassigned, online] = await Promise.all([
      by('incident', 'status'), by('agent', 'status'), by('user', 'status'), by('alarm', 'type'), by('alarm', 'type', { status: 'new' }),
      p.agent.count({ where: { groupId: null } }), p.agent.count({ where: { status: 'active', lastSeenAt: { gte: new Date(Date.now() - ONLINE_MS()) } } }),
    ]);
    const [recent, recentUsers, recentAlarms] = await Promise.all([
      p.incident.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true, status: true, lga: true } }),
      p.user.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
      p.alarm.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
    ]);
    const days: Record<string, any> = {};
    for (let k = 0; k < nDays; k++) {
      const d = new Date(since.getTime() + k * 86400000 + 3600000);
      days[dayKey(d)] = { day: dayKey(d), label: dayLabel(d), new: 0, dispatched: 0, acted: 0, resolved: 0, fake: 0, signups: 0, alarms: 0 };
    }
    for (const r of recent) { const row = days[dayKey(r.createdAt)]; if (row) row[r.status] = (row[r.status] || 0) + 1; }
    for (const r of recentUsers) { const row = days[dayKey(r.createdAt)]; if (row) row.signups++; }
    for (const r of recentAlarms) { const row = days[dayKey(r.createdAt)]; if (row) row.alarms++; }
    const lgaMap: Record<string, number> = {};
    recent.forEach((r) => (lgaMap[r.lga] = (lgaMap[r.lga] || 0) + 1));
    const lga = Object.entries(lgaMap).map(([l, count]) => ({ lga: l, count })).sort((a, b) => b.count - a.count).slice(0, 8);
    return { days: nDays, incidents, agents: { ...agents, unassigned, online }, users, alarms, alarmsNew, trend: Object.values(days), lga, periodTotal: recent.length, at: new Date().toISOString() };
  }

  /** Per-source incident cards for the Report Sources pages (User / Agent / Call Centre / ECC). */
  @Get('reports/sources')
  async sources(@Query() q: Q) {
    let created: { gte?: Date; lt?: Date } | undefined;
    try { created = rangeFor(q.period, q.from, q.to); } catch { throw new BadRequestException('Dates must be YYYY-MM-DD'); }
    const where: Prisma.IncidentWhereInput = { ...(created ? { createdAt: created } : {}), ...(q.lga && q.lga !== 'All' ? { lga: q.lga } : {}) };
    const g = await this.prisma.incident.groupBy({ by: ['source', 'status'], where, _count: true });
    const today = lagosDayStart(dayKey(new Date()));
    const t = await this.prisma.incident.groupBy({ by: ['source'], where: { ...where, createdAt: { ...(created || {}), gte: created?.gte && created.gte > today ? created.gte : today } }, _count: true });
    return ['user', 'agent', 'call_centre', 'ecc'].map((k) => {
      const st: Record<string, number> = {}; g.filter((x) => x.source === k).forEach((x) => (st[x.status] = x._count));
      return { key: k, label: SOURCE_LABEL[k], page: Object.keys(SOURCE_PAGES).find((p) => SOURCE_PAGES[p] === k), total: Object.values(st).reduce((a, b) => a + b, 0), today: t.find((x) => x.source === k)?._count || 0, byStatus: st };
    });
  }

  /** Everything that happened on one Lagos day (optionally highlighting one entity). */
  @Get('engagement')
  async engagement(@Query('date') date?: string, @Query('entity') entity?: string) {
    if (!date) throw new BadRequestException('date required (YYYY-MM-DD)');
    let r: { gte: Date; lt: Date };
    try { r = lagosDayRange(date); } catch { throw new BadRequestException('date must be YYYY-MM-DD'); }
    const p = this.prisma;
    const [users, agents, incidents, alarms, dispatches, audit, userLogins] = await Promise.all([
      p.user.findMany({ where: { createdAt: r }, orderBy: { createdAt: 'desc' }, take: 200 }),
      p.agent.findMany({ where: { createdAt: r }, include: { group: true }, orderBy: { createdAt: 'desc' }, take: 200 }),
      p.incident.findMany({ where: { createdAt: r }, include: { reporter: true, agentReporter: true }, orderBy: { createdAt: 'desc' }, take: 300 }),
      p.alarm.findMany({ where: { createdAt: r }, include: { user: true }, orderBy: { createdAt: 'desc' }, take: 200 }),
      p.dispatch.count({ where: { createdAt: r } }),
      p.auditLog.findMany({ where: { createdAt: r }, orderBy: { createdAt: 'desc' }, take: 300 }),
      p.user.count({ where: { lastLogin: r } }),
    ]);
    const names = await this.adminNames();
    let focus: { title: string; events: { time: string; text: string; href?: string }[] } | null = null;
    if (entity) {
      const ev: { at: Date; text: string; href?: string }[] = [];
      const u = await p.user.findUnique({ where: { publicId: entity } });
      if (u) {
        if (u.createdAt >= r.gte && u.createdAt < r.lt) ev.push({ at: u.createdAt, text: 'Registered on the app' });
        if (u.lastLogin && u.lastLogin >= r.gte && u.lastLogin < r.lt) ev.push({ at: u.lastLogin, text: 'Last Login' });
        incidents.filter((i) => i.reporterId === u.id).forEach((i) => ev.push({ at: i.createdAt, text: `Reported ${i.category} (${i.status})`, href: `/e/${i.publicId}` }));
        alarms.filter((a) => a.userId === u.id).forEach((a) => ev.push({ at: a.createdAt, text: `Raised a ${a.type} alarm`, href: `/e/${a.publicId}` }));
      }
      const ag = u ? null : await p.agent.findUnique({ where: { publicId: entity } });
      if (ag) {
        const ts = await p.agentTask.findMany({ where: { agentId: ag.id, OR: [{ createdAt: r }, { respondedAt: r }, { completedAt: r }] }, include: { incident: true } });
        const inR = (d: Date | null) => !!d && d >= r.gte && d < r.lt;
        ts.forEach((t) => {
          if (inR(t.createdAt)) ev.push({ at: t.createdAt, text: `Assigned to ${t.incident.category} (${t.incident.lga})`, href: `/e/${t.incident.publicId}` });
          if (inR(t.respondedAt)) ev.push({ at: t.respondedAt!, text: `Responded to ${t.incident.category}`, href: `/e/${t.incident.publicId}` });
          if (inR(t.completedAt) && t.completedAt!.getTime() !== t.respondedAt?.getTime()) ev.push({ at: t.completedAt!, text: `Completed ${t.incident.category}`, href: `/e/${t.incident.publicId}` });
        });
        if (inR(ag.lastSeenAt)) ev.push({ at: ag.lastSeenAt!, text: 'Last seen online' });
      }
      audit.filter((l) => l.entityId === entity).forEach((l) => ev.push({ at: l.createdAt, text: `${l.actorEmail}: ${l.summary}` }));
      ev.sort((a, b) => b.at.getTime() - a.at.getTime());
      focus = { title: u?.name || ag?.name || 'This record', events: ev.map((e) => ({ time: fmt(e.at), text: e.text, href: e.href })) };
    }
    return {
      date, label: longDay(new Date(r.gte.getTime() + 3600000)),
      counts: { users: users.length, agents: agents.length, incidents: incidents.length, alarms: alarms.length, dispatches, userLogins, adminLogins: audit.filter((a) => a.action === 'auth.login').length, actions: audit.length },
      focus,
      lists: {
        users: { columns: USER_COLS.slice(0, 5), rows: users.map((x) => userRow(x)) },
        agents: { columns: AGENT_COLS.slice(0, 5), rows: agents.map(agentRow) },
        incidents: { columns: INC_COLS, rows: incidents.map(incidentRow) },
        alarms: { columns: ALARM_COLS, rows: alarms.map(alarmRow) },
        audit: { columns: AUDIT_COLS, rows: audit.map((l) => auditRow(l, names)) },
      },
    };
  }

  /** Analytics over a date range (defaults to last 30 days). */
  @Get('analytics')
  async analytics(@Query() q: Q) {
    let range: { gte?: Date; lt?: Date } | undefined;
    try { range = rangeFor(q.from || q.to ? null : q.period || 'last_30_days', q.from, q.to); } catch { throw new BadRequestException('Dates must be YYYY-MM-DD'); }
    const where: Prisma.IncidentWhereInput = { ...(range ? { createdAt: range } : {}), ...(q.lga && q.lga !== 'All' ? { lga: q.lga } : {}), ...(q.category && q.category !== 'All' ? { category: q.category } : {}), ...(normSource(q.source) ? { source: normSource(q.source)! } : {}) };
    const p = this.prisma;
    const rows = await p.incident.findMany({ where, select: { createdAt: true, status: true, lga: true, category: true, source: true, resolvedAt: true, dispatches: { select: { agencies: true } } } });
    const alarmWhere: Prisma.AlarmWhereInput = { ...(range ? { createdAt: range } : {}), ...(q.lga && q.lga !== 'All' ? { lga: q.lga } : {}) };
    const [alarmsBy, signups, onboarded] = await Promise.all([
      p.alarm.groupBy({ by: ['type'], where: alarmWhere, _count: true }),
      p.user.count({ where: { ...(range ? { createdAt: range } : {}), ...(q.lga && q.lga !== 'All' ? { lga: q.lga } : {}) } }),
      p.agent.count({ where: { ...(range ? { createdAt: range } : {}), ...(q.lga && q.lga !== 'All' ? { lga: q.lga } : {}) } }),
    ]);
    const tally = (f: (r: (typeof rows)[number]) => string) => { const m: Record<string, number> = {}; rows.forEach((r) => { const k = f(r); m[k] = (m[k] || 0) + 1; }); return Object.entries(m).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count); };
    const agencies: Record<string, number> = {}; rows.forEach((r) => r.dispatches.forEach((d) => d.agencies.forEach((a) => (agencies[a] = (agencies[a] || 0) + 1))));
    const days: Record<string, any> = {};
    const start = range?.gte || (rows.length ? new Date(Math.min(...rows.map((r) => r.createdAt.getTime()))) : new Date());
    const end = range?.lt ? new Date(range.lt.getTime() - 1) : new Date();
    const spanDays = Math.min(Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1, 400);
    for (let k = 0; k < spanDays; k++) { const d = new Date(start.getTime() + k * 86400000 + 3600000); days[dayKey(d)] = { day: dayKey(d), label: dayLabel(d), total: 0, resolved: 0 }; }
    rows.forEach((r) => { const d = days[dayKey(r.createdAt)]; if (d) { d.total++; if (r.status === 'resolved') d.resolved++; } });
    const resolvedRows = rows.filter((r) => r.resolvedAt);
    const avgResolveH = resolvedRows.length ? resolvedRows.reduce((a, r) => a + (r.resolvedAt!.getTime() - r.createdAt.getTime()), 0) / resolvedRows.length / 3600000 : null;
    return {
      from: range?.gte ? dayKey(range.gte) : null, to: range?.lt ? dayKey(new Date(range.lt.getTime() - 1)) : dayKey(new Date()),
      totals: { incidents: rows.length, byStatus: Object.fromEntries(tally((r) => r.status).map((x) => [x.name, x.count])), alarms: Object.fromEntries(alarmsBy.map((a) => [a.type, a._count])), signups, onboarded, dispatched: rows.filter((r) => r.dispatches.length).length, avgResolveHours: avgResolveH && +avgResolveH.toFixed(1) },
      bySource: ['user', 'agent', 'call_centre', 'ecc'].map((k) => { const rs = rows.filter((r) => (r.source || 'user') === k); return { key: k, name: SOURCE_LABEL[k], count: rs.length, open: rs.filter((r) => ACTIVE_INC.includes(r.status)).length, resolved: rs.filter((r) => r.status === 'resolved').length, fake: rs.filter((r) => r.status === 'fake').length }; }),
      byCategory: tally((r) => r.category), byLga: tally((r) => r.lga), byAgency: Object.entries(agencies).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      byDay: Object.values(days), lgas: LGAS, categories: (await p.reportCategory.findMany({ select: { name: true }, orderBy: { name: 'asc' } })).map((c) => c.name),
    };
  }

  @Get('map/agents')
  async mapAgents(@Query('online') online?: string, @Query('group') group?: string, @Query('lga') lga?: string) {
    const rows = await this.prisma.agent.findMany({ where: { status: 'active', lat: { not: null }, ...(online === '1' ? { lastSeenAt: { gte: new Date(Date.now() - ONLINE_MS()) } } : {}), ...(group ? (group === 'none' ? { groupId: null } : { group: { publicId: group } }) : {}), ...(lga ? { lga } : {}) }, include: { group: true } });
    return rows.map((a) => ({ id: a.publicId, name: a.name, phone: a.phone, lga: a.lga, group: a.group?.name || 'Un-assigned', groupId: a.group?.publicId || null, lat: a.lat, lng: a.lng, online: isOnline(a.lastSeenAt), lastSeen: fmt(a.lastSeenAt) }));
  }

  @Get('map/incidents')
  async mapIncidents(@Query('status') status?: string) {
    const st = status && status !== 'active' ? [status] : ACTIVE_INC;
    const [inc, alarms] = await Promise.all([
      this.prisma.incident.findMany({ where: { status: { in: st }, lat: { not: null } }, include: { categoryRef: true }, orderBy: { createdAt: 'desc' }, take: 2000 }),
      this.prisma.alarm.findMany({ where: { status: 'new', lat: { not: null } }, take: 500 }),
    ]);
    return {
      incidents: inc.map((i) => ({ id: i.publicId, category: i.category, lga: i.lga, status: i.status, risk: i.categoryRef?.riskLevel || 'medium', lat: i.lat, lng: i.lng, date: fmt(i.createdAt), details: i.details })),
      alarms: alarms.map((a) => ({ id: a.publicId, type: a.type, sender: a.sender, lat: a.lat, lng: a.lng, date: fmt(a.createdAt) })),
    };
  }

  /** Runtime config for the web app (map tiles etc.) — read at runtime so Coolify env changes need no rebuild. */
  @Get('config')
  config() {
    return {
      map: {
        styleUrl: process.env.MAP_STYLE_URL || null,
        tileUrl: process.env.MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: process.env.MAP_ATTRIBUTION || '© OpenStreetMap contributors',
        center: [7.52, 5.42], zoom: 8.6, lgas: LGA_GEO,
      },
      onlineMinutes: Number(process.env.AGENT_ONLINE_MINUTES || 15),
      lgas: LGAS, tz: 'Africa/Lagos',
    };
  }
}
