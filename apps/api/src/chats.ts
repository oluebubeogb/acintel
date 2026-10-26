/**
 * Chats — direct messages between field agents and the state control room.
 * v1 rules: superadmin + controller ("ops") share one control-room desk per agent thread; agents never message
 * each other; group_admin has no access. Unread = agent messages the desk has not opened yet (one shared inbox,
 * so the nav badge means the same thing on every control-room screen).
 *
 * Agent side (Phase 7): the agents' app talks to `/chats/inbound` + `/chats/agent-feed` with the shared
 * CHAT_INBOUND_KEY header. Both are disabled (404) until that env is set.
 */
import {
  BadRequestException, Body, Controller, Get, HttpCode, Injectable, NotFoundException, Param, Post, Query, Req, Res,
  UnauthorizedException, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from './prisma.service';
import { Activity, Bus } from './realtime';
import { AdminCtx, CurrentAdmin, Public, RequirePerm } from './auth';
import { opaqueId } from './util';
import { isOnline } from './rows';
import { fmt } from './lagos';

const UPLOAD_DIR = () => path.resolve(process.env.UPLOAD_DIR || '/data/uploads');
const MAX_BYTES = () => Number(process.env.CHAT_MAX_UPLOAD_MB || 25) * 1024 * 1024;
const IMAGE_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic' };
const AUDIO_MIME: Record<string, string> = {
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/3gpp': '3gp', 'audio/amr': 'amr',
};
const BY_EXT: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', webm: 'audio/webm', ogg: 'audio/ogg', opus: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', '3gp': 'audio/3gpp', amr: 'audio/amr' };
const ALIAS: Record<string, string> = { 'audio/wave': 'audio/wav', 'audio/vnd.wave': 'audio/wav', 'audio/mp3': 'audio/mpeg', 'image/jpg': 'image/jpeg', 'audio/opus': 'audio/ogg' };
/** Resolve a usable mime: trust the declared type, fall back to the file extension when a client sends application/octet-stream. */
function resolveMime(f: { mimetype: string; originalname?: string }) {
  let m = baseMime(f.mimetype); m = ALIAS[m] || m;
  if (!m || m === 'application/octet-stream') m = BY_EXT[(f.originalname || '').split('.').pop()?.toLowerCase() || ''] || m;
  return m;
}
const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const baseMime = (m?: string) => String(m || '').split(';')[0].trim().toLowerCase();

export type ChatFile = { buffer: Buffer; mimetype: string; size: number; originalname?: string };

@Injectable()
export class ChatService {
  private demoT = new Map<string, NodeJS.Timeout>();
  constructor(private prisma: PrismaService, private act: Activity, private bus: Bus) {}

  unread() { return this.prisma.chatMessage.count({ where: { sender: 'agent', readAt: null } }); }

  preview(m: { kind: string; body?: string | null }) {
    if (m.kind === 'image') return m.body ? `📷 ${m.body}` : '📷 Photo';
    if (m.kind === 'voice') return '🎙 Voice note';
    return (m.body || '').replace(/\s+/g, ' ').slice(0, 140);
  }

  async threadFor(agentPublicId: string) {
    const agent = await this.prisma.agent.findUnique({ where: { publicId: agentPublicId } });
    if (!agent) throw new NotFoundException('Agent not found');
    return this.prisma.chatThread.upsert({ where: { agentId: agent.id }, update: {}, create: { publicId: opaqueId(), agentId: agent.id }, include: { agent: { include: { group: true } } } });
  }

  messageRow(m: any) {
    return {
      id: m.publicId, sender: m.sender, by: m.sender === 'admin' ? m.adminName || 'Control Room' : null, body: m.body || '', kind: m.kind,
      url: m.file ? `/api/chats/files/${m.publicId}` : null, mime: m.mime, size: m.size, durationSec: m.durationSec,
      read: !!m.readAt, readAt: m.readAt, at: m.createdAt, when: fmt(m.createdAt),
    };
  }

