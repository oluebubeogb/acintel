import {
  Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, HttpCode, HttpException, HttpStatus, Injectable, Post, Req, Res,
  SetMetadata, UnauthorizedException, createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from './prisma.service';
import { newToken, sha256 } from './util';
import { Activity, Bus } from './realtime';

export const COOKIE = 'acintel_sid';
const TTL_MS = 1000 * 60 * 60 * 12; // 12h control-room shift
export const Public = () => SetMetadata('public', true);
export const CurrentAdmin = createParamDecorator((_d, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().admin);
export type AdminCtx = { id: string; email: string; name: string; role: string; publicId: string; groupId?: string | null; ip?: string };

/* ---------------- Roles v1 ----------------
 * superadmin  – everything (admins, site settings, audit, ops)
 * controller  – control-room operations + audit log + own preferences
 * group_admin – read-only for now; `groupId` is stored so a later phase can scope ops to one group.
 */
export type Perm = 'ops' | 'admins.manage' | 'settings.site' | 'audit.view';
export const ROLE_PERMS: Record<string, Perm[] | ['*']> = {
  superadmin: ['*'],
  controller: ['ops', 'audit.view'],
  group_admin: [],
};
export const ROLES = Object.keys(ROLE_PERMS);
export const can = (role: string, perm: Perm) => { const p = ROLE_PERMS[role] || []; return (p as string[]).includes('*') || (p as string[]).includes(perm); };
export const RequirePerm = (perm: Perm) => SetMetadata('perm', perm);
export const permsFor = (role: string): string[] => (['ops', 'admins.manage', 'settings.site', 'audit.view'] as Perm[]).filter((p) => can(role, p));

export function clientIp(req: Request) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || String(req.headers['x-real-ip'] || '') || req.socket?.remoteAddress || 'unknown';
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private prisma: PrismaService, private reflector: Reflector) {}
  async canActivate(ctx: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>('public', [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<Request & { admin?: AdminCtx }>();
    const token = req.cookies?.[COOKIE];
    if (!token) throw new UnauthorizedException();
    const s = await this.prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { admin: true } });
    if (!s || s.expiresAt < new Date() || s.admin.status !== 'active') throw new UnauthorizedException();
    const { id, email, name, role, publicId, groupId } = s.admin;
    req.admin = { id, email, name, role, publicId, groupId, ip: clientIp(req) };
    const perm = this.reflector.getAllAndOverride<Perm | undefined>('perm', [ctx.getHandler(), ctx.getClass()]);
    if (perm && !can(role, perm)) throw new ForbiddenException(`Your role (${role}) cannot do this`);
    return true;
  }
}

/** Login throttle — Redis counters when available, in-memory otherwise. */
@Injectable()
export class RateLimiter {
  private mem = new Map<string, { n: number; exp: number }>();
  constructor(private bus: Bus) {}
  async hit(key: string, windowSec: number): Promise<{ n: number; ttl: number }> {
    if (this.bus.redisReady && this.bus.pub) {
      try {
        const k = `rl:${key}`;
        const n = await this.bus.pub.incr(k);
        if (n === 1) await this.bus.pub.expire(k, windowSec);
        const ttl = await this.bus.pub.ttl(k);
        return { n, ttl: Math.max(ttl, 1) };
      } catch { /* fall through */ }
    }
    const now = Date.now();
    const e = this.mem.get(key);
    if (!e || e.exp < now) { this.mem.set(key, { n: 1, exp: now + windowSec * 1000 }); return { n: 1, ttl: windowSec }; }
    e.n++; return { n: e.n, ttl: Math.ceil((e.exp - now) / 1000) };
  }
  async peek(key: string): Promise<{ n: number; ttl: number }> {
    if (this.bus.redisReady && this.bus.pub) {
      try { const [n, ttl] = await Promise.all([this.bus.pub.get(`rl:${key}`), this.bus.pub.ttl(`rl:${key}`)]); return { n: Number(n || 0), ttl: Math.max(ttl, 0) }; } catch { /* */ }
    }
    const e = this.mem.get(key); if (!e || e.exp < Date.now()) return { n: 0, ttl: 0 };
    return { n: e.n, ttl: Math.ceil((e.exp - Date.now()) / 1000) };
  }
  async reset(key: string) { this.mem.delete(key); if (this.bus.redisReady && this.bus.pub) await this.bus.pub.del(`rl:${key}`).catch(() => undefined); }
}

const MAX_FAILS = () => Number(process.env.LOGIN_MAX_FAILS || 5);
const MAX_IP = () => Number(process.env.LOGIN_MAX_PER_IP || 30);
const WINDOW = () => Number(process.env.LOGIN_WINDOW_MINUTES || 15) * 60;

/** COOKIE_SECURE=true|false|auto (default auto): auto = Secure when the edge proxy says the request was HTTPS. */
function cookieSecure(req: Request) {
  const v = (process.env.COOKIE_SECURE || 'auto').toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || (req as any).secure === true;
}

@Controller('auth')
export class AuthController {
  constructor(private prisma: PrismaService, private rl: RateLimiter, private act: Activity) {}

  @Public() @Post('login') @HttpCode(200)
  async login(@Body() body: { email?: string; password?: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const email = (body.email || '').trim().toLowerCase();
    const ip = clientIp(req);
    const tooMany = (ttl: number) => {
      res.setHeader('Retry-After', String(ttl));
      return new HttpException({ statusCode: 429, message: `Too many login attempts. Try again in ${Math.ceil(ttl / 60)} min.` }, HttpStatus.TOO_MANY_REQUESTS);
    };
    const ipHit = await this.rl.hit(`login:ip:${ip}`, WINDOW());
    if (ipHit.n > MAX_IP()) throw tooMany(ipHit.ttl);
    const acct = await this.rl.peek(`login:acct:${email}`);
    if (acct.n >= MAX_FAILS()) throw tooMany(acct.ttl);

    const admin = await this.prisma.adminUser.findUnique({ where: { email } });
    const ok = !!admin && (await bcrypt.compare(body.password || '', admin.passwordHash));
    if (!ok || !admin) {
      const f = await this.rl.hit(`login:acct:${email}`, WINDOW());
      await this.act.audit(null, 'auth.login_failed', 'admin', admin?.publicId || null, `Failed login for ${email || '(blank)'} from ${ip}`, undefined, { attempts: f.n });
      if (f.n >= MAX_FAILS()) throw tooMany(f.ttl);
      throw new UnauthorizedException(`Invalid email or password${f.n >= MAX_FAILS() - 2 ? ` · ${MAX_FAILS() - f.n} attempt(s) left` : ''}`);
    }
    if (admin.status !== 'active') throw new ForbiddenException('This admin account is suspended');
    await this.rl.reset(`login:acct:${email}`);
    const token = newToken();
    await this.prisma.session.create({ data: { tokenHash: sha256(token), adminId: admin.id, expiresAt: new Date(Date.now() + TTL_MS) } });
    await this.prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    await this.act.audit({ id: admin.id, email: admin.email, name: admin.name, role: admin.role, publicId: admin.publicId, ip }, 'auth.login', 'admin', admin.publicId, `${admin.name} signed in`);
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: TTL_MS, secure: cookieSecure(req) });
    return { ok: true, admin: { email: admin.email, name: admin.name, role: admin.role } };
  }

  @Post('logout') @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[COOKIE];
    if (token) await this.prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
    res.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  me(@CurrentAdmin() admin: AdminCtx) { return { ...admin, perms: permsFor(admin.role) }; }
}
