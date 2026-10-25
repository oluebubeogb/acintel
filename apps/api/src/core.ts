import {
  BadRequestException, Body, Controller, Get, HttpCode, Injectable, NotFoundException, OnModuleDestroy,
  OnModuleInit, Param, Post, Put, Query,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AdminCtx, CurrentAdmin, Public, can } from './auth';
import { narrative } from './incident-text';
import { opaqueId } from './util';
import { Activity, Bus, Counts } from './realtime';
import { LGAS, pointIn } from './geo';
import { ForbiddenException } from '@nestjs/common';
import { AI_FLAG_DEFAULTS, AI_FLAG_KEYS, invalidateAiFlags } from './ai-flags';

export const SITE_DEFAULTS: Record<string, unknown> = {
  pageSize: 500,
  pageSizeOptions: [25, 100, 500, 1000],
  pollSeconds: 15, // ONLY used if the SSE push stream is down (clamped 10–120s). With SSE live the web heals every 120s.
  notifyNewUsers: true,
  notifyNewReports: true,
  notifyAlarms: true,
  notifySound: false,
  compactTables: false,
  ...AI_FLAG_DEFAULTS, // Settings → AI: aiEnabled, aiIncidentText, aiChat, aiRegenerate (all on by default)
};

@Controller()
export class HealthController {
  constructor(private prisma: PrismaService, private bus: Bus) {}
  @Public() @Get('health')
  async health() {
    let db = 'ok';
    try { await this.prisma.$queryRaw`SELECT 1`; } catch { db = 'down'; }
    const redis = process.env.REDIS_URL ? (this.bus.redisReady ? 'ok' : 'fallback') : 'disabled';
    return { status: db === 'ok' ? 'ok' : 'degraded', db, redis, realtime: this.bus.mode, service: 'acintel-api', version: '1.6.0', phase: 6, time: new Date().toISOString(), tz: 'Africa/Lagos' };
  }
}

@Controller('prefs')
export class PrefsController {
  constructor(private prisma: PrismaService) {}
  @Get()
  async get(@CurrentAdmin() admin: AdminCtx) {
    const rows = await this.prisma.preference.findMany({ where: { OR: [{ scope: 'site' }, { scope: 'admin', adminId: admin.id }] } });
    const site = { ...SITE_DEFAULTS };
    const mine: Record<string, unknown> = {};
    for (const r of rows) (r.scope === 'site' ? site : mine)[r.key] = r.value as unknown;
    return { site, admin: mine, effective: { ...site, ...mine } };
  }
  /** body: { scope: 'site' | 'admin', values: { key: value } } */
  @Put()
  async set(@CurrentAdmin() admin: AdminCtx, @Body() body: { scope?: string; values?: Record<string, unknown> }) {
    const scope = body.scope === 'admin' ? 'admin' : 'site';
    if (scope === 'site' && !can(admin.role, 'settings.site')) throw new ForbiddenException('Only a superadmin can change site-wide settings');
    const values = body.values || {};
    if ('pageSize' in values) {
      const n = Number(values.pageSize);
      if (!Number.isInteger(n) || n < 1 || n > 10000) throw new BadRequestException('pageSize must be 1–10000');
      values.pageSize = n;
    }
    if ('pollSeconds' in values) {
      const n = Math.round(Number(values.pollSeconds));
      if (!Number.isFinite(n)) throw new BadRequestException('pollSeconds must be a number');
      values.pollSeconds = Math.min(120, Math.max(10, n)); // cap extremes so shared hosting / Coolify proxies are never hammered
    }
    for (const k of AI_FLAG_KEYS) if (k in values) {
      if (scope !== 'site') delete values[k]; // AI switches are site-wide only
      else values[k] = values[k] !== false && values[k] !== 'false';
    }
    for (const [key, value] of Object.entries(values)) {
      const adminId = scope === 'admin' ? admin.id : null;
      const existing = await this.prisma.preference.findFirst({ where: { scope, adminId, key } });
      if (existing) await this.prisma.preference.update({ where: { id: existing.id }, data: { value: value as any } });
      else await this.prisma.preference.create({ data: { scope, adminId, key, value: value as any } });
    }
    if (scope === 'site') invalidateAiFlags();
    return this.get(admin);
  }
}

@Controller()
export class NotificationsController {
  constructor(private prisma: PrismaService, private act: Activity, private counts: Counts) {}

  @Get('notifications')
  async list(@Query('unread') unread?: string, @Query('limit') limit = '100') {
    const items = await this.prisma.notification.findMany({
      where: unread === '1' ? { readAt: null } : {},
      orderBy: { createdAt: 'desc' }, take: Math.min(Number(limit) || 100, 1000),
    });
    return { items, unread: await this.prisma.notification.count({ where: { readAt: null } }) };
  }

  /** body: { ids?: string[], target?: string, all?: boolean } */
  @Post('notifications/read') @HttpCode(200)
  async read(@Body() b: { ids?: string[]; target?: string; all?: boolean }) {
    const where = b.all ? { readAt: null } : b.ids?.length ? { id: { in: b.ids }, readAt: null }
      : b.target ? { target: b.target, readAt: null } : null;
    if (!where) throw new BadRequestException('ids, target or all required');
    const r = await this.prisma.notification.updateMany({ where, data: { readAt: new Date() } });
    if (r.count) this.act.pushCounts();
    return { updated: r.count };
  }