  /** Persist one message (any sender), bump the thread, fan out over Redis → SSE, refresh the nav badge. */
  async post(threadId: string, sender: 'admin' | 'agent', data: { body?: string; admin?: AdminCtx; file?: ChatFile; durationSec?: number; at?: Date }) {
    const thread = await this.prisma.chatThread.findUnique({ where: { id: threadId } });
    if (!thread) throw new NotFoundException('Conversation not found');
    const body = str(data.body);
    let kind = 'text'; let rel: string | null = null; let mime: string | null = null; let size: number | null = null;
    const pid = opaqueId();
    if (data.file) {
      mime = resolveMime(data.file);
      const ext = IMAGE_MIME[mime] || AUDIO_MIME[mime] || (mime === 'video/webm' ? 'webm' : null);
      if (!ext) throw new BadRequestException('Only photos (JPG, PNG, WebP, GIF) and voice notes (WebM, OGG, MP3, M4A, AAC, WAV) can be sent');
      if (data.file.size > MAX_BYTES()) throw new BadRequestException(`Attachment is larger than ${MAX_BYTES() / 1048576} MB`);
      kind = IMAGE_MIME[mime] ? 'image' : 'voice';
      if (mime === 'video/webm') mime = 'audio/webm'; // some browsers label MediaRecorder audio as video/webm
      const dir = path.join(UPLOAD_DIR(), 'chats', thread.publicId);
      await fs.promises.mkdir(dir, { recursive: true });
      rel = path.join('chats', thread.publicId, `${pid}.${ext}`);
      await fs.promises.writeFile(path.join(UPLOAD_DIR(), rel), data.file.buffer);
      size = data.file.size;
    }
    if (!body && !rel) throw new BadRequestException('Type a message or attach a photo or voice note');
    const dur = Number(data.durationSec);
    const at = data.at || new Date();
    const m = await this.prisma.chatMessage.create({ data: {
      publicId: pid, threadId, sender, adminId: data.admin?.id, adminName: data.admin?.name, body: body || null, kind, file: rel, mime, size,
      durationSec: kind === 'voice' && Number.isFinite(dur) && dur > 0 ? Math.min(dur, 3600) : null, createdAt: at,
    } });
    await this.prisma.chatThread.update({ where: { id: threadId }, data: { lastMessageAt: at, lastPreview: this.preview(m), lastSender: sender } });
    this.bus.publish({ type: 'chat.message', threadId: thread.publicId, messageId: m.publicId, sender });
    this.act.pushCounts();
    return m;
  }

  async markRead(threadId: string, sender: 'agent' | 'admin') {
    const r = await this.prisma.chatMessage.updateMany({ where: { threadId, sender, readAt: null }, data: { readAt: new Date() } });
    if (r.count) {
      const t = await this.prisma.chatThread.findUnique({ where: { id: threadId }, select: { publicId: true } });
      this.bus.publish({ type: 'chat.read', threadId: t?.publicId || '', sender });
      this.act.pushCounts();
    }
    return r.count;
  }

  /** Demo mode: a field agent answers a few seconds after the control room writes (standalone/demo only). */
  demoReply(threadId: string, admin: { name: string }) {
    const on = process.env.CHAT_DEMO_REPLIES === 'true' || (process.env.CHAT_DEMO_REPLIES !== 'false' && process.env.SIMULATE_ACTIVITY !== 'false');
    if (!on) return;
    const lines = ['Copy, Control. On my way now.', 'Received. I will confirm on ground and revert.', 'Noted sir. Area is calm for now, monitoring.',
      'Roger. Two of us are heading there.', 'Understood. Will send a photo when I arrive.', `Thank you ${admin.name.split(' ')[0]}, acknowledged.`];
    clearTimeout(this.demoT.get(threadId)); // one reply per burst of control-room messages
    this.demoT.set(threadId, setTimeout(() => {
      this.demoT.delete(threadId);
      this.prisma.chatMessage.findFirst({ where: { threadId, sender: 'agent' }, orderBy: { createdAt: 'desc' }, select: { body: true } })
        .then(async (last) => { const pool = lines.filter((l) => l !== last?.body); await this.markRead(threadId, 'admin'); await this.post(threadId, 'agent', { body: pool[Math.floor(Math.random() * pool.length)] }); })
        .catch(() => undefined);
    }, 3500 + Math.random() * 4000));
  }
}

