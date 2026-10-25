import {
  BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException,
  Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { memoryStorage } from 'multer';
import { PrismaService } from './prisma.service';
import { AdminCtx, CurrentAdmin, ROLES, RequirePerm } from './auth';
import { Activity } from './realtime';
import { opaqueId } from './util';
import { LGAS, normLga, pointIn } from './geo';
import { StandaloneDataPort } from './dataport';
import { assignAgents, syncTasks } from './tasks';
import { actionLabel } from './rows';

export const AGENCIES = [
  'FRSC', 'AVS', 'NIS', 'ARTSMA ADMIN', 'Military Navy/QRF', 'NDLEA', 'NPF-ABIA', 'ABIA DSS',
  'NSCDC', 'EMS/Fire', 'Homeland-Watch', 'OP CRUSH', 'Joint Security Ops', 'NA-14 BRG',
];
const dataport = new StandaloneDataPort(); // Phase 7 swaps this for the live Homeland handshake.

export function normPhone(v?: string | null): string | null {
  if (!v) return null;
  const d = String(v).replace(/[\s\-()]/g, '');
  const m = /^(?:\+?234|0)?([789][01]\d{8})$/.exec(d);
  return m ? '0' + m[1] : null;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const idList = (b: { ids?: unknown }, single?: string) => {
  const ids = single ? [single] : Array.isArray(b.ids) ? b.ids.map(String) : [];
  if (!ids.length) throw new BadRequestException('Select at least one record');
  if (ids.length > 5000) throw new BadRequestException('Too many records in one action (max 5000)');
  return [...new Set(ids)];
};
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const RISK = ['low', 'medium', 'high', 'critical'];

/* ============================== USERS ============================== */
@Controller('users')
export class UsersOpsController {
  constructor(private prisma: PrismaService, private act: Activity) {}

  /** body: { ids: publicId[], status: active|suspended } — "active" on a pending user = Approve. */
  @Post('status') @HttpCode(200) @RequirePerm('ops')
  bulk(@Body() b: { ids?: string[]; status?: string }, @CurrentAdmin() admin: AdminCtx) { return this.setStatus(idList(b), b.status, admin); }

  @Post(':id/status') @HttpCode(200) @RequirePerm('ops')
  one(@Param('id') id: string, @Body() b: { status?: string }, @CurrentAdmin() admin: AdminCtx) { return this.setStatus([id], b.status, admin); }

  private async setStatus(ids: string[], status: string | undefined, admin: AdminCtx) {
    if (!['active', 'suspended'].includes(status || '')) throw new BadRequestException('status must be active or suspended');
    const users = await this.prisma.user.findMany({ where: { publicId: { in: ids } } });
    if (!users.length) throw new NotFoundException('No matching users');
    const auditIds: string[] = [];
    let changed = 0;
    for (const u of users) {
      if (u.status === status) continue;
      const verb = status === 'suspended' ? 'suspend' : u.status === 'pending' ? 'approve' : 'activate';
      await this.prisma.user.update({ where: { id: u.id }, data: { status, ...(verb === 'approve' ? { approvedAt: new Date() } : {}) } });
      const log = await this.act.audit(admin, `user.${verb}`, 'user', u.publicId, `${verb[0].toUpperCase()}${verb.slice(1)}d user ${u.name} (${u.lga})`, { status: u.status, approvedAt: u.approvedAt }, { status });
      auditIds.push(log.id); changed++;
      if (verb === 'approve') await this.act.clearFor(u.publicId);
    }
    this.act.changed(['users']);
    return { ok: true, changed, skipped: users.length - changed, undo: auditIds };
  }
}

/* ============================== AGENTS ============================== */
type AgentBody = { tag?: string; firstName?: string; lastName?: string; name?: string; phone?: string; email?: string; lga?: string; groupId?: string | null; status?: string };
export const TAG_RE = /^[A-Za-z0-9][A-Za-z0-9\/\-]{2,39}$/;
export const normTag = (v: unknown) => str(v, 40).toUpperCase().replace(/\s+/g, '');
/** "Ngozi Ada Eze" → first "Ngozi", last "Ada Eze" (legacy single-name input). */
export const splitName = (n: string) => { const t = n.trim().split(/\s+/); return { firstName: t[0] || '', lastName: t.slice(1).join(' ') }; };

@Controller('agents')
export class AgentsOpsController {
  constructor(private prisma: PrismaService, private act: Activity) {}

  /** Device is read-only here: it syncs from the agent app on login. */
  private async validate(b: AgentBody, partial = false, cur?: { firstName: string | null; lastName: string | null; name: string }) {
    const out: Record<string, unknown> = {};
    if (b.name !== undefined && b.firstName === undefined && b.lastName === undefined) Object.assign(b, splitName(str(b.name, 120)));
    if (!partial || b.tag !== undefined) { const t = normTag(b.tag); if (!TAG_RE.test(t)) throw new BadRequestException('Government Tag is required (3–40 letters, digits, / or -)'); out.tag = t; }
    if (!partial || b.firstName !== undefined) { const n = str(b.firstName, 60); if (n.length < 2) throw new BadRequestException('First name is required'); out.firstName = n; }
    if (!partial || b.lastName !== undefined) { const n = str(b.lastName, 60); if (n.length < 2) throw new BadRequestException('Last name is required'); out.lastName = n; }
    if (out.firstName !== undefined || out.lastName !== undefined) {
      const base = cur ? (cur.firstName != null || cur.lastName != null ? { firstName: cur.firstName || '', lastName: cur.lastName || '' } : splitName(cur.name)) : { firstName: '', lastName: '' };
      out.name = `${out.firstName ?? base.firstName} ${out.lastName ?? base.lastName}`.trim();
    }
    if (!partial || b.phone !== undefined) { const p = normPhone(b.phone); if (!p) throw new BadRequestException('Phone must be a valid Nigerian number, e.g. 0803 123 4567'); out.phone = p; }
    if (!partial || b.email !== undefined) { const e = str(b.email).toLowerCase(); if (!EMAIL_RE.test(e)) throw new BadRequestException('A valid email is required'); out.email = e; }
    if (!partial || b.lga !== undefined) { const l = normLga(b.lga); if (!l) throw new BadRequestException(`LGA must be one of: ${LGAS.join(', ')}`); out.lga = l; }
    if (b.groupId !== undefined) {
      if (!b.groupId) out.groupId = null;
      else { const g = await this.prisma.homelandGroup.findUnique({ where: { publicId: b.groupId } }); if (!g) throw new BadRequestException('Unknown group'); out.groupId = g.id; }
    }
    if (b.status !== undefined) { if (!['active', 'suspended'].includes(b.status)) throw new BadRequestException('Bad status'); out.status = b.status; }
    return out;
  }

  @Post() @RequirePerm('ops')
  async create(@Body() b: AgentBody, @CurrentAdmin() admin: AdminCtx) {
    const data = await this.validate(b);
    if (await this.prisma.agent.findFirst({ where: { phone: data.phone as string } })) throw new ConflictException('An agent with this phone already exists');
    if (await this.prisma.agent.findFirst({ where: { tag: data.tag as string } })) throw new ConflictException('An agent with this Government Tag already exists');
    const [lat, lng] = pointIn(data.lga as string);
    const a = await this.prisma.agent.create({ data: { publicId: opaqueId(), status: 'active', lat, lng, ...(data as any) }, include: { group: true } });
    await this.act.audit(admin, 'agent.create', 'agent', a.publicId, `Added agent ${a.name} (${a.lga}${a.group ? ' · ' + a.group.name : ' · un-assigned'})`, undefined, { name: a.name, phone: a.phone });
    await this.act.notify(a.groupId ? 'agents.active' : 'agents.unassigned', 'agent', `New agent onboarded — ${a.name}`, `${a.lga} · ${a.group?.name || 'Un-assigned'}`, `/e/${a.publicId}`);
    this.act.changed(['agents']);
    return { ok: true, id: a.publicId };
  }

  @Patch(':id') @RequirePerm('ops')
  async update(@Param('id') id: string, @Body() b: AgentBody, @CurrentAdmin() admin: AdminCtx) {
    const a = await this.prisma.agent.findUnique({ where: { publicId: id } });
    if (!a) throw new NotFoundException();
    const data = await this.validate(b, true, a);
    if (data.tag && data.tag !== a.tag && (await this.prisma.agent.findFirst({ where: { tag: data.tag as string } }))) throw new ConflictException('Government Tag already used by another agent');
    if (data.phone && data.phone !== a.phone && (await this.prisma.agent.findFirst({ where: { phone: data.phone as string } }))) throw new ConflictException('Phone already used by another agent');
    if (data.lga && data.lga !== a.lga) { const [lat, lng] = pointIn(data.lga as string); Object.assign(data, { lat, lng }); }
    await this.prisma.agent.update({ where: { id: a.id }, data: data as any });
    const before = Object.fromEntries(Object.keys(data).map((k) => [k, (a as any)[k]]));
    await this.act.audit(admin, 'agent.update', 'agent', a.publicId, `Edited agent ${a.name}: ${Object.keys(data).join(', ')}`, before, data);
    this.act.changed(['agents']);
    return { ok: true };
  }

  @Post('status') @HttpCode(200) @RequirePerm('ops')
  async status(@Body() b: { ids?: string[]; status?: string }, @CurrentAdmin() admin: AdminCtx) {
    if (!['active', 'suspended'].includes(b.status || '')) throw new BadRequestException('status must be active or suspended');
    const agents = await this.prisma.agent.findMany({ where: { publicId: { in: idList(b) } } });
    const undo: string[] = [];
    for (const a of agents) {
      if (a.status === b.status) continue;
      await this.prisma.agent.update({ where: { id: a.id }, data: { status: b.status } });
      undo.push((await this.act.audit(admin, b.status === 'suspended' ? 'agent.suspend' : 'agent.activate', 'agent', a.publicId, `${b.status === 'suspended' ? 'Suspended' : 'Activated'} agent ${a.name}`, { status: a.status }, { status: b.status })).id);
    }
    this.act.changed(['agents']);
    return { ok: true, changed: undo.length, undo };
  }

  /** Assign agents to a group, or remove them from their group (groupId null → un-assigned). */
  @Post('assign') @HttpCode(200) @RequirePerm('ops')
  async assign(@Body() b: { ids?: string[]; groupId?: string | null }, @CurrentAdmin() admin: AdminCtx) {
    const g = b.groupId ? await this.prisma.homelandGroup.findUnique({ where: { publicId: b.groupId } }) : null;
    if (b.groupId && !g) throw new BadRequestException('Unknown group');
    if (g && g.status !== 'active') throw new BadRequestException('That group is inactive');
    const agents = await this.prisma.agent.findMany({ where: { publicId: { in: idList(b) } }, include: { group: true } });
    const undo: string[] = [];
    for (const a of agents) {
      if (a.groupId === (g?.id ?? null)) continue;
      await this.prisma.agent.update({ where: { id: a.id }, data: { groupId: g?.id ?? null } });
      undo.push((await this.act.audit(admin, g ? 'agent.assign' : 'agent.unassign', 'agent', a.publicId,
        g ? `Assigned ${a.name} to ${g.name}` : `Removed ${a.name} from ${a.group?.name || 'group'}`, { groupId: a.groupId }, { groupId: g?.id ?? null })).id);
    }
    this.act.changed(['agents']);
    return { ok: true, changed: undo.length, undo };
  }
}

/* ============================== GROUPS ============================== */
@Controller('groups')
export class GroupsController {
  constructor(private prisma: PrismaService, private act: Activity) {}
  @Get() list() { return this.prisma.homelandGroup.findMany({ orderBy: { name: 'asc' }, select: { publicId: true, name: true, status: true, lga: true } }); }

  private body(b: any, partial = false) {
    const d: Record<string, unknown> = {};
    if (!partial || b.name !== undefined) { const n = str(b.name, 80); if (n.length < 2) throw new BadRequestException('Group name is required'); d.name = n; }
    if (b.description !== undefined) d.description = str(b.description, 500) || null;
    if (b.lga !== undefined) { if (b.lga && !normLga(b.lga)) throw new BadRequestException('Unknown LGA'); d.lga = b.lga ? normLga(b.lga) : null; }
    if (b.status !== undefined) { if (!['active', 'inactive'].includes(b.status)) throw new BadRequestException('status must be active or inactive'); d.status = b.status; }
    return d;
  }
  @Post() @RequirePerm('ops')
  async create(@Body() b: any, @CurrentAdmin() admin: AdminCtx) {
    const d = this.body(b);
    if (await this.prisma.homelandGroup.findFirst({ where: { name: { equals: d.name as string, mode: 'insensitive' } } })) throw new ConflictException('A group with this name exists');
    const g = await this.prisma.homelandGroup.create({ data: { publicId: opaqueId(), ...(d as any) } });
    await this.act.audit(admin, 'group.create', 'group', g.publicId, `Created group ${g.name}`, undefined, d);
    this.act.changed(['agents']);
    return { ok: true, id: g.publicId };
  }
  @Patch(':id') @RequirePerm('ops')
  async update(@Param('id') id: string, @Body() b: any, @CurrentAdmin() admin: AdminCtx) {
    const g = await this.prisma.homelandGroup.findUnique({ where: { publicId: id } });
    if (!g) throw new NotFoundException();
    const d = this.body(b, true);
    if (d.name && d.name !== g.name && (await this.prisma.homelandGroup.findFirst({ where: { name: { equals: d.name as string, mode: 'insensitive' }, NOT: { id: g.id } } }))) throw new ConflictException('A group with this name exists');
    await this.prisma.homelandGroup.update({ where: { id: g.id }, data: d as any });
    await this.act.audit(admin, 'group.update', 'group', g.publicId, `Edited group ${g.name}`, Object.fromEntries(Object.keys(d).map((k) => [k, (g as any)[k]])), d);
    this.act.changed(['agents']);
    return { ok: true };
  }
  /** Deleting a group keeps its agents — they become un-assigned. */
  @Delete(':id') @RequirePerm('ops')
  async remove(@Param('id') id: string, @CurrentAdmin() admin: AdminCtx) {
    const g = await this.prisma.homelandGroup.findUnique({ where: { publicId: id }, include: { _count: { select: { agents: true } } } });
    if (!g) throw new NotFoundException();
    await this.prisma.$transaction([this.prisma.agent.updateMany({ where: { groupId: g.id }, data: { groupId: null } }), this.prisma.adminUser.updateMany({ where: { groupId: g.id }, data: { groupId: null } }), this.prisma.homelandGroup.delete({ where: { id: g.id } })]);
    await this.act.audit(admin, 'group.delete', 'group', g.publicId, `Deleted group ${g.name}; ${g._count.agents} agent(s) moved to un-assigned`, { name: g.name }, undefined);
    if (g._count.agents) await this.act.notify('agents.unassigned', 'agent', `${g._count.agents} agent(s) un-assigned`, `Group ${g.name} was deleted`, '/agents/unassigned');
    this.act.changed(['agents']);
    return { ok: true, unassigned: g._count.agents };
  }
}

/* ============================== CATEGORIES ============================== */
@Controller('categories')
export class CategoriesController {
  constructor(private prisma: PrismaService, private act: Activity) {}
  @Get() list() { return this.prisma.reportCategory.findMany({ orderBy: { name: 'asc' }, select: { publicId: true, name: true, riskLevel: true, status: true, sendAgentCount: true } }); }
  private body(b: any, partial = false) {
    const d: Record<string, unknown> = {};
    if (!partial || b.name !== undefined) { const n = str(b.name, 80); if (n.length < 2) throw new BadRequestException('Category name is required'); d.name = n; }
    if (b.description !== undefined) d.description = str(b.description, 500) || null;
    if (!partial || b.riskLevel !== undefined) { const r = b.riskLevel || 'medium'; if (!RISK.includes(r)) throw new BadRequestException(`riskLevel must be ${RISK.join('/')}`); d.riskLevel = r; }
    if (!partial || b.sendAgentCount !== undefined) { const n = Number(b.sendAgentCount ?? 3); if (!Number.isInteger(n) || n < 0 || n > 100) throw new BadRequestException('Agents to send must be 0–100'); d.sendAgentCount = n; }
    if (b.status !== undefined) { if (!['active', 'inactive'].includes(b.status)) throw new BadRequestException('status must be active or inactive'); d.status = b.status; }
    return d;
  }
  @Post() @RequirePerm('ops')
  async create(@Body() b: any, @CurrentAdmin() admin: AdminCtx) {
    const d = this.body(b);
    if (await this.prisma.reportCategory.findFirst({ where: { name: { equals: d.name as string, mode: 'insensitive' } } })) throw new ConflictException('Category exists');
    const c = await this.prisma.reportCategory.create({ data: { publicId: opaqueId(), ...(d as any) } });
    await this.act.audit(admin, 'category.create', 'category', c.publicId, `Created category ${c.name} (risk ${c.riskLevel})`, undefined, d);
    this.act.changed(['reports']);
    return { ok: true, id: c.publicId };
  }
  @Patch(':id') @RequirePerm('ops')
  async update(@Param('id') id: string, @Body() b: any, @CurrentAdmin() admin: AdminCtx) {
    const c = await this.prisma.reportCategory.findUnique({ where: { publicId: id } });
    if (!c) throw new NotFoundException();
    const d = this.body(b, true);
    await this.prisma.$transaction(async (tx) => {
      await tx.reportCategory.update({ where: { id: c.id }, data: d as any });
      if (d.name && d.name !== c.name) await tx.incident.updateMany({ where: { categoryId: c.id }, data: { category: d.name as string } });
    });
    await this.act.audit(admin, 'category.update', 'category', c.publicId, `Edited category ${c.name}`, Object.fromEntries(Object.keys(d).map((k) => [k, (c as any)[k]])), d);
    this.act.changed(['reports']);
    return { ok: true };
  }
  @Delete(':id') @RequirePerm('ops')
  async remove(@Param('id') id: string, @CurrentAdmin() admin: AdminCtx) {
    const c = await this.prisma.reportCategory.findUnique({ where: { publicId: id }, include: { _count: { select: { incidents: true } } } });
    if (!c) throw new NotFoundException();
    if (c._count.incidents) throw new ConflictException(`${c._count.incidents} report(s) use this category — set it inactive instead`);
    await this.prisma.reportCategory.delete({ where: { id: c.id } });
    await this.act.audit(admin, 'category.delete', 'category', c.publicId, `Deleted category ${c.name}`, { name: c.name });
    this.act.changed(['reports']);
    return { ok: true };
  }
}

/* ============================== ADMINS ============================== */
@Controller('admins')
export class AdminsController {
  constructor(private prisma: PrismaService, private act: Activity) {}
  @Get('roles') roles() { return ROLES; }
  private temp() { return 'Ac-' + randomBytes(6).toString('base64url') + '9!'; }
  private async body(b: any, partial = false) {
    const d: Record<string, unknown> = {};
    if (!partial || b.name !== undefined) { const n = str(b.name, 120); if (n.length < 2) throw new BadRequestException('Name is required'); d.name = n; }
    if (!partial || b.email !== undefined) { const e = str(b.email).toLowerCase(); if (!EMAIL_RE.test(e)) throw new BadRequestException('Valid email is required'); d.email = e; }
    if (b.phone !== undefined) { if (b.phone && !normPhone(b.phone)) throw new BadRequestException('Phone looks invalid'); d.phone = b.phone ? normPhone(b.phone) : null; }
    if (!partial || b.role !== undefined) { const r = b.role || 'controller'; if (!ROLES.includes(r)) throw new BadRequestException(`role must be ${ROLES.join('/')}`); d.role = r; }
    if (b.status !== undefined) { if (!['active', 'suspended'].includes(b.status)) throw new BadRequestException('Bad status'); d.status = b.status; }
    if (b.groupId !== undefined) { if (!b.groupId) d.groupId = null; else { const g = await this.prisma.homelandGroup.findUnique({ where: { publicId: b.groupId } }); if (!g) throw new BadRequestException('Unknown group'); d.groupId = g.id; } }
    return d;
  }
  private async guardLastSuper(targetId: string, nextRole?: unknown, nextStatus?: unknown) {
    const t = await this.prisma.adminUser.findUnique({ where: { id: targetId } });
    if (t?.role !== 'superadmin') return;
    if ((nextRole && nextRole !== 'superadmin') || (nextStatus && nextStatus !== 'active') || nextRole === null) {
      const n = await this.prisma.adminUser.count({ where: { role: 'superadmin', status: 'active', NOT: { id: targetId } } });
      if (!n) throw new ForbiddenException('Keep at least one active superadmin');
    }
  }
  @Post() @RequirePerm('admins.manage')
  async create(@Body() b: any, @CurrentAdmin() admin: AdminCtx) {
    const d = await this.body(b);
    if (await this.prisma.adminUser.findUnique({ where: { email: d.email as string } })) throw new ConflictException('An admin with this email exists');
    const password = this.temp();
    const a = await this.prisma.adminUser.create({ data: { publicId: opaqueId(), passwordHash: await bcrypt.hash(password, 10), ...(d as any) } });
    await this.act.audit(admin, 'admin.create', 'admin', a.publicId, `Created admin ${a.email} (${a.role})`, undefined, { email: a.email, role: a.role });
    this.act.changed(['agents']);
    return { ok: true, id: a.publicId, tempPassword: password };
  }
  @Patch(':id') @RequirePerm('admins.manage')
  async update(@Param('id') id: string, @Body() b: any, @CurrentAdmin() admin: AdminCtx) {
    const a = await this.prisma.adminUser.findUnique({ where: { publicId: id } });
    if (!a) throw new NotFoundException();
    const d = await this.body(b, true);
    if (a.id === admin.id && (d.status === 'suspended' || (d.role && d.role !== a.role))) throw new ForbiddenException('You cannot change your own role or suspend yourself');
    await this.guardLastSuper(a.id, d.role, d.status);
    if (d.email && d.email !== a.email && (await this.prisma.adminUser.findUnique({ where: { email: d.email as string } }))) throw new ConflictException('Email in use');
    await this.prisma.adminUser.update({ where: { id: a.id }, data: d as any });
    if (d.status === 'suspended') await this.prisma.session.deleteMany({ where: { adminId: a.id } });
    await this.act.audit(admin, 'admin.update', 'admin', a.publicId, `Edited admin ${a.email}: ${Object.keys(d).join(', ')}`, Object.fromEntries(Object.keys(d).map((k) => [k, (a as any)[k]])), d);
    this.act.changed(['agents']);
    return { ok: true };
  }
  @Post(':id/reset-password') @HttpCode(200) @RequirePerm('admins.manage')
  async reset(@Param('id') id: string, @CurrentAdmin() admin: AdminCtx) {
    const a = await this.prisma.adminUser.findUnique({ where: { publicId: id } });
    if (!a) throw new NotFoundException();
    const password = this.temp();
    await this.prisma.adminUser.update({ where: { id: a.id }, data: { passwordHash: await bcrypt.hash(password, 10) } });
    await this.prisma.session.deleteMany({ where: { adminId: a.id } });
    await this.act.audit(admin, 'admin.reset_password', 'admin', a.publicId, `Reset password for ${a.email}`);
    return { ok: true, tempPassword: password };
  }
  @Delete(':id') @RequirePerm('admins.manage')
  async remove(@Param('id') id: string, @CurrentAdmin() admin: AdminCtx) {
    const a = await this.prisma.adminUser.findUnique({ where: { publicId: id } });
    if (!a) throw new NotFoundException();
    if (a.id === admin.id) throw new ForbiddenException('You cannot delete yourself');
    await this.guardLastSuper(a.id, null);
    await this.prisma.adminUser.delete({ where: { id: a.id } });
    await this.act.audit(admin, 'admin.delete', 'admin', a.publicId, `Deleted admin ${a.email}`, { email: a.email, role: a.role });
    this.act.changed(['agents']);
    return { ok: true };
  }
}

/* ============================== INCIDENTS + DISPATCH + MEDIA ============================== */
const UPLOAD_DIR = () => path.resolve(process.env.UPLOAD_DIR || '/data/uploads');
const MAX_MB = () => Number(process.env.MEDIA_MAX_MB || 25);
const kindOf = (mime: string) => mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : mime === 'application/pdf' ? 'document' : null;
const recent = new Map<string, number>(); // dispatch double-submit guard

@Controller('incidents')
export class IncidentsController {
  constructor(private prisma: PrismaService, private act: Activity) {}
  @Get('agencies') agencies() { return AGENCIES; }

  /**
   * Dispatch Now — hardened: validates agencies, only from new/dispatched, conditional update in a transaction
   * (two controllers clicking at once can't double-transition), 5s duplicate guard, audit + notification + live event.
   */
  @Post(':publicId/dispatch') @HttpCode(200) @RequirePerm('ops')
  async dispatch(@Param('publicId') publicId: string, @Body() b: { agencies?: string[]; note?: string }, @CurrentAdmin() admin: AdminCtx) {
    if (!Array.isArray(b.agencies)) throw new BadRequestException('Select at least one agency');
    const unknown = b.agencies.filter((a) => !AGENCIES.includes(a));
    if (unknown.length) throw new BadRequestException(`Unknown agenc${unknown.length > 1 ? 'ies' : 'y'}: ${unknown.join(', ')}`);
    const agencies = [...new Set(b.agencies)];
    if (!agencies.length) throw new BadRequestException('Select at least one agency');
    const inc = await this.prisma.incident.findUnique({ where: { publicId } });
    if (!inc) throw new NotFoundException('Report not found');
    if (!['new', 'dispatched'].includes(inc.status)) throw new ConflictException(`This report is already ${inc.status}`);
    const key = `${inc.id}:${[...agencies].sort().join('|')}`;
    const last = recent.get(key);
    if (last && Date.now() - last < 5000) throw new ConflictException('Already dispatched to these agencies a moment ago');
    recent.set(key, Date.now());
    if (recent.size > 1000) for (const [k, t] of recent) if (Date.now() - t > 60000) recent.delete(k);
    const note = str(b.note, 500) || null;
    const d = await this.prisma.$transaction(async (tx) => {
      const upd = await tx.incident.updateMany({ where: { id: inc.id, status: { in: ['new', 'dispatched'] } }, data: { status: 'dispatched' } });
      if (!upd.count) throw new ConflictException('Report changed while you were dispatching — refresh');
      return tx.dispatch.create({ data: { incidentId: inc.id, agencies, byAdmin: admin.email, note } });
    });
    const assigned = await assignAgents(this.prisma as any, inc, admin.email).catch((e) => { console.warn('[dispatch] agent assignment failed', e?.message); return 0; });
    if (assigned) this.act.changed(['agents']);
    await this.act.audit(admin, 'incident.dispatch', 'incident', inc.publicId, `Dispatched ${inc.category} (${inc.lga}) to ${agencies.join(', ')}`, { status: inc.status }, { status: 'dispatched', agencies });
    await this.prisma.notification.updateMany({ where: { href: `/e/${inc.publicId}`, target: 'reports.new', readAt: null }, data: { readAt: new Date() } });
    await this.act.notify('reports.dispatched', 'dispatch', `${inc.category} dispatched to ${agencies.length} agenc${agencies.length > 1 ? 'ies' : 'y'}`, agencies.join(', '), `/e/${inc.publicId}`);
    this.act.changed(['reports'], inc.publicId);
    await dataport.pushDispatch(inc.legacyId || inc.publicId, agencies); // no-op until Phase 7
    return { ok: true, dispatchId: d.id, agencies, status: 'dispatched', agentsAssigned: assigned };
  }

  /** acted | resolved | fake. body: { status, note } */
  @Post(':publicId/status') @HttpCode(200) @RequirePerm('ops')
  one(@Param('publicId') id: string, @Body() b: { status?: string; note?: string }, @CurrentAdmin() admin: AdminCtx) { return this.setStatus([id], b, admin); }
  @Post('status') @HttpCode(200) @RequirePerm('ops')
  bulk(@Body() b: { ids?: string[]; status?: string; note?: string }, @CurrentAdmin() admin: AdminCtx) { return this.setStatus(idList(b), b, admin); }

  private async setStatus(ids: string[], b: { status?: string; note?: string }, admin: AdminCtx) {
    const status = b.status || '';
    const allowedFrom: Record<string, string[]> = { acted: ['new', 'dispatched'], resolved: ['new', 'dispatched', 'acted'], fake: ['new', 'dispatched', 'acted'] };
    if (!allowedFrom[status]) throw new BadRequestException('status must be acted, resolved or fake');
    const note = str(b.note, 500) || null;
    if (status === 'fake' && !note) throw new BadRequestException('Give a reason when marking a report fake');
    const incs = await this.prisma.incident.findMany({ where: { publicId: { in: ids } } });
    if (!incs.length) throw new NotFoundException();
    const undo: string[] = []; const skipped: string[] = [];
    for (const i of incs) {
      if (!allowedFrom[status].includes(i.status)) { skipped.push(i.publicId); continue; }
      const data: any = { status, ...(note ? { note } : {}) };
      if (status === 'acted') data.actedAt = new Date();
      if (status === 'resolved' || status === 'fake') { data.resolvedAt = new Date(); data.resolvedBy = admin.email; }
      const r = await this.prisma.incident.updateMany({ where: { id: i.id, status: i.status }, data });
      if (!r.count) { skipped.push(i.publicId); continue; }
      await syncTasks(this.prisma as any, i.id, status);
      const verb = status === 'fake' ? 'Marked fake' : status === 'acted' ? 'Marked acted upon' : 'Resolved';
      undo.push((await this.act.audit(admin, `incident.${status}`, 'incident', i.publicId, `${verb}: ${i.category} (${i.lga})${note ? ' — ' + note : ''}`, { status: i.status, actedAt: i.actedAt, resolvedAt: i.resolvedAt, resolvedBy: i.resolvedBy, note: i.note }, { status })).id);
      await this.act.clearFor(i.publicId);
    }
    if (undo.length && status !== 'fake') await this.act.notify(`reports.${status === 'acted' ? 'acted' : 'resolved'}`, 'report', `${undo.length} report(s) ${status === 'acted' ? 'acted upon' : 'resolved'}`, `by ${admin.email}`, null);
    this.act.changed(['reports']);
    return { ok: true, changed: undo.length, skipped: skipped.length, undo };
  }

  @Post(':publicId/media') @RequirePerm('ops')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 1024 * 1024 * 200 } }))
  async upload(@Param('publicId') id: string, @UploadedFile() file: Express.Multer.File | undefined, @CurrentAdmin() admin: AdminCtx) {
    const inc = await this.prisma.incident.findUnique({ where: { publicId: id } });
    if (!inc) throw new NotFoundException();
    if (!file) throw new BadRequestException('Attach a file (field "file")');
    if (file.size > MAX_MB() * 1024 * 1024) throw new BadRequestException(`File too large (max ${MAX_MB()} MB)`);
    const kind = kindOf(file.mimetype);
    if (!kind) throw new BadRequestException('Only images, video, audio or PDF');
    const pid = opaqueId();
    const ext = path.extname(file.originalname || '').replace(/[^.\w]/g, '').slice(0, 8);
    const dir = path.join(UPLOAD_DIR(), inc.publicId);
    await fs.promises.mkdir(dir, { recursive: true });
    const rel = path.join(inc.publicId, pid + ext);
    await fs.promises.writeFile(path.join(UPLOAD_DIR(), rel), file.buffer);
    const m = await this.prisma.incidentMedia.create({ data: { publicId: pid, incidentId: inc.id, kind, storage: 'local', url: rel, filename: (file.originalname || pid).slice(0, 200), mime: file.mimetype, size: file.size, uploadedBy: admin.email } });
    await this.act.audit(admin, 'media.upload', 'incident', inc.publicId, `Attached ${kind} "${m.filename}" to ${inc.category}`);
    return { ok: true, id: m.publicId };
  }

  @Post(':publicId/media/url') @RequirePerm('ops')
  async addUrl(@Param('publicId') id: string, @Body() b: { url?: string; kind?: string; filename?: string }, @CurrentAdmin() admin: AdminCtx) {
    const inc = await this.prisma.incident.findUnique({ where: { publicId: id } });
    if (!inc) throw new NotFoundException();
    let u: URL; try { u = new URL(str(b.url, 2000)); } catch { throw new BadRequestException('Enter a valid https URL'); }
    if (!['https:', 'http:'].includes(u.protocol)) throw new BadRequestException('URL must be http(s)');
    const guess = /\.(png|jpe?g|gif|webp)$/i.test(u.pathname) ? 'image' : /\.(mp4|webm|mov)$/i.test(u.pathname) ? 'video' : /\.(mp3|wav|ogg|m4a)$/i.test(u.pathname) ? 'audio' : /\.pdf$/i.test(u.pathname) ? 'document' : 'link';
    const kind = ['image', 'video', 'audio', 'document', 'link'].includes(b.kind || '') ? b.kind! : guess;
    const m = await this.prisma.incidentMedia.create({ data: { publicId: opaqueId(), incidentId: inc.id, kind, storage: 'url', url: u.toString(), filename: str(b.filename, 200) || u.pathname.split('/').pop() || u.host, uploadedBy: admin.email } });
    await this.act.audit(admin, 'media.link', 'incident', inc.publicId, `Linked ${kind} ${u.host} to ${inc.category}`);
    return { ok: true, id: m.publicId };
  }
}

