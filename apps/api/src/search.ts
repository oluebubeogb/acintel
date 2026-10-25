import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { fmt } from './lagos';

export const PAGES = [
  ['Dashboard', 'Home', '/', 'overview analytics home kpi'],
  ['Active users', 'Users', '/users/active', 'general user'],
  ['Suspended users', 'Users', '/users/suspended', 'general user'],
  ['Pending users', 'Users', '/users/pending', 'general user signup approve'],
  ['Generate user list', 'Users', '/users/generate', 'export csv filter'],
  ['App devices list', 'Users', '/users/devices', 'android ios phone device'],
  ['Homeland groups', 'Agents', '/agents/groups', 'agent group'],
  ['Homeland admin list', 'Agents', '/agents/admins', 'agent admin staff role'],
  ['Add new local agent', 'Agents', '/agents/new', 'agent onboard create import csv'],
  ['Active local agents', 'Agents', '/agents/active', 'agent'],
  ['Suspended local agents', 'Agents', '/agents/suspended', 'agent'],
  ['Un-assigned local agents', 'Agents', '/agents/unassigned', 'agent unassigned assign'],
  ['View agent location', 'Agents', '/agents/map', 'agent map location online'],
  ['Report categories', 'Reports', '/reports/categories', 'incident category risk'],
  ['Active incident map', 'Reports', '/reports/map', 'incident map'],
  ['New reports', 'Reports', '/reports/new', 'incident dispatch'],
  ['Dispatched reports', 'Reports', '/reports/dispatched', 'incident'],
  ['Acted upon reports', 'Reports', '/reports/acted', 'incident'],
  ['Resolved security reports', 'Reports', '/reports/resolved', 'incident fake'],
  ['Generate analytics', 'Reports', '/reports/analytics', 'incident chart stats export'],
  ['New alarms', 'Alarms', '/alarms/new', 'alarm'],
  ['Duress alarms', 'Alarms', '/alarms/duress', 'alarm'],
  ['Panic alarms', 'Alarms', '/alarms/panic', 'alarm'],
  ['Send alert', 'Tips', '/tips/send', 'security tips broadcast'],
  ['View alerts', 'Tips', '/tips/alerts', 'security tips broadcast'],
  ['Notification feed', 'Alerts', '/alerts', 'alerts notifications activity'],
  ['Audit log', 'System', '/audit', 'audit history actions undo'],
  ['Settings', 'System', '/settings', 'preferences page size roles'],
].map(([title, section, href, keywords]) => ({ title, section, href, keywords }));

/** Must match the GIN trigram expression indexes in migration 20261025090000_phases_1_6 exactly. */
const EXPR = {
  User: `lower(coalesce("name",'') || ' ' || coalesce("phone",'') || ' ' || coalesce("email",'') || ' ' || coalesce("lga",'') || ' ' || coalesce("device",''))`,
  Agent: `lower(coalesce("name",'') || ' ' || coalesce("phone",'') || ' ' || coalesce("email",'') || ' ' || coalesce("lga",''))`,
  Incident: `lower(coalesce("category",'') || ' ' || coalesce("details",'') || ' ' || coalesce("location",'') || ' ' || coalesce("lga",''))`,
  Alarm: `lower(coalesce("sender",'') || ' ' || coalesce("phone",'') || ' ' || coalesce("location",'') || ' ' || coalesce("type",''))`,
  SecurityAlert: `lower(coalesce("title",'') || ' ' || coalesce("body",'') || ' ' || coalesce("lga",''))`,
} as const;
type Tbl = keyof typeof EXPR;
export type Hit = { tag: string; origin: string; label: string; sub: string; href: string; score?: number };

@Controller()
export class SearchController {
  constructor(private prisma: PrismaService) {}