@Controller('chats')
export class ChatsController {
  constructor(private prisma: PrismaService, private chats: ChatService, private act: Activity) {}

  /** Conversation list. q matches agent name / phone / tag / LGA / group or message text (snippet returned). */
  @Get() @RequirePerm('ops')
  async list(@Query('q') qRaw?: string, @Query('filter') filter?: string) {
    const q = str(qRaw, 80);
    const agentWhere = q ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { phone: { contains: q.replace(/\s/g, '') } }, { tag: { contains: q, mode: 'insensitive' as const } }, { lga: { contains: q, mode: 'insensitive' as const } }, { group: { name: { contains: q, mode: 'insensitive' as const } } }] } : undefined;
    const hits = q ? await this.prisma.chatMessage.findMany({ where: { body: { contains: q, mode: 'insensitive' } }, orderBy: { createdAt: 'desc' }, take: 400, select: { threadId: true, body: true, publicId: true, createdAt: true } }) : [];
    const hitBy = new Map<string, (typeof hits)[number]>(); for (const h of hits) if (!hitBy.has(h.threadId)) hitBy.set(h.threadId, h);
    const where: any = q ? { OR: [{ agent: agentWhere }, { id: { in: [...hitBy.keys()] } }] } : {};
    if (filter === 'unread') where.messages = { some: { sender: 'agent', readAt: null } };
    const threads = await this.prisma.chatThread.findMany({ where, orderBy: { lastMessageAt: 'desc' }, take: 300, include: { agent: { include: { group: true } } } });
    const unread = await this.prisma.chatMessage.groupBy({ by: ['threadId'], where: { sender: 'agent', readAt: null, threadId: { in: threads.map((t) => t.id) } }, _count: true });
    const u = new Map(unread.map((r) => [r.threadId, r._count]));
    const rows = threads.map((t) => {
      const h = hitBy.get(t.id);
      return { id: t.publicId, agent: this.agentCard(t.agent), lastAt: t.lastMessageAt, when: fmt(t.lastMessageAt), preview: t.lastPreview || '', lastSender: t.lastSender, unread: u.get(t.id) || 0,
        match: h ? { id: h.publicId, text: snippet(h.body || '', q) } : null };
    });
    return { rows, unread: await this.chats.unread() };
  }

  /** People picker for a new conversation (active agents). */
  @Get('people') @RequirePerm('ops')
  async people(@Query('q') qRaw?: string) {
    const q = str(qRaw, 80);
    const agents = await this.prisma.agent.findMany({
      where: { status: 'active', ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q.replace(/\s/g, '') } }, { tag: { contains: q, mode: 'insensitive' } }, { lga: { contains: q, mode: 'insensitive' } }] } : {}) },
      orderBy: [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }], take: 30, include: { group: true, chatThread: { select: { publicId: true } } },
    });
    return agents.map((a) => ({ ...this.agentCard(a), thread: a.chatThread?.publicId || null }));
  }

  /** Open (or create) the thread with one agent. body: { agentId } (agent publicId) */
  @Post('start') @HttpCode(200) @RequirePerm('ops')
  async start(@Body() b: { agentId?: string }, @CurrentAdmin() admin: AdminCtx) {
    const id = str(b.agentId, 40); if (!id) throw new BadRequestException('Choose an agent');
    const existed = await this.prisma.chatThread.findFirst({ where: { agent: { publicId: id } }, select: { id: true } });
    const t = await this.chats.threadFor(id);
    if (t.agent.status !== 'active' && !existed) throw new BadRequestException(`${t.agent.name} is ${t.agent.status} — activate the agent before messaging`);
    if (!existed) await this.act.audit(admin, 'chat.start', 'agent', t.agent.publicId, `Started a conversation with ${t.agent.name}`);
    return { id: t.publicId };
  }

  @Post(':id/read') @HttpCode(200) @RequirePerm('ops')
  async read(@Param('id') id: string) {
    const t = await this.prisma.chatThread.findUnique({ where: { publicId: id } });
    if (!t) throw new NotFoundException('Conversation not found');
    return { ok: true, marked: await this.chats.markRead(t.id, 'agent') };
  }

  /** Text message. body: { body } */
  @Post(':id/messages') @HttpCode(200) @RequirePerm('ops')
  async send(@Param('id') id: string, @Body() b: { body?: string }, @CurrentAdmin() admin: AdminCtx) {
    const t = await this.prisma.chatThread.findUnique({ where: { publicId: id }, include: { agent: true } });
    if (!t) throw new NotFoundException('Conversation not found');
    if (t.agent.status !== 'active') throw new BadRequestException(`${t.agent.name} is ${t.agent.status} — messages are paused`);
    await this.chats.markRead(t.id, 'agent'); // replying means the desk has read the thread
    const m = await this.chats.post(t.id, 'admin', { body: b.body, admin });
    this.chats.demoReply(t.id, admin);
    return this.chats.messageRow(m);
  }

  /** Photo or voice note (multipart: file, optional body caption, optional durationSec). */
  @Post(':id/attachments') @HttpCode(200) @RequirePerm('ops')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 1024 * 1024 * 60 } }))
  async attach(@Param('id') id: string, @UploadedFile() file: Express.Multer.File | undefined, @Body() b: { body?: string; durationSec?: string }, @CurrentAdmin() admin: AdminCtx) {
    if (!file) throw new BadRequestException('Attach a photo or voice note');
    const t = await this.prisma.chatThread.findUnique({ where: { publicId: id }, include: { agent: true } });
    if (!t) throw new NotFoundException('Conversation not found');
    if (t.agent.status !== 'active') throw new BadRequestException(`${t.agent.name} is ${t.agent.status} — messages are paused`);
    await this.chats.markRead(t.id, 'agent');
    const m = await this.chats.post(t.id, 'admin', { body: b.body, admin, file, durationSec: Number(b.durationSec) });
    this.chats.demoReply(t.id, admin);
    return this.chats.messageRow(m);
  }

  @Get('files/:messageId') @RequirePerm('ops')
  async file(@Param('messageId') id: string, @Req() req: Request, @Res() res: Response) { return serveFile(this.prisma, id, req, res); }

  /* ---------- Agents' app seam (Phase 7) — shared-key auth, disabled until CHAT_INBOUND_KEY is set ---------- */

  /** Agent → control room. Header x-chat-key. Body/multipart: { agent (publicId | legacyId | phone), body?, durationSec? } + optional file. */
  @Public() @Post('inbound') @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 1024 * 1024 * 60 } }))
  async inbound(@Req() req: Request, @UploadedFile() file: Express.Multer.File | undefined, @Body() b: { agent?: string; body?: string; durationSec?: string }) {
    checkKey(req);
    const a = await findAgent(this.prisma, str(b.agent, 60));
    const t = await this.chats.threadFor(a.publicId);
    const m = await this.chats.post(t.id, 'agent', { body: b.body, file, durationSec: Number(b.durationSec) });
    return { ok: true, id: m.publicId, thread: t.publicId };
  }

  /** Control room → agent feed for the agents' app. Header x-chat-key. ?agent=…&since=ISO&ack=1 marks HQ messages as seen. */
  @Public() @Get('agent-feed')
  async agentFeed(@Req() req: Request, @Query('agent') agentRef?: string, @Query('since') since?: string, @Query('ack') ack?: string) {
    checkKey(req);
    const a = await findAgent(this.prisma, str(agentRef, 60));
    const t = await this.prisma.chatThread.findUnique({ where: { agentId: a.id } });
    if (!t) return { thread: null, messages: [] };
    const s = since ? new Date(since) : null;
    const msgs = await this.prisma.chatMessage.findMany({ where: { threadId: t.id, ...(s && !isNaN(+s) ? { createdAt: { gt: s } } : {}) }, orderBy: { createdAt: 'asc' }, take: 500 });
    if (ack === '1') await this.chats.markRead(t.id, 'admin');
    return { thread: t.publicId, messages: msgs.map((m) => ({ ...this.chats.messageRow(m), url: m.file ? `/chats/agent-files/${m.publicId}` : null })) };
  }

  @Public() @Get('agent-files/:messageId')
  async agentFile(@Param('messageId') id: string, @Req() req: Request, @Res() res: Response) { checkKey(req); return serveFile(this.prisma, id, req, res); }

  /** Declared last so /chats/people, /chats/agent-feed etc. win over the :id param. */
  @Get(':id') @RequirePerm('ops')
  async thread(@Param('id') id: string, @Query('before') before?: string) {
    const t = await this.prisma.chatThread.findUnique({ where: { publicId: id }, include: { agent: { include: { group: true } } } });
    if (!t) throw new NotFoundException('Conversation not found');
    const b = before ? new Date(before) : null;
    const msgs = await this.prisma.chatMessage.findMany({ where: { threadId: t.id, ...(b && !isNaN(+b) ? { createdAt: { lt: b } } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 });
    return { id: t.publicId, agent: this.agentCard(t.agent), messages: msgs.reverse().map((m) => this.chats.messageRow(m)), more: msgs.length === 200 };
  }

  private agentCard(a: any) {
    return { id: a.publicId, name: a.name, phone: a.phone, tag: a.tag || '', lga: a.lga, group: a.group?.name || 'Un-assigned', status: a.status, online: isOnline(a.lastSeenAt), lastSeen: a.lastSeenAt ? fmt(a.lastSeenAt) : null };
  }
}

function snippet(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, 90);
  const s = Math.max(0, i - 14);
  return (s > 0 ? '…' : '') + text.slice(s, i + q.length + 50) + (i + q.length + 50 < text.length ? '…' : '');
}