@Controller('media')
export class MediaController {
  constructor(private prisma: PrismaService, private act: Activity) {}
  @Get(':id')
  async get(@Param('id') id: string, @Res() res: Response) {
    const m = await this.prisma.incidentMedia.findUnique({ where: { publicId: id } });
    if (!m) throw new NotFoundException();
    if (m.storage === 'url') return res.redirect(m.url);
    const full = path.resolve(UPLOAD_DIR(), m.url);
    if (!full.startsWith(UPLOAD_DIR() + path.sep) || !fs.existsSync(full)) throw new NotFoundException('File missing from storage');
    res.setHeader('Content-Type', m.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${(m.filename || id).replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(full).pipe(res);
  }
  @Delete(':id') @RequirePerm('ops')
  async remove(@Param('id') id: string, @CurrentAdmin() admin: AdminCtx) {
    const m = await this.prisma.incidentMedia.findUnique({ where: { publicId: id }, include: { incident: true } });
    if (!m) throw new NotFoundException();
    await this.prisma.incidentMedia.delete({ where: { id: m.id } });
    if (m.storage === 'local') await fs.promises.unlink(path.resolve(UPLOAD_DIR(), m.url)).catch(() => undefined);
    await this.act.audit(admin, 'media.delete', 'incident', m.incident.publicId, `Removed media "${m.filename}"`);
    return { ok: true };
  }
}

/* ============================== ALARMS ============================== */
@Controller('alarms')
export class AlarmsController {
  constructor(private prisma: PrismaService, private act: Activity) {}
  @Post('resolve') @HttpCode(200) @RequirePerm('ops')
  bulk(@Body() b: { ids?: string[] }, @CurrentAdmin() admin: AdminCtx) { return this.resolve(idList(b), admin); }
  @Post(':id/resolve') @HttpCode(200) @RequirePerm('ops')
  one(@Param('id') id: string, @CurrentAdmin() admin: AdminCtx) { return this.resolve([id], admin); }
  private async resolve(ids: string[], admin: AdminCtx) {
    const alarms = await this.prisma.alarm.findMany({ where: { publicId: { in: ids }, status: 'new' } });
    const undo: string[] = [];
    for (const a of alarms) {
      await this.prisma.alarm.update({ where: { id: a.id }, data: { status: 'resolved', resolvedAt: new Date(), resolvedBy: admin.email } });
      undo.push((await this.act.audit(admin, 'alarm.resolve', 'alarm', a.publicId, `Resolved ${a.type} alarm from ${a.sender}`, { status: a.status, resolvedAt: null, resolvedBy: null }, { status: 'resolved' })).id);
      await this.act.clearFor(a.publicId);
    }
    this.act.changed(['alarms']);
    return { ok: true, changed: undo.length, skipped: ids.length - undo.length, undo };
  }
}

/* ============================== SECURITY ALERTS (Tips) ============================== */
@Controller('alerts')
export class SecurityAlertsController {
  constructor(private prisma: PrismaService, private act: Activity) {}

  private async audience(lga = 'All', userType = 'All', group = 'All') {
    if (lga !== 'All' && !LGAS.includes(lga)) throw new BadRequestException('Unknown LGA');
    if (!['All', 'Users', 'Agents'].includes(userType)) throw new BadRequestException('User type must be All, Users or Agents');
    let groupId: string | undefined;
    if (group !== 'All') { const g = await this.prisma.homelandGroup.findFirst({ where: { name: group } }); if (!g) throw new BadRequestException('Unknown group'); groupId = g.id; }
    const l = lga !== 'All' ? { lga } : {};
    const users = userType === 'Agents' || groupId ? 0 : await this.prisma.user.count({ where: { status: 'active', ...l } });
    const agents = userType === 'Users' ? 0 : await this.prisma.agent.count({ where: { status: 'active', ...l, ...(groupId ? { groupId } : {}) } });
    return { users, agents, total: users + agents };
  }
  @Get('audience')
  async estimate(@Query('lga') lga?: string, @Query('userType') userType?: string, @Query('group') group?: string) {
    const [est, groups] = await Promise.all([this.audience(lga || 'All', userType || 'All', group || 'All'), this.prisma.homelandGroup.findMany({ where: { status: 'active' }, select: { name: true }, orderBy: { name: 'asc' } })]);
    return { ...est, options: { lgas: ['All', ...LGAS], userTypes: ['All', 'Users', 'Agents'], groups: ['All', ...groups.map((g) => g.name)] } };
  }
  @Post() @HttpCode(201) @RequirePerm('ops')
  async create(@Body() b: { title?: string; body?: string; lga?: string; userType?: string; group?: string }, @CurrentAdmin() admin: AdminCtx) {
    const title = str(b.title, 140); const body = str(b.body, 4000);
    if (!title || !body) throw new BadRequestException('Title and description are required');
    const lga = b.lga || 'All', userType = b.userType || 'All', group = b.group || 'All';
    const est = await this.audience(lga, userType, group);
    const a = await this.prisma.securityAlert.create({ data: { publicId: opaqueId(), title, body, lga, userType, group, sender: admin.email } });
    await this.act.audit(admin, 'alert.send', 'alert', a.publicId, `Sent security alert "${title}" to ~${est.total} recipients (LGA ${lga} · ${userType} · ${group})`);
    await this.act.notify('tips.alerts', 'tip', `Security alert sent — ${title}`, `~${est.total} recipients`, `/e/${a.publicId}`);
    await dataport.pushSecurityAlert({ title, body, lga, userType, group }); // no-op until Phase 7
    this.act.changed(['tips']);
    return { ...a, recipients: est };
  }
  @Delete(':id') @RequirePerm('ops')
  async remove(@Param('id') id: string, @CurrentAdmin() admin: AdminCtx) {
    const a = await this.prisma.securityAlert.findUnique({ where: { publicId: id } });
    if (!a) throw new NotFoundException();
    await this.prisma.securityAlert.delete({ where: { id: a.id } });
    await this.act.audit(admin, 'alert.delete', 'alert', a.publicId, `Deleted security alert "${a.title}"`, { title: a.title, body: a.body });
    this.act.changed(['tips']);
    return { ok: true };
  }
}

/* ============================== AUDIT + UNDO ============================== */
const UNDOABLE: Record<string, 'user' | 'agent' | 'incident' | 'alarm'> = {
  'user.approve': 'user', 'user.suspend': 'user', 'user.activate': 'user',
  'agent.suspend': 'agent', 'agent.activate': 'agent', 'agent.assign': 'agent', 'agent.unassign': 'agent',
  'incident.acted': 'incident', 'incident.resolved': 'incident', 'incident.fake': 'incident', 'alarm.resolve': 'alarm',
};
const UNDO_FIELDS: Record<string, string[]> = { user: ['status', 'approvedAt'], agent: ['status', 'groupId'], incident: ['status', 'actedAt', 'resolvedAt', 'resolvedBy', 'note'], alarm: ['status', 'resolvedAt', 'resolvedBy'] };

@Controller('audit')
export class AuditController {
  constructor(private prisma: PrismaService, private act: Activity) {}

  @Get('actions') @RequirePerm('audit.view')
  async actions() { return (await this.prisma.auditLog.groupBy({ by: ['action'], _count: true, orderBy: { action: 'asc' } })).map((a) => ({ action: a.action, label: actionLabel(a.action), count: a._count })); }

  /** body: { ids: auditLogId[] } — restores the "before" snapshot for whitelisted actions (only if nothing changed since). */
  @Post('undo') @HttpCode(200) @RequirePerm('ops')
  async undo(@Body() b: { ids?: string[] }, @CurrentAdmin() admin: AdminCtx) {
    const logs = await this.prisma.auditLog.findMany({ where: { id: { in: idList(b) } } });
    let undone = 0; const errors: string[] = [];
    for (const l of logs) {
      const model = UNDOABLE[l.action];
      if (!model || !l.entityId || !l.before) { errors.push(`${l.action} can't be undone`); continue; }
      if (l.actorId !== admin.id && admin.role !== 'superadmin') { errors.push('Only the same admin can undo'); continue; }
      if (Date.now() - l.createdAt.getTime() > 24 * 3600000) { errors.push('Undo window (24h) passed'); continue; }
      const before = l.before as Record<string, any>; const after = (l.after || {}) as Record<string, any>;
      const data = Object.fromEntries(Object.entries(before).filter(([k]) => UNDO_FIELDS[model].includes(k)).map(([k, v]) => [k, typeof v === 'string' && /At$/.test(k) ? new Date(v) : v]));
      const guard = after.status ? { status: after.status } : 'groupId' in after ? { groupId: after.groupId } : {};
      const r = await (this.prisma as any)[model].updateMany({ where: { publicId: l.entityId, ...guard }, data });
      if (!r.count) { errors.push('Record changed since — not undone'); continue; }
      await this.act.audit(admin, `${l.action}.undo`, l.entityType, l.entityId, `Undid: ${l.summary}`, after, before);
      undone++;
    }
    this.act.changed(['users', 'agents', 'reports', 'alarms']);
    return { ok: true, undone, errors: [...new Set(errors)] };
  }
}

/* ============================== CSV IMPORT ============================== */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let f = ''; let q = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; } else f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}
const TEMPLATES: Record<string, string[]> = {
  users: ['name', 'phone', 'email', 'lga', 'status', 'device'],
  agents: ['tag', 'firstName', 'lastName', 'phone', 'email', 'lga', 'group'],
  groups: ['name', 'description', 'lga'],
  categories: ['name', 'description', 'riskLevel', 'sendAgentCount'],
};

