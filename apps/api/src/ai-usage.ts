/**
 * AI usage log (Settings → AI → Usage): every provider call made through llm() is written here with its feature,
 * admin, tokens (when the provider returns a `usage` block), duration and outcome. Superadmin (settings.site) only.
 */
import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { RequirePerm } from './auth';
import { UsageEvent, setUsageSink } from './llm';
import { dayKey, fmt, rangeFor } from './lagos';

export const FEATURE_LABEL: Record<string, string> = {
  chat: 'Control Room Chat', chat_title: 'Chat Title', incident_text: 'Report Title & Summary', regenerate: 'On-Demand Regenerate', other: 'Other',
};
const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? s.slice(0, n - 1) + '…' : s) : null);

@Injectable()
export class AiUsageService {
  constructor(private prisma: PrismaService) {
    setUsageSink((e) => { void this.record(e); });
  }
  async record(e: UsageEvent) {
    try {
      await this.prisma.aiUsage.create({ data: {
        feature: e.feature || 'other', adminId: e.adminId || null, adminEmail: e.adminEmail || null, model: clip(e.model, 120),
        promptTokens: e.promptTokens ?? null, completionTokens: e.completionTokens ?? null, totalTokens: e.totalTokens ?? null,
        durationMs: Math.max(0, Math.round(e.durationMs || 0)), ok: !!e.ok, error: clip(e.error, 300), ref: clip(e.ref, 80), summary: clip(e.summary, 200),
      } });
    } catch (err: any) { console.warn('[ai-usage] not recorded:', err?.message || err); }
  }
}

const n = (v: number | null | undefined) => v ?? 0;
const dur = (ms: number) => (ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`);

@Controller('ai/usage')
export class AiUsageController {
  constructor(private prisma: PrismaService) {}

  /** ?period=last_7_days | from=YYYY-MM-DD&to=YYYY-MM-DD, feature=, admin=<email>, status=ok|failed */
  @Get() @RequirePerm('settings.site')
  async list(@Query() q: Record<string, string>) {
    const range = rangeFor(q.period || (q.from || q.to ? 'custom' : 'last_7_days'), q.from, q.to);
    const where: Prisma.AiUsageWhereInput = {
      ...(range ? { createdAt: range } : {}),
      ...(q.feature ? { feature: q.feature } : {}),
      ...(q.admin ? (q.admin === 'system' ? { adminEmail: null } : { adminEmail: q.admin }) : {}),
      ...(q.status === 'ok' ? { ok: true } : q.status === 'failed' ? { ok: false } : {}),
    };
    const take = Math.min(10000, Math.max(1, Number(q.take) || 2000));
    const [items, total, agg, admins] = await Promise.all([
      this.prisma.aiUsage.findMany({ where, orderBy: { createdAt: 'desc' }, take }),
      this.prisma.aiUsage.count({ where }),
      this.prisma.aiUsage.aggregate({ where, _sum: { promptTokens: true, completionTokens: true, totalTokens: true, durationMs: true }, _avg: { durationMs: true } }),
      this.prisma.aiUsage.findMany({ where: { adminEmail: { not: null } }, distinct: ['adminEmail'], select: { adminEmail: true }, take: 200 }),
    ]);
    const failed = await this.prisma.aiUsage.count({ where: { ...where, ok: false } });
    const byFeature = await this.prisma.aiUsage.groupBy({ by: ['feature'], where, _count: { _all: true }, _sum: { totalTokens: true, durationMs: true } });
    const days = new Map<string, { calls: number; tokens: number }>();
    for (const i of items) { const k = dayKey(i.createdAt); const d = days.get(k) || { calls: 0, tokens: 0 }; d.calls++; d.tokens += n(i.totalTokens); days.set(k, d); }
    return {
      stats: {
        calls: total, failed, promptTokens: n(agg._sum.promptTokens), completionTokens: n(agg._sum.completionTokens), totalTokens: n(agg._sum.totalTokens),
        durationMs: n(agg._sum.durationMs), avgMs: Math.round(agg._avg.durationMs || 0),
      },
      byFeature: byFeature.map((f) => ({ feature: f.feature, label: FEATURE_LABEL[f.feature] || f.feature, calls: f._count._all, tokens: n(f._sum.totalTokens), durationMs: n(f._sum.durationMs) })).sort((a, b) => b.calls - a.calls),
      byDay: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, ...v })),
      features: Object.entries(FEATURE_LABEL).map(([value, label]) => ({ value, label })),
      admins: admins.map((a) => a.adminEmail!).filter(Boolean).sort(),
      columns: [
        { key: 'time', label: 'Time' }, { key: 'feature', label: 'Feature' }, { key: 'summary', label: 'What Was Done' }, { key: 'admin', label: 'Admin' },
        { key: 'tokens', label: 'Tokens (In / Out / Total)' }, { key: 'duration', label: 'Time Spent' }, { key: 'model', label: 'Model' }, { key: 'status', label: 'Status' },
      ],
      rows: items.map((i) => ({
        _id: i.id, _ts: i.createdAt, time: fmt(i.createdAt), feature: FEATURE_LABEL[i.feature] || i.feature, _feature: i.feature,
        summary: i.summary || '—', admin: i.adminEmail || 'System', _ref: i.ref,
        tokens: i.totalTokens == null ? 'Not Reported' : `${n(i.promptTokens).toLocaleString()} / ${n(i.completionTokens).toLocaleString()} / ${n(i.totalTokens).toLocaleString()}`,
        _tokens: i.totalTokens, duration: dur(i.durationMs), _ms: i.durationMs, model: i.model || '—', status: i.ok ? 'success' : 'failed', _error: i.error,
      })),
      total,
    };
  }
}