function checkKey(req: Request) {
  const key = process.env.CHAT_INBOUND_KEY;
  if (!key) throw new NotFoundException();
  const got = Buffer.from(String(req.headers['x-chat-key'] || ''));
  const want = Buffer.from(key);
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new UnauthorizedException('Bad chat key');
}

async function findAgent(prisma: PrismaService, ref: string) {
  if (!ref) throw new BadRequestException('agent is required');
  const phone = ref.replace(/[\s\-()]/g, '').replace(/^\+?234/, '0');
  const a = await prisma.agent.findFirst({ where: { OR: [{ publicId: ref }, { legacyId: ref }, { phone }] } });
  if (!a) throw new NotFoundException('Agent not found');
  if (a.status !== 'active') throw new BadRequestException(`Agent is ${a.status}`);
  return a;
}

/** Stream a chat attachment with Range support (voice notes seek properly). */
async function serveFile(prisma: PrismaService, id: string, req: Request, res: Response) {
  const m = await prisma.chatMessage.findUnique({ where: { publicId: id } });
  if (!m?.file) throw new NotFoundException();
  const full = path.resolve(UPLOAD_DIR(), m.file);
  if (!full.startsWith(UPLOAD_DIR() + path.sep) || !fs.existsSync(full)) throw new NotFoundException('File missing from storage');
  const size = (await fs.promises.stat(full)).size;
  res.setHeader('Content-Type', m.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Accept-Ranges', 'bytes');
  const range = /bytes=(\d*)-(\d*)/.exec(String(req.headers.range || ''));
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) { res.status(416).setHeader('Content-Range', `bytes */${size}`); return res.end(); }
    res.status(206); res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`); res.setHeader('Content-Length', String(end - start + 1));
    return fs.createReadStream(full, { start, end }).pipe(res);
  }
  res.setHeader('Content-Length', String(size));
  fs.createReadStream(full).pipe(res);
}
