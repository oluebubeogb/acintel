import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { AdminCtx, CurrentAdmin } from './auth';
import { Bus } from './realtime';
import { opaqueId } from './util';
import { LGAS } from './geo';
import { PERIODS, dayKey, fmt, periodLabel, rangeFor } from './lagos';
import { Msg, aiConfigured, cleanContent, inlineToolCalls, llm, tidyHistory } from './llm';
import { aiBase } from './llm';
import { aiFlags, aiOn, incidentAiEnvOff } from './ai-flags';
import { agentRow, alarmRow, incidentRow, userRow, AGENT_COLS, ALARM_COLS, INC_COLS, USER_COLS } from './rows';

/**
 * AcIntel Assist — OpenAI-compatible tool calling (RunPod vLLM, OpenAI, Together, Groq, Ollama…).
 * Without OPENAI_BASE_URL/OPENAI_API_KEY it still answers count/list/CSV questions using a local rule-based parser.
 * Runs in the background by default: POST /ai/chat returns immediately; the reply lands via SSE `ai.done`.
 */
type Entity = 'users' | 'agents' | 'incidents' | 'alarms';
export type Filters = { entity: Entity; lga?: string; status?: string; group?: string; category?: string; type?: string; period?: string; from?: string; to?: string };

const TOOL_PARAMS = {
  type: 'object',
  properties: {
    entity: { type: 'string', enum: ['users', 'agents', 'incidents', 'alarms'], description: 'users = general app users; agents = Homeland local agents; incidents = security reports; alarms = panic/duress' },
    lga: { type: 'string', enum: LGAS, description: 'Abia LGA filter' },
    status: { type: 'string', description: 'users: active|pending|suspended; agents: active|suspended; incidents: new|dispatched|acted|resolved|fake; alarms: new|resolved' },
    group: { type: 'string', description: 'Agent group name (e.g. ARTSMA) or "Un-assigned"' },
    category: { type: 'string', description: 'Incident category name' },
    type: { type: 'string', enum: ['panic', 'duress'], description: 'Alarm type' },
    period: { type: 'string', enum: PERIODS, description: 'Date window on created/registered/onboarded date (Africa/Lagos)' },
    from: { type: 'string', description: 'YYYY-MM-DD inclusive' }, to: { type: 'string', description: 'YYYY-MM-DD inclusive' },
  },
  required: ['entity'],
};
const TOOLS = [
  { type: 'function', function: { name: 'count_records', description: 'Count users/agents/incidents/alarms matching filters.', parameters: TOOL_PARAMS } },
  { type: 'function', function: { name: 'list_records', description: 'List up to 15 matching records (newest first) with links.', parameters: TOOL_PARAMS } },
  { type: 'function', function: { name: 'export_csv', description: 'Generate a downloadable CSV of ALL matching records. Use when the user asks for a CSV, export, download or spreadsheet.', parameters: TOOL_PARAMS } },
  { type: 'function', function: { name: 'breakdown', description: 'Group counts by a dimension.', parameters: { ...TOOL_PARAMS, properties: { ...TOOL_PARAMS.properties, by: { type: 'string', enum: ['lga', 'status', 'group', 'category', 'day'] } }, required: ['entity', 'by'] } } },
];

export const toCsv = (cols: { key: string; label: string }[], rows: Record<string, unknown>[]) => {
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
  return [cols.map((c) => esc(c.label)).join(','), ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(','))].join('\n');
};

@Controller('ai')
export class AiController {
  constructor(private prisma: PrismaService, private bus: Bus) {}