  /** Trigram search: every token must appear (ILIKE uses the GIN index); falls back to fuzzy similarity for typos. Ranked by similarity. */
  private async trigram(tbl: Tbl, tokens: string[], extra = '', limit = 6): Promise<{ id: string; score: number }[]> {
    const e = EXPR[tbl];
    const q = tokens.join(' ');
    const params: unknown[] = [q];
    const likes = tokens.map((t) => { params.push(`%${t.replace(/[%_\\]/g, (m) => '\\' + m)}%`); return `${e} LIKE $${params.length}`; });
    const where = [likes.length ? likes.join(' AND ') : 'TRUE', extra].filter(Boolean).join(' AND ');
    const sql = `SELECT "id", similarity(${e}, $1) AS score FROM "${tbl}" WHERE ${where} ORDER BY score DESC, "createdAt" DESC LIMIT ${limit}`;
    let rows = await this.prisma.$queryRawUnsafe<{ id: string; score: number }[]>(sql, ...params);
    if (!rows.length && q.length >= 3) {
      const fz = `SELECT "id", word_similarity($1, ${e}) AS score FROM "${tbl}" WHERE $1 <% ${e} ${extra ? 'AND ' + extra : ''} ORDER BY score DESC LIMIT ${limit}`;
      rows = await this.prisma.$queryRawUnsafe<{ id: string; score: number }[]>(fz, q).catch(() => []);
    }
    return rows.map((r) => ({ id: r.id, score: Number(r.score) }));
  }