  /** Live counters (badges + KPI numbers) — same payload SSE pushes on every write; this is the rare heal/fallback read. */
  @Get('counts')
  get() { return this.counts.get(); }
}


/**
 * Demo activity simulator so live badges, maps and feeds visibly move in standalone mode.
 * Also heartbeats agent presence. Disable with SIMULATE_ACTIVITY=false (recommended once Phase 7 goes live).
 */
@Injectable()
export class ActivitySimulator implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private hb?: NodeJS.Timeout;
  constructor(private prisma: PrismaService, private act: Activity) {}
  onModuleInit() {
    if (process.env.SIMULATE_ACTIVITY === 'false') return;
    const ms = Number(process.env.SIMULATE_INTERVAL_MS || 45000);
    this.timer = setInterval(() => this.tick().catch((e) => console.warn('sim', e?.message)), ms);
    this.hb = setInterval(() => this.heartbeat().catch(() => undefined), 60000);
    setTimeout(() => this.heartbeat().catch(() => undefined), 3000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); if (this.hb) clearInterval(this.hb); }

  private async heartbeat() {
    const ids = await this.prisma.$queryRaw<{ id: string; lat: number | null; lng: number | null; lga: string }[]>`SELECT "id","lat","lng","lga" FROM "Agent" WHERE "status"='active' ORDER BY random() LIMIT 18`;
    for (const a of ids) {
      const [lat, lng] = a.lat != null && a.lng != null ? [+(a.lat + (Math.random() - 0.5) * 0.004).toFixed(6), +(a.lng + (Math.random() - 0.5) * 0.004).toFixed(6)] : pointIn(a.lga);
      await this.prisma.agent.update({ where: { id: a.id }, data: { lastSeenAt: new Date(), lat, lng } });
    }
    this.act.changed(['agents.map']);
  }

  private async tick() {
    const lgas = ['Umuahia North', 'Aba South', 'Osisioma', 'Isiala Ngwa South', 'Bende', 'Ohafia', 'Arochukwu', 'Aba North', 'Umuahia South'];
    const names = ['Chidi Okeke', 'Ngozi Eze', 'Ikenna Uche', 'Adaeze Nwosu', 'Obinna Kalu', 'Mike Onyema', 'Amaka Obi', 'Uchenna Ibe', 'Chiamaka Ude'];
    const lga = lgas[Math.floor(Math.random() * lgas.length)] || LGAS[0];
    const name = names[Math.floor(Math.random() * names.length)];
    const roll = Math.random();
    if (roll < 0.4) {
      const devices = ['Android 15 · samsung SM-A055F', 'Android 14 · TECNO KI5', 'iOS 17 · iPhone 13', 'Android 13 · itel A70'];
      const device = devices[Math.floor(Math.random() * devices.length)];
      await this.prisma.device.upsert({ where: { label: device }, update: {}, create: { publicId: opaqueId(), label: device, os: device.split('·')[0].trim(), model: device.split('·')[1]?.trim() } });
      const u = await this.prisma.user.create({ data: { publicId: opaqueId(), name, phone: '080' + Math.floor(10000000 + Math.random() * 89999999), lga, status: 'pending', device } });
      await this.act.notify('users.pending', 'signup', `New user signup — ${u.name}`, lga, `/e/${u.publicId}`);
      this.act.changed(['users']);
    } else if (roll < 0.82) {
      const cats = await this.prisma.reportCategory.findMany({ where: { status: 'active' } });
      if (!cats.length) return;
      const cat = cats[Math.floor(Math.random() * cats.length)];
      const sr = Math.random(); const source = sr < 0.62 ? 'user' : sr < 0.84 ? 'agent' : sr < 0.94 ? 'call_centre' : 'ecc';
      const reporter = source === 'user' ? await this.prisma.user.findFirst({ where: { status: 'active', lga }, skip: Math.floor(Math.random() * 5) }) : null;
      const agentRep = source === 'agent' ? await this.prisma.agent.findFirst({ where: { status: 'active', lga }, skip: Math.floor(Math.random() * 3) }) : null;
      const [lat, lng] = pointIn(lga);
      const i = await this.prisma.incident.create({ data: { publicId: opaqueId(), category: cat.name, categoryId: cat.id, details: narrative(cat.name, lga), location: `${lga}, Abia, Nigeria`, lga, lat, lng, reporterId: reporter?.id, source: agentRep || source !== 'agent' ? source : 'user', agentReporterId: agentRep?.id } });
      await this.act.notify('reports.new', 'report', `New report — ${cat.name}`, lga, `/e/${i.publicId}`);
      this.act.changed(['reports']);
    } else {
      const type = Math.random() < 0.5 ? 'panic' : 'duress';
      const u = await this.prisma.user.findFirst({ where: { status: 'active', lga } });
      const [lat, lng] = pointIn(lga);
      const a = await this.prisma.alarm.create({ data: { publicId: opaqueId(), type, sender: u?.name || name, phone: u?.phone || '0906' + Math.floor(1000000 + Math.random() * 8999999), location: `${lga}, Abia, Nigeria`, lga, lat, lng, userId: u?.id } });
      await this.act.notify('alarms.new', 'alarm', `${type === 'panic' ? 'Panic' : 'Duress'} alarm — ${a.sender}`, lga, `/e/${a.publicId}`);
      this.act.changed(['alarms']);
    }
  }
}