  /* ---------- query engine shared by tools + offline parser ---------- */
  private async where(f: Filters): Promise<any> {
    let created: any;
    try { created = rangeFor(f.from || f.to ? null : f.period, f.from, f.to); } catch { created = undefined; }
    const w: any = { ...(created ? { createdAt: created } : {}) };
    if (f.lga && LGAS.includes(f.lga)) w.lga = f.lga;
    if (f.status) w.status = f.status;
    if (f.entity === 'agents' && f.group) {
      if (/^un-?assigned$/i.test(f.group)) w.groupId = null;
      else w.group = { name: { equals: f.group, mode: 'insensitive' } };
    }
    if (f.entity === 'incidents' && f.category) w.category = { equals: f.category, mode: 'insensitive' };
    if (f.entity === 'alarms' && f.type) w.type = f.type;
    return w;
  }
  private model(e: Entity) { return ({ users: this.prisma.user, agents: this.prisma.agent, incidents: this.prisma.incident, alarms: this.prisma.alarm } as any)[e]; }
  private describe(f: Filters) {
    const bits = [f.status, f.type, f.entity === 'incidents' ? 'reports' : f.entity];
    const extra = [f.group && `in ${f.group}`, f.category && `· ${f.category}`, f.lga && `in ${f.lga}`, f.from || f.to ? `from ${f.from || '…'} to ${f.to || 'today'}` : f.period && f.period !== 'all' ? periodLabel(f.period) : null].filter(Boolean);
    return [...bits.filter(Boolean), ...extra].join(' ');
  }
  private async fetchRows(f: Filters, take?: number) {
    const w = await this.where(f);
    const inc = f.entity === 'agents' ? { group: true } : f.entity === 'incidents' ? { reporter: true, agentReporter: true } : f.entity === 'alarms' ? { user: true } : undefined;
    const rows = await this.model(f.entity).findMany({ where: w, orderBy: { createdAt: 'desc' }, take, ...(inc ? { include: inc } : {}) });
    const map = f.entity === 'users' ? (r: any) => userRow(r) : f.entity === 'agents' ? agentRow : f.entity === 'incidents' ? incidentRow : alarmRow;
    const cols = f.entity === 'users' ? USER_COLS : f.entity === 'agents' ? AGENT_COLS : f.entity === 'incidents' ? INC_COLS : ALARM_COLS;
    return { cols, rows: rows.map(map), raw: rows as any[] };
  }

  async runTool(name: string, f0: any, admin: AdminCtx, meta: { exports: any[]; tables: any[] }) {
    const f: Filters = { ...f0, entity: (['users', 'agents', 'incidents', 'alarms'].includes(f0?.entity) ? f0.entity : 'agents') };
    const label = this.describe(f);
    if (name === 'count_records') {
      const n = await this.model(f.entity).count({ where: await this.where(f) });
      return { count: n, description: label };
    }
    if (name === 'list_records') {
      const { cols, rows } = await this.fetchRows(f, 15);
      const total = await this.model(f.entity).count({ where: await this.where(f) });
      meta.tables.push({ title: label, columns: cols.slice(0, 5), rows: rows.map((r: any) => ({ ...Object.fromEntries(cols.slice(0, 5).map((c) => [c.key, r[c.key]])), _id: r._id })), total });
      return { total, shown: rows.length, rows: rows.map((r: any) => ({ name: r.name || r.category || r.sender, lga: r.lga, status: r.status, date: r.regDate || r.date, link: `/e/${r._id}` })) };
    }
    if (name === 'export_csv') {
      const { cols, rows } = await this.fetchRows(f, 50000);
      const fname = `acintel-${label.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || f.entity}-${dayKey(new Date())}.csv`;
      const ex = await this.prisma.aiExport.create({ data: { publicId: opaqueId(), adminId: admin.id, name: fname, csv: toCsv(cols, rows), rowCount: rows.length } });
      meta.exports.push({ id: ex.publicId, name: fname, rows: rows.length, url: `/api/ai/exports/${ex.publicId}` });
      return { exported: rows.length, file: fname, url: `/api/ai/exports/${ex.publicId}`, note: 'The download link is shown to the user automatically.' };
    }
    if (name === 'breakdown') {
      const by = ['lga', 'status', 'group', 'category', 'day'].includes(f0?.by) ? f0.by : 'lga';
      const { rows, raw } = await this.fetchRows(f, 50000);
      const m: Record<string, number> = {};
      const keyOf = (r: any) => by === 'day' ? dayKey(new Date(r.createdAt)) : by === 'group' ? (r.group?.name ?? (f.entity === 'agents' ? 'Un-assigned' : '—')) : by === 'category' ? (r.category ?? r.type ?? '—') : String(r[by] ?? '—');
      raw.forEach((r: any) => { const k = keyOf(r); m[k] = (m[k] || 0) + 1; });
      const out = Object.entries(m).sort((a, b) => (by === 'day' ? a[0].localeCompare(b[0]) : b[1] - a[1])).slice(0, 40);
      meta.tables.push({ title: `${label} by ${by}`, columns: [{ key: 'k', label: by }, { key: 'n', label: 'Count' }], rows: out.map(([k, n]) => ({ k, n })), total: rows.length });
      return { by, total: rows.length, groups: out.map(([k, n]) => ({ [by]: k, count: n })) };
    }
    return { error: `unknown tool ${name}` };
  }