  @Get('search')
  async search(@Query('q') qRaw = '') {
    const q = qRaw.trim().slice(0, 120);
    if (!q) return { q, results: [], groups: [] };
    const tokens0 = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    const hints: Record<string, string> = { user: 'user', users: 'user', agent: 'agent', agents: 'agent', report: 'incident', reports: 'incident', incident: 'incident', incidents: 'incident', alarm: 'alarm', alarms: 'alarm', tip: 'alert', tips: 'alert', alert: 'alert', group: 'group', groups: 'group', category: 'category', device: 'device', admin: 'admin' };
    const statusWords = ['active', 'suspended', 'pending', 'new', 'dispatched', 'acted', 'resolved', 'fake'];
    const typeHint = tokens0.map((t) => hints[t]).find(Boolean);
    const status = tokens0.find((t) => statusWords.includes(t));
    const alarmType = tokens0.find((t) => t === 'panic' || t === 'duress');
    const tokens = tokens0.filter((t) => !hints[t] && !statusWords.includes(t) && t !== 'panic' && t !== 'duress');

    // Pages — prefix match over title + keywords
    const words = (pg: (typeof PAGES)[number]) => (pg.title + ' ' + pg.keywords + ' ' + pg.section).toLowerCase().split(/[\s/·-]+/);
    const hit = (pg: (typeof PAGES)[number], t: string) => words(pg).some((w) => w.startsWith(t));
    const strict = PAGES.filter((pg) => tokens0.every((t) => hit(pg, t)));
    const loose = PAGES.filter((pg) => !strict.includes(pg) && tokens0.some((t) => t.length >= 3 && hit(pg, t)));
    const pages: Hit[] = [...strict, ...loose].slice(0, 6).map((pg) => ({ tag: 'Page', origin: pg.section, label: pg.title, sub: `${pg.section} · page`, href: pg.href }));

    const want = (t: string) => !typeHint || typeHint === t;
    const p = this.prisma;
    const out: Hit[] = [];
    const st = (s?: string) => (s ? `"status" = '${s}'` : '');
    if (tokens.length || status || alarmType) {
      const [u, a, i, al, sa] = await Promise.all([
        want('user') && (!status || ['active', 'suspended', 'pending'].includes(status)) ? this.trigram('User', tokens, st(status)) : [],
        want('agent') && (!status || ['active', 'suspended'].includes(status)) ? this.trigram('Agent', tokens, st(status)) : [],
        want('incident') && (!status || ['new', 'dispatched', 'acted', 'resolved', 'fake'].includes(status)) && !alarmType ? this.trigram('Incident', tokens, st(status), 5) : [],
        want('alarm') && (!status || ['new', 'resolved'].includes(status)) ? this.trigram('Alarm', tokens, [st(status), alarmType ? `"type" = '${alarmType}'` : ''].filter(Boolean).join(' AND '), 5) : [],
        want('alert') && tokens.length && !status ? this.trigram('SecurityAlert', tokens, '', 3) : [],
      ]);
      const score = new Map([...u, ...a, ...i, ...al, ...sa].map((r) => [r.id, r.score]));
      const [users, agents, incs, alarms, alerts] = await Promise.all([
        p.user.findMany({ where: { id: { in: u.map((r) => r.id) } } }),
        p.agent.findMany({ where: { id: { in: a.map((r) => r.id) } }, include: { group: true } }),
        p.incident.findMany({ where: { id: { in: i.map((r) => r.id) } } }),
        p.alarm.findMany({ where: { id: { in: al.map((r) => r.id) } } }),
        p.securityAlert.findMany({ where: { id: { in: sa.map((r) => r.id) } } }),
      ]);
      users.forEach((x) => out.push({ tag: 'User', origin: x.status === 'active' ? 'Active users' : x.status === 'pending' ? 'Pending users' : 'Suspended users', label: x.name, sub: `${x.phone} · ${x.lga}`, href: `/e/${x.publicId}`, score: score.get(x.id) }));
      agents.forEach((x) => out.push({ tag: 'Agent', origin: x.status === 'active' ? 'Active agents' : 'Suspended agents', label: x.name, sub: `${x.group?.name || 'Un-assigned'} · ${x.lga}`, href: `/e/${x.publicId}`, score: score.get(x.id) }));
      incs.forEach((x) => out.push({ tag: 'Report', origin: `${x.status[0].toUpperCase()}${x.status.slice(1)} reports`, label: x.category, sub: `${x.lga} · ${fmt(x.createdAt)}`, href: `/e/${x.publicId}`, score: score.get(x.id) }));
      alarms.forEach((x) => out.push({ tag: x.type === 'panic' ? 'Panic alarm' : 'Duress alarm', origin: x.status === 'new' ? 'New alarms' : `${x.type} alarms`, label: x.sender, sub: `${x.location || x.phone} · ${fmt(x.createdAt)}`, href: `/e/${x.publicId}`, score: score.get(x.id) }));
      alerts.forEach((x) => out.push({ tag: 'Tip', origin: 'Security alerts', label: x.title, sub: `${x.lga} · ${fmt(x.createdAt)}`, href: `/e/${x.publicId}`, score: score.get(x.id) }));
    }
    if (tokens.length) {
      const ci = (f: string) => ({ AND: tokens.map((t) => ({ [f]: { contains: t, mode: 'insensitive' as const } })) });
      const [groups, cats, devices, admins] = await Promise.all([
        want('group') ? p.homelandGroup.findMany({ where: ci('name'), take: 4, include: { _count: { select: { agents: true } } } }) : [],
        want('category') ? p.reportCategory.findMany({ where: ci('name'), take: 4 }) : [],
        want('device') ? p.device.findMany({ where: ci('label'), take: 3 }) : [],
        want('admin') ? p.adminUser.findMany({ where: { OR: [ci('name'), ci('email')] }, take: 3 }) : [],
      ]);
      groups.forEach((g) => out.push({ tag: 'Group', origin: 'Homeland groups', label: g.name, sub: `${g._count.agents} agents`, href: `/e/${g.publicId}`, score: 0.9 }));
      cats.forEach((c) => out.push({ tag: 'Category', origin: 'Report categories', label: c.name, sub: `Risk ${c.riskLevel}`, href: `/e/${c.publicId}`, score: 0.85 }));
      devices.forEach((d) => out.push({ tag: 'Device', origin: 'App devices', label: d.label, sub: 'App device', href: `/e/${d.publicId}`, score: 0.5 }));
      admins.forEach((a) => out.push({ tag: 'Admin', origin: 'Admin list', label: a.name, sub: `${a.email} · ${a.role}`, href: `/e/${a.publicId}`, score: 0.6 }));
    }
    out.sort((a, b) => (b.score || 0) - (a.score || 0));
    const results = [...pages, ...out].slice(0, 30);
    const order: string[] = []; const map: Record<string, Hit[]> = {};
    results.forEach((r) => { const k = r.tag === 'Page' ? 'Pages' : r.tag; if (!map[k]) { map[k] = []; order.push(k); } map[k].push(r); });
    return { q, results, groups: order.map((k) => ({ name: k, items: map[k] })) };
  }
}
