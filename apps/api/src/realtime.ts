import { Controller, Get, Injectable, Logger, OnModuleDestroy, OnModuleInit, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { EventEmitter } from 'events';
import Redis from 'ioredis';
import { PrismaService } from './prisma.service';
import type { AdminCtx } from './auth';

export type BusEvent =
  | { type: 'notification'; target: string; kind: string; title: string; href?: string | null }
  | { type: 'changed'; keys: string[]; id?: string }
  | { type: 'counts'; data?: unknown }
  | { type: 'ai.done'; adminId: string; sessionId: string; messageId: string };

const CHANNEL = 'acintel:events';

/**
 * Realtime bus. With REDIS_URL it publishes over Redis pub/sub so every API replica
 * fans events out to its SSE clients. Without Redis (or if it drops) it degrades to
 * an in-process emitter so a single instance still works.
 */
@Injectable()
export class Bus implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('Bus');
  private local = new EventEmitter();
  pub?: Redis;
  private sub?: Redis;
  redisReady = false;

  constructor() { this.local.setMaxListeners(0); }

  onModuleInit() {
    const url = process.env.REDIS_URL;
    if (!url) { this.log.warn('REDIS_URL not set — realtime uses in-process fallback'); return; }
    const opts = { lazyConnect: false, maxRetriesPerRequest: 1, enableOfflineQueue: false, retryStrategy: (n: number) => Math.min(n * 500, 5000) };
    this.pub = new Redis(url, opts);
    this.sub = new Redis(url, opts);
    this.pub.on('ready', () => { this.redisReady = true; this.log.log('Redis connected — realtime over pub/sub'); });
    this.pub.on('end', () => { this.redisReady = false; });
    this.pub.on('error', (e) => { if (this.redisReady) this.log.warn(`Redis error: ${e.message} — falling back to in-process`); this.redisReady = false; });
    this.sub.on('error', () => undefined);
    this.sub.on('ready', () => this.sub!.subscribe(CHANNEL).catch(() => undefined));
    this.sub.on('message', (_c, msg) => { try { this.local.emit('evt', JSON.parse(msg)); } catch { /* ignore */ } });
  }
  async onModuleDestroy() { this.pub?.disconnect(); this.sub?.disconnect(); }

  publish(evt: BusEvent) {
    if (this.redisReady && this.pub) this.pub.publish(CHANNEL, JSON.stringify(evt)).catch(() => this.local.emit('evt', evt));
    else this.local.emit('evt', evt);
  }
  on(fn: (e: BusEvent) => void) { this.local.on('evt', fn); return () => this.local.off('evt', fn); }
  get mode() { return this.redisReady ? 'redis' : 'memory'; }
}

/**
 * The single lightweight counts payload: nav badges (unread new-ins per target) + dashboard KPI numbers.
 * get() is memoised (COUNTS_CACHE_MS, default 2s) with a shared in-flight promise so concurrent readers never
 * pile up queries; fresh() bypasses the cache and is what write paths push.
 */