  /* ---------- offline parser (no AI key) ---------- */
  async parse(text: string): Promise<{ tool: string; filters: any } | null> {
    const t = ` ${text.toLowerCase().replace(/[^\w\s-]/g, ' ')} `;
    const has = (...w: string[]) => w.some((x) => t.includes(` ${x} `) || t.includes(` ${x}s `));
    let entity: Entity | null = has('agent', 'local agent', 'artsma') ? 'agents' : has('incident', 'report', 'case') ? 'incidents' : has('alarm', 'panic', 'duress', 'sos') ? 'alarms' : has('user', 'signup', 'sign-up', 'registration', 'member') ? 'users' : null;
    const lga = [...LGAS].sort((a, b) => b.length - a.length).find((l) => t.includes(` ${l.toLowerCase()} `) || t.includes(` ${l.toLowerCase().replace(/ /g, '')} `));
    const [groups, cats] = await Promise.all([this.prisma.homelandGroup.findMany({ select: { name: true } }), this.prisma.reportCategory.findMany({ select: { name: true } })]);
    const group = groups.map((g) => g.name).sort((a, b) => b.length - a.length).find((g) => t.includes(` ${g.toLowerCase()} `)) || (has('unassigned', 'un-assigned') ? 'Un-assigned' : undefined);
    const category = cats.map((c) => c.name).sort((a, b) => b.length - a.length).find((c) => t.includes(` ${c.toLowerCase()} `));
    if (!entity && group) entity = 'agents';
    if (!entity && category) entity = 'incidents';
    if (!entity) return null;
    const statuses: Record<Entity, string[]> = { users: ['active', 'pending', 'suspended'], agents: ['active', 'suspended'], incidents: ['new', 'dispatched', 'acted', 'resolved', 'fake'], alarms: ['new', 'resolved'] };
    let status = statuses[entity].find((s) => has(s));
    if (!status && entity === 'incidents' && t.includes(' acted upon ')) status = 'acted';
    const type = entity === 'alarms' ? (has('panic') ? 'panic' : has('duress') ? 'duress' : undefined) : undefined;
    const period = t.includes(' today ') ? 'today' : t.includes(' yesterday ') ? 'yesterday' : t.includes(' this week ') ? 'this_week' : /(last|past) (7 days|week)/.test(t) ? 'last_7_days'
      : t.includes(' this month ') ? 'this_month' : /(last|past) (30 days|month)/.test(t) ? 'last_30_days' : /(last|past) (90 days|3 months|quarter)/.test(t) ? 'last_90_days' : t.includes(' this year ') ? 'this_year' : undefined;
    const by = / (by|per|breakdown|each) (lga|local government)/.test(t) ? 'lga' : / (by|per) status/.test(t) ? 'status' : / (by|per) group/.test(t) ? 'group' : / (by|per) category/.test(t) ? 'category' : / (by|per) day|daily/.test(t) ? 'day' : null;
    const tool = has('csv', 'export', 'download', 'spreadsheet', 'excel') ? 'export_csv' : by ? 'breakdown' : has('list', 'show', 'who', 'which', 'names') ? 'list_records' : 'count_records';
    return { tool, filters: { entity, lga, status, group: entity === 'agents' ? group : undefined, category: entity === 'incidents' ? category : undefined, type, period, by } };
  }

  /** Plain-language summary of a tool result (used offline and when a model replies with tool calls only). */
  private sayTool(tool: string, f: any, r: any): string {
    const label = this.describe({ entity: 'agents', ...f });
    if (!r || r.error) return '';
    if (tool === 'count_records') return `**${Number(r.count).toLocaleString()}** ${label}.`;
    if (tool === 'list_records') return r.total ? `Found **${r.total.toLocaleString()}** ${label}${r.total > r.shown ? ` — showing the newest ${r.shown}` : ''}.` : `No ${label} found.`;
    if (tool === 'export_csv') return r.exported ? `Your CSV of **${r.exported.toLocaleString()}** ${label} is ready.` : `No ${label} found — the CSV is empty.`;
    if (tool === 'breakdown') return `${label} by **${r.by}** (${Number(r.total).toLocaleString()} total):`;
    return '';
  }

  /** Rule-based engine: answers structured questions straight from the database. null = not understood. */
  private async engine(text: string, admin: AdminCtx, meta: any): Promise<{ text: string; tool: string; filters: any; result: any } | null> {
    const p = await this.parse(text);
    if (!p) return null;
    const r: any = await this.runTool(p.tool, p.filters, admin, meta);
    meta.tools.push(p.tool);
    return { text: this.sayTool(p.tool, p.filters, r), tool: p.tool, filters: p.filters, result: r };
  }

  private tips() {
    return `I can answer questions about **users, agents, reports and alarms**. Try:\n• "How many Umuahia North agents were onboarded this week?"\n• "List pending users in Aba South"\n• "Export resolved reports this month as CSV"\n• "Panic alarms by LGA last 30 days"`;
  }