@Controller('import')
export class ImportController {
  constructor(private prisma: PrismaService, private act: Activity) {}
  @Get(':kind/template')
  template(@Param('kind') kind: string, @Res() res: Response) {
    const cols = TEMPLATES[kind]; if (!cols) throw new NotFoundException('Import supports users, agents, groups, categories');
    const sample: Record<string, string> = { users: 'Chidi Okeke,08031234567,chidi@example.com,Umuahia North,active,Android 14 · TECNO KI5', agents: 'ABHS/AGT/0001,Ngozi,Eze,08035550001,ngozi.eze@example.com,Aba South,ARTSMA', groups: 'ARTSMA,Abia Road Traffic,Umuahia North', categories: 'Kidnapping,Abduction reports,critical,6' };
    res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', `attachment; filename="acintel-${kind}-template.csv"`);
    res.send(cols.join(',') + '\n' + sample[kind] + '\n');
  }

  /** body: { csv, dryRun } → per-row validation report; commit with dryRun=false. Admins/incidents/alarms are intentionally not importable. */
  @Post(':kind') @HttpCode(200) @RequirePerm('ops')
  async run(@Param('kind') kind: string, @Body() b: { csv?: string; dryRun?: boolean }, @CurrentAdmin() admin: AdminCtx) {
    if (!TEMPLATES[kind]) throw new BadRequestException('Import supports users, agents, groups and categories only');
    const csv = String(b.csv || ''); if (!csv.trim()) throw new BadRequestException('CSV is empty');
    if (csv.length > 5_000_000) throw new BadRequestException('CSV too large (5 MB max)');
    const rows = parseCsv(csv); if (rows.length < 2) throw new BadRequestException('Need a header row and at least one data row');
    const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s_]/g, ''));
    const want = TEMPLATES[kind].map((c) => c.toLowerCase());
    const idx = Object.fromEntries(want.map((c) => [c, header.indexOf(c)]));
    if (kind === 'agents') idx.name = idx.firstname >= 0 && idx.lastname >= 0 ? -2 : header.indexOf('name'); // firstName/lastName (legacy: name)
    if (kind === 'agents' && idx.tag < 0 && header.includes('nin')) idx.tag = header.indexOf('nin');
    if (idx.name === -1 || idx.name === undefined) throw new BadRequestException(`Header must include: ${TEMPLATES[kind].join(', ')}`);
    const get = (r: string[], c: string) => (idx[c.toLowerCase()] >= 0 ? (r[idx[c.toLowerCase()]] || '').trim() : '');
    const report: { row: number; ok: boolean; action?: string; error?: string; name?: string }[] = [];
    const dry = b.dryRun !== false;
    const seen = new Set<string>();
    const groups = new Map((await this.prisma.homelandGroup.findMany()).map((g) => [g.name.toLowerCase(), g]));
    const toCreateGroups = new Set<string>();
    let created = 0;
    for (let i = 1; i < rows.length && i <= 10000; i++) {
      const r = rows[i]; const line = i + 1;
      const name = kind === 'agents' && idx.name === -2 ? `${get(r, 'firstName')} ${get(r, 'lastName')}`.trim() : get(r, 'name');
      try {
        if (name.length < 2) throw new Error('name missing');
        if (kind === 'users' || kind === 'agents') {
          const phone = normPhone(get(r, 'phone')); if (!phone) throw new Error('invalid phone');
          if (seen.has(phone)) throw new Error('duplicate phone in file'); seen.add(phone);
          const lga = normLga(get(r, 'lga')); if (!lga) throw new Error(`unknown LGA "${get(r, 'lga')}"`);
          const email = get(r, 'email'); if (email && !EMAIL_RE.test(email)) throw new Error('invalid email');
          if (kind === 'users') {
            if (await this.prisma.user.findFirst({ where: { phone } })) throw new Error('phone already registered');
            const status = (get(r, 'status') || 'active').toLowerCase(); if (!['active', 'pending', 'suspended'].includes(status)) throw new Error('status must be active/pending/suspended');
            if (!dry) { await this.prisma.user.create({ data: { publicId: opaqueId(), name, phone, email: email || null, lga, status, device: get(r, 'device') || null, approvedAt: status === 'active' ? new Date() : null } }); created++; }
          } else {
            if (await this.prisma.agent.findFirst({ where: { phone } })) throw new Error('agent phone already exists');
            const nm = idx.name === -2 ? { firstName: get(r, 'firstName'), lastName: get(r, 'lastName') } : splitName(name);
            if (nm.firstName.length < 2 || nm.lastName.length < 2) throw new Error('firstName and lastName are required');
            if (!email) throw new Error('email is required');
            const tag = normTag(get(r, 'tag')); if (!TAG_RE.test(tag)) throw new Error('Government Tag missing or invalid');
            if (seen.has('tag:' + tag) || (await this.prisma.agent.findFirst({ where: { tag } }))) throw new Error('Government Tag already exists'); seen.add('tag:' + tag);
            const gname = get(r, 'group'); let groupId: string | null = null;
            if (gname && !/^un-?assigned$/i.test(gname)) {
              let g = groups.get(gname.toLowerCase());
              if (!g && !dry) { g = await this.prisma.homelandGroup.create({ data: { publicId: opaqueId(), name: gname } }); groups.set(gname.toLowerCase(), g); }
              if (!g) toCreateGroups.add(gname); else groupId = g.id;
            }
            if (!dry) { const [lat, lng] = pointIn(lga); await this.prisma.agent.create({ data: { publicId: opaqueId(), name, ...nm, phone, email: email.toLowerCase(), tag, lga, groupId, status: 'active', lat, lng } }); created++; }
          }
        } else if (kind === 'groups') {
          if (seen.has(name.toLowerCase()) || groups.has(name.toLowerCase())) throw new Error('group already exists'); seen.add(name.toLowerCase());
          const lga = get(r, 'lga'); if (lga && !normLga(lga)) throw new Error('unknown LGA');
          if (!dry) { await this.prisma.homelandGroup.create({ data: { publicId: opaqueId(), name, description: get(r, 'description') || null, lga: lga ? normLga(lga) : null } }); created++; }
        } else {
          if (seen.has(name.toLowerCase()) || (await this.prisma.reportCategory.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } }))) throw new Error('category already exists'); seen.add(name.toLowerCase());
          const risk = (get(r, 'riskLevel') || 'medium').toLowerCase(); if (!RISK.includes(risk)) throw new Error('riskLevel must be low/medium/high/critical');
          const n = Number(get(r, 'sendAgentCount') || 3); if (!Number.isInteger(n) || n < 0 || n > 100) throw new Error('sendAgentCount 0–100');
          if (!dry) { await this.prisma.reportCategory.create({ data: { publicId: opaqueId(), name, description: get(r, 'description') || null, riskLevel: risk, sendAgentCount: n } }); created++; }
        }
        report.push({ row: line, ok: true, name, action: dry ? 'will create' : 'created' });
      } catch (e: any) { report.push({ row: line, ok: false, name, error: e.message }); }
    }
    const okRows = report.filter((r) => r.ok).length;
    if (!dry) {
      await this.act.audit(admin, `import.${kind}`, kind, null, `Imported ${created} ${kind} from CSV (${report.length - okRows} rejected)`);
      if (created) await this.act.notify(kind === 'users' ? 'users.active' : kind === 'agents' ? 'agents.active' : kind === 'groups' ? 'agents.groups' : 'reports.categories', 'import', `CSV import — ${created} ${kind} added`, `by ${admin.email}`, null);
      this.act.changed([kind === 'categories' ? 'reports' : kind === 'groups' ? 'agents' : kind]);
    }
    return { kind, dryRun: dry, total: report.length, valid: okRows, invalid: report.length - okRows, created, newGroups: [...toCreateGroups], rows: report.slice(0, 2000) };
  }
}