@Injectable()
export class Counts {
  private cache: { at: number; p: Promise<any> } | null = null;
  constructor(private prisma: PrismaService) {}
  get() {
    const ttl = Number(process.env.COUNTS_CACHE_MS || 2000);
    if (this.cache && Date.now() - this.cache.at < ttl) return this.cache.p;
    return this.fresh();
  }
  fresh() {
    const p = this.compute().catch((e) => { this.cache = null; throw e; });
    this.cache = { at: Date.now(), p };
    return p;
  }
  private async compute() {
    const onlineSince = new Date(Date.now() - Number(process.env.AGENT_ONLINE_MINUTES || 15) * 60000);
    const [groups, inc, ag, us, al, unassigned, online] = await Promise.all([
      this.prisma.notification.groupBy({ by: ['target'], where: { readAt: null }, _count: true }),
      this.prisma.incident.groupBy({ by: ['status'], _count: true }),
      this.prisma.agent.groupBy({ by: ['status'], _count: true }),
      this.prisma.user.groupBy({ by: ['status'], _count: true }),
      this.prisma.alarm.groupBy({ by: ['type'], where: { status: 'new' }, _count: true }),
      this.prisma.agent.count({ where: { groupId: null } }),
      this.prisma.agent.count({ where: { status: 'active', lastSeenAt: { gte: onlineSince } } }),
    ]);
    const targets: Record<string, number> = {}; const parents: Record<string, number> = {}; let total = 0;
    for (const g of groups) { targets[g.target] = g._count; const p = g.target.split('.')[0]; parents[p] = (parents[p] || 0) + g._count; total += g._count; }
    parents.alerts = total; targets['alerts.feed'] = total; // Alerts feed carries every new-in
    const m = (rows: any[], key: string) => Object.fromEntries(rows.map((r) => [r[key], r._count]));
    const kpi = { incidents: m(inc, 'status'), agents: { ...m(ag, 'status'), unassigned, online }, users: m(us, 'status'), alarmsNew: m(al, 'type') };
    return { targets, parents, total, kpi, at: new Date().toISOString() };
  }
}

/**
 * Audit + notification + realtime fan-out for every write. Any write that calls notify()/clearFor()/changed()
 * schedules ONE debounced (250ms) counts recompute which is pushed to every SSE screen (via Redis to all replicas):
 * push-on-write, no idle polling needed.
 */
@Injectable()
export class Activity {
  private pushT?: NodeJS.Timeout;
  constructor(private prisma: PrismaService, private bus: Bus, private counts: Counts) {}

  pushCounts() {
    if (this.pushT) return;
    this.pushT = setTimeout(() => {
      this.pushT = undefined;
      this.counts.fresh().then((data) => this.bus.publish({ type: 'counts', data })).catch(() => this.bus.publish({ type: 'counts' }));
    }, 250);
  }
  async audit(admin: AdminCtx | null, action: string, entityType: string, entityId: string | null, summary: string, before?: unknown, after?: unknown) {
    return this.prisma.auditLog.create({ data: {
      actorId: admin?.id, actorEmail: admin?.email || 'system', action, entityType, entityId, summary,
      before: (before ?? undefined) as any, after: (after ?? undefined) as any, ip: admin?.ip,
    } });
  }
  async notify(target: string, kind: string, title: string, body?: string | null, href?: string | null) {
    const n = await this.prisma.notification.create({ data: { target, kind, title, body: body || null, href: href || null } });
    this.bus.publish({ type: 'notification', target, kind, title, href });
    this.pushCounts();
    return n;
  }
  /** Clear unread new-in notifications that point at an entity once it is handled. */
  async clearFor(publicId: string) {
    const r = await this.prisma.notification.updateMany({ where: { href: `/e/${publicId}`, readAt: null }, data: { readAt: new Date() } });
    if (r.count) this.pushCounts();
  }
  changed(keys: string[], id?: string) {
    this.bus.publish({ type: 'changed', keys, id });
    if (!(keys.length === 1 && keys[0] === 'agents.map')) this.pushCounts(); // presence heartbeats only move the map
  }
}

@Controller()
export class StreamController {
  constructor(private bus: Bus, private counts: Counts) {}
  /** Server-Sent Events: live badges, Alerts feed, list refresh hints, AI completions. */
  @Get('stream')
  stream(@Req() req: Request & { admin?: AdminCtx }, @Res() res: Response) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(`retry: 5000\nevent: hello\ndata: ${JSON.stringify({ mode: this.bus.mode, at: new Date().toISOString() })}\n\n`);
    this.counts.get().then((c) => !res.writableEnded && res.write(`event: counts\ndata: ${JSON.stringify({ type: 'counts', data: c })}\n\n`)).catch(() => undefined);
    const me = req.admin?.id;
    const off = this.bus.on((e) => {
      if (e.type === 'ai.done' && e.adminId !== me) return;
      res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    });
    const ping = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), 20000);
    req.on('close', () => { clearInterval(ping); off(); });
  }
}