  /* ---------- core turn ---------- */
  async answer(sessionId: string, admin: AdminCtx): Promise<{ content: string; meta: any; stub: boolean }> {
    const meta = { exports: [] as any[], tables: [] as any[], tools: [] as string[] };
    const history = await this.prisma.aiMessage.findMany({ where: { sessionId, status: 'done' }, orderBy: { createdAt: 'desc' }, take: 30 });
    history.reverse();
    const last = [...history].reverse().find((m) => m.role === 'user')?.content || '';

    if (!(await aiOn(this.prisma, 'aiChat'))) {
      // Paused in Settings → AI: never call the provider; the built-in query engine still answers simple questions.
      const e = await this.engine(last, admin, meta);
      (meta as any).paused = true;
      return { content: e?.text || 'AI chat is paused in Settings → AI. I can still answer simple count, list and CSV questions offline — e.g. “How many new reports today?” or “Export active agents in Aba North as CSV”.', meta, stub: true };
    }
    if (!aiConfigured()) {
      const e = await this.engine(last, admin, meta);
      return { content: e?.text || this.tips(), meta, stub: true };
    }

    const [groups, cats] = await Promise.all([this.prisma.homelandGroup.findMany({ select: { name: true } }), this.prisma.reportCategory.findMany({ select: { name: true } })]);
    const system = `You are AcIntel Assist for the Abia State Control Room (Abia Homeland Security). Today is ${fmt(new Date())} (Africa/Lagos). ` +
      `Always use tools to answer questions about numbers, lists or exports — never invent figures. "Onboarded"/"registered"/"joined" = created date. ` +
      `"This week" = this_week (Monday start). Agent groups: ${groups.map((g) => g.name).join(', ')}. Incident categories: ${cats.map((c) => c.name).join(', ')}. ` +
      `When you create a CSV, say it's ready; the link is rendered automatically. Be concise and operational; use **bold** for key numbers.`;
    const msgs: Msg[] = [{ role: 'system', content: system }, ...tidyHistory(history)];
    const known = TOOLS.map((t) => t.function.name);
    const results: { tool: string; args: any; out: any }[] = [];
    const synth = () => results.map((r) => this.sayTool(r.tool, r.args, r.out)).filter(Boolean).join('\n\n');

    /** Provider failed: get the data ourselves, then let the model phrase it without tools (or phrase it ourselves). */
    const recover = async (why: string) => {
      console.warn(`[AI] recovering without tools: ${why}`);
      if (results.length) return synth() || 'Done.';
      const e = await this.engine(last, admin, meta);
      const plain = await llm([...msgs.filter((m) => m.role !== 'tool' && !m.tool_calls),
        ...(e ? [{ role: 'user', content: `Database result for my last question (already computed — do not call tools): ${JSON.stringify(e.result).slice(0, 6000)}. Answer my question concisely using these exact numbers.` }] : [])]);
      const text = plain?.ok ? cleanContent(plain.message.content) : '';
      if (text) return text;
      if (e?.text) return e.text;
      console.warn(`[AI] no answer possible: ${plain && !plain.ok ? plain.error : 'empty content'}`);
      return `I couldn't get an answer from the AI model just now — please try again in a moment.`;
    };

    for (let round = 0; round < 5; round++) {
      const r = await llm(msgs, TOOLS);
      if (!r) return { content: await recover('not configured'), meta, stub: true };
      if (!r.ok) return { content: await recover(r.error), meta, stub: false };
      const m = r.message;
      let content = cleanContent(m.content);
      let calls = m.tool_calls || [];
      if (!calls.length && content) { const ic = inlineToolCalls(content, known); if (ic.calls.length) { calls = ic.calls; content = ic.rest; } }
      if (!calls.length) {
        if (content) return { content, meta, stub: false };
        // Empty reply: phrase tool results ourselves, or retry once without tools, then fall back to the engine.
        if (results.length) return { content: synth() || 'Done.', meta, stub: false };
        return { content: await recover('empty reply'), meta, stub: false };
      }
      msgs.push({ role: 'assistant', content: content || null, tool_calls: calls.map((c: any, i: number) => ({ id: c.id || `call_${round}_${i}`, type: 'function', function: { name: c.function?.name, arguments: typeof c.function?.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function?.arguments || {}) } })) });
      for (const tc of msgs[msgs.length - 1].tool_calls!) {
        let args: any = {}; try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { /* */ }
        meta.tools.push(tc.function?.name);
        const out = await this.runTool(tc.function?.name, args, admin, meta).catch((e) => ({ error: String(e?.message || e) }));
        results.push({ tool: tc.function?.name, args, out });
        msgs.push({ role: 'tool', tool_call_id: tc.id, name: tc.function?.name, content: JSON.stringify(out).slice(0, 12000) });
      }
    }
    return { content: synth() || 'I ran out of tool steps for this question — try narrowing it down.', meta, stub: false };
  }

  @Get('status')
  async status() {
    const flags = await aiFlags(this.prisma);
    const configured = aiConfigured();
    const on = (k: 'aiIncidentText' | 'aiChat' | 'aiRegenerate') => flags.aiEnabled && flags[k];
    return {
      configured, model: process.env.OPENAI_MODEL || 'gpt-4o-mini', base: aiBase(), tools: TOOLS.map((t) => t.function.name), background: true,
      flags,
      // Running = switched on AND a provider is configured (and, for the worker, not hard-disabled by INCIDENT_AI=false).
      features: {
        aiIncidentText: { on: on('aiIncidentText'), envOff: incidentAiEnvOff(), running: configured && on('aiIncidentText') && !incidentAiEnvOff() },
        aiChat: { on: on('aiChat'), running: configured && on('aiChat') },
        aiRegenerate: { on: on('aiRegenerate'), running: configured && on('aiRegenerate') },
      },
    };
  }

  @Get('sessions')
  sessions(@CurrentAdmin() admin: AdminCtx) {
    return this.prisma.aiSession.findMany({ where: { adminId: admin.id }, orderBy: { updatedAt: 'desc' }, take: 50, select: { id: true, title: true, updatedAt: true } });
  }
  @Get('sessions/:id')
  async session(@CurrentAdmin() admin: AdminCtx, @Param('id') id: string) {
    const s = await this.prisma.aiSession.findFirst({ where: { id, adminId: admin.id }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    if (!s) throw new NotFoundException();
    return s;
  }
  @Get('messages/:id')
  async message(@CurrentAdmin() admin: AdminCtx, @Param('id') id: string) {
    const m = await this.prisma.aiMessage.findFirst({ where: { id, session: { adminId: admin.id } } });
    if (!m) throw new NotFoundException();
    return m;
  }
  @Get('exports/:id')
  async export(@CurrentAdmin() admin: AdminCtx, @Param('id') id: string, @Res() res: Response) {
    const ex = await this.prisma.aiExport.findFirst({ where: { publicId: id, adminId: admin.id } });
    if (!ex) throw new NotFoundException();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${ex.name}"`);
    res.send('\uFEFF' + ex.csv);
  }

  /** body: { sessionId?, message, background? = true } */
  @Post('chat') @HttpCode(200)
  async chat(@CurrentAdmin() admin: AdminCtx, @Body() b: { sessionId?: string; message?: string; background?: boolean }) {
    const message = (b.message || '').trim().slice(0, 4000);
    if (!message) throw new BadRequestException('message required');
    let session = b.sessionId ? await this.prisma.aiSession.findFirst({ where: { id: b.sessionId, adminId: admin.id } }) : null;
    if (!session) session = await this.prisma.aiSession.create({ data: { adminId: admin.id, title: message.slice(0, 60) } });
    await this.prisma.aiMessage.create({ data: { sessionId: session.id, role: 'user', content: message } });
    const pending = await this.prisma.aiMessage.create({ data: { sessionId: session.id, role: 'assistant', content: '', status: 'pending' } });
    const sid = session.id;
    const work = async () => {
      try {
        const r = await this.answer(sid, admin);
        await this.prisma.aiMessage.update({ where: { id: pending.id }, data: { content: r.content, status: 'done', meta: { ...r.meta, stub: r.stub } as Prisma.InputJsonValue } });
        return r;
      } catch (e: any) {
        console.warn(`[AI] turn failed: ${e?.message || e}`);
        const content = `I couldn't get an answer just now — please try again in a moment.`;
        await this.prisma.aiMessage.update({ where: { id: pending.id }, data: { content, status: 'error' } });
        return { content, meta: {}, stub: false };
      } finally {
        await this.prisma.aiSession.update({ where: { id: sid }, data: { updatedAt: new Date() } }).catch(() => undefined);
        this.bus.publish({ type: 'ai.done', adminId: admin.id, sessionId: sid, messageId: pending.id });
      }
    };
    if (b.background === false) { const r = await work(); return { sessionId: sid, messageId: pending.id, reply: r.content, meta: r.meta, stub: r.stub, pending: false }; }
    void work();
    return { sessionId: sid, messageId: pending.id, pending: true };
  }
}
