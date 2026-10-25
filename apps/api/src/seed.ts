/* AcIntel seed — runs on every container start (after `prisma migrate deploy`).
 * 1. Always ensures: bootstrap superadmin, reference groups/categories, and backfills (devices, coordinates, category links).
 * 2. Demo data only when the DB has no users (SEED_DEMO=false skips it; SEED_RESET=true wipes demo data and reseeds). */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { opaqueId } from './util';
import { LGAS, normLga, pointIn } from './geo';

const prisma = new PrismaClient();
let s = 20261025;
const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const FIRST = ['Chima', 'Obinna', 'Ngozi', 'Adaeze', 'Ikenna', 'Mike', 'Chinedu', 'Amaka', 'Uchenna', 'Joy', 'Emeka', 'Nnennaya', 'Chiamaka', 'Kelechi', 'Miliano', 'Arinze', 'Ifeoma', 'Michael', 'Ebuka', 'Ogechi'];
const LAST = ['Ikwunze', 'Emegwara', 'Okafor', 'Nwosu', 'Kalu', 'Onyema', 'Eze', 'Uche', 'Matthew', 'Nnadi', 'Chimezie', 'Brown', 'Okeke', 'Obi', 'Nwachukwu', 'Ibe', 'Agwu', 'Orji'];
const DEVICES = ['Android 15 · samsung SM-A055F', 'Android 15 · Xiaomi 25028RN03A', 'Android 14 · TECNO KL4', 'Android 13 · itel A665L', 'iOS 18 · iPhone 13', 'Android 14 · Infinix X6837'];
const GROUPS: [string, string, string][] = [
  ['ARTSMA', 'Abia Road Traffic & Safety Management Agency field agents', 'Umuahia North'],
  ['Homeland-Watch', 'Neighbourhood watch volunteers', 'Aba South'],
  ['Community Police', 'Community policing liaisons', 'Umuahia South'],
  ['Vigilante (AVS)', 'Abia Vigilante Service', 'Aba North'],
  ['OP CRUSH', 'Joint task-force operatives', 'Osisioma'],
];
const CATS: [string, string, number][] = [
  ['Kidnapping', 'critical', 6], ['Robbery', 'high', 4], ['Fire Outbreak', 'high', 3], ['Road Accident', 'medium', 3],
  ['Cult Activity', 'high', 5], ['Suspicious Movement', 'medium', 2], ['Domestic Violence', 'medium', 2], ['Land Dispute', 'low', 1],
];
const name = () => `${pick(FIRST)} ${pick(LAST)}`;
const phone = () => pick(['070', '080', '081', '090', '091']) + String(Math.floor(10000000 + rnd() * 89999999));
const ago = (maxDays: number) => new Date(Date.now() - rnd() * maxDays * 86400000);

async function ensureReference(email: string, passwordHash: string) {
  await prisma.adminUser.upsert({ where: { email }, update: { passwordHash, status: 'active' }, create: { email, name: 'Abia Control Room', role: 'superadmin', passwordHash, publicId: opaqueId() } });
  for (const [n, d, l] of GROUPS) await prisma.homelandGroup.upsert({ where: { name: n }, update: {}, create: { publicId: opaqueId(), name: n, description: d, lga: l } });
  for (const [n, r, c] of CATS) await prisma.reportCategory.upsert({ where: { name: n }, update: {}, create: { publicId: opaqueId(), name: n, riskLevel: r, sendAgentCount: c } });
}

/** Idempotent backfills so upgraded databases get the Phase 1–6 fields populated. */
async function ensureBackfill() {
  const labels = new Set<string>([
    ...(await prisma.user.findMany({ where: { device: { not: null } }, distinct: ['device'], select: { device: true } })).map((x) => x.device!),
    ...(await prisma.agent.findMany({ where: { device: { not: null } }, distinct: ['device'], select: { device: true } })).map((x) => x.device!),
  ]);
  for (const l of labels) await prisma.device.upsert({ where: { label: l }, update: {}, create: { publicId: opaqueId(), label: l, os: l.split('·')[0].trim(), model: l.split('·')[1]?.trim() || null } });
  for (const a of await prisma.agent.findMany({ where: { OR: [{ lat: null }, { device: null }] } })) {
    const [lat, lng] = pointIn(a.lga, rnd);
    await prisma.agent.update({ where: { id: a.id }, data: { ...(a.lat == null ? { lat, lng } : {}), ...(a.device ? {} : { device: pick(DEVICES) }) } });
  }
  const cats = new Map((await prisma.reportCategory.findMany()).map((c) => [c.name.toLowerCase(), c.id]));
  for (const i of await prisma.incident.findMany({ where: { OR: [{ lat: null }, { categoryId: null }] } })) {
    const [lat, lng] = pointIn(i.lga, rnd);
    await prisma.incident.update({ where: { id: i.id }, data: { ...(i.lat == null ? { lat, lng } : {}), ...(i.categoryId ? {} : { categoryId: cats.get(i.category.toLowerCase()) ?? null }) } });
  }
  for (const a of await prisma.alarm.findMany({ where: { OR: [{ lga: null }, { lat: null }] } })) {
    const lga = a.lga || normLga((a.location || '').split(',')[0]) || pick(LGAS);
    const [lat, lng] = pointIn(lga, rnd);
    const u = a.userId ? null : await prisma.user.findFirst({ where: { phone: a.phone } });
    await prisma.alarm.update({ where: { id: a.id }, data: { lga, ...(a.lat == null ? { lat, lng } : {}), ...(u ? { userId: u.id } : {}) } });
  }
  await prisma.user.updateMany({ where: { status: { in: ['active', 'suspended'] }, approvedAt: null }, data: { approvedAt: new Date() } });
  await prisma.$executeRawUnsafe(`UPDATE "Incident" SET "resolvedAt" = "createdAt" + interval '1 hour' * (6 + random()*40) WHERE "status" IN ('resolved','fake') AND "resolvedAt" IS NULL`);
  await prisma.$executeRawUnsafe(`UPDATE "Device" SET "os" = split_part("label", ' · ', 1) WHERE "os" IS NULL`);
}

async function demo(email: string, passwordHash: string) {
  for (const [e, n] of [['ikennajames@homelandcsas.local', 'Ikenna James'], ['ops@acintel.local', 'Ops Desk']]) {
    await prisma.adminUser.upsert({ where: { email: e }, update: {}, create: { email: e, name: n, role: 'controller', passwordHash, publicId: opaqueId() } });
  }
  const groups = await prisma.homelandGroup.findMany();
  const cats = await prisma.reportCategory.findMany();
  const users = [];
  for (let i = 0; i < 180; i++) {
    const n = name(); const r = rnd(); const st = r < 0.82 ? 'active' : r < 0.93 ? 'suspended' : 'pending'; const created = ago(120);
    users.push({ publicId: opaqueId(), name: n, phone: phone(), email: `${n.toLowerCase().replace(/\s+/g, '.')}${i}@gmail.com`, lga: pick(LGAS), status: st, device: rnd() < 0.9 ? pick(DEVICES) : null, createdAt: created, lastLogin: ago(10), approvedAt: st === 'pending' ? null : created });
  }
  await prisma.user.createMany({ data: users });
  const agents = [];
  for (let i = 0; i < 124; i++) {
    const lga = pick(LGAS); const [lat, lng] = pointIn(lga, rnd); const g = rnd() < 0.85 ? pick(groups) : null;
    agents.push({ publicId: opaqueId(), name: name(), phone: phone(), lga, groupId: g?.id ?? null, status: i < 12 ? 'suspended' : 'active', createdAt: ago(90), lat, lng, device: pick(DEVICES), lastSeenAt: rnd() < 0.35 ? new Date(Date.now() - rnd() * 600000) : ago(3) });
  }
  await prisma.agent.createMany({ data: agents });
  const allUsers = await prisma.user.findMany({ select: { id: true, name: true, phone: true, lga: true } });
  const incidents = [];
  for (let i = 0; i < 150; i++) {
    const cat = pick(cats); const lga = pick(LGAS); const r = rnd(); const created = ago(14); const [lat, lng] = pointIn(lga, rnd);
    const status = r < 0.12 ? 'new' : r < 0.32 ? 'dispatched' : r < 0.55 ? 'acted' : r < 0.95 ? 'resolved' : 'fake';
    incidents.push({ publicId: opaqueId(), category: cat.name, categoryId: cat.id, details: `${cat.name} reported around ${lga}`, location: `${lga}, Abia, Nigeria`, lga, lat, lng, status,
      reporterId: rnd() < 0.85 ? pick(allUsers).id : null, createdAt: created,
      actedAt: ['acted', 'resolved'].includes(status) ? new Date(created.getTime() + rnd() * 6 * 3600000) : null,
      resolvedAt: ['resolved', 'fake'].includes(status) ? new Date(created.getTime() + (6 + rnd() * 40) * 3600000) : null, resolvedBy: ['resolved', 'fake'].includes(status) ? email : null,
      note: status === 'fake' ? 'Prank report — caller unreachable' : null });
  }
  await prisma.incident.createMany({ data: incidents });
  const alarms = [];
  for (let i = 0; i < 40; i++) {
    const u = pick(allUsers); const [lat, lng] = pointIn(u.lga, rnd);
    alarms.push({ publicId: opaqueId(), type: rnd() < 0.55 ? 'panic' : 'duress', sender: u.name, phone: u.phone, userId: u.id, location: `${u.lga}, Abia, Nigeria`, lga: u.lga, lat, lng, status: i < 4 ? 'new' : 'resolved', createdAt: ago(60), resolvedAt: i < 4 ? null : new Date(), resolvedBy: i < 4 ? null : email });
  }
  await prisma.alarm.createMany({ data: alarms });
  await prisma.securityAlert.createMany({ data: [
    { publicId: opaqueId(), title: 'Avoid Ama-Ogbonna junction after 9pm', body: 'Patrols active. Report suspicious movement via the app.', lga: 'Aba South', userType: 'All', group: 'Community Police', sender: 'ikennajames@homelandcsas.local' },
    { publicId: opaqueId(), title: 'Market day safety', body: 'Keep valuables close; Homeland-Watch present at Ubani market.', lga: 'Umuahia North', sender: email },
  ] });
  const newInc = await prisma.incident.findMany({ where: { status: 'new' }, take: 7 });
  const pend = await prisma.user.findMany({ where: { status: 'pending' }, take: 4 });
  const nAlarms = await prisma.alarm.findMany({ where: { status: 'new' } });
  const unassigned = await prisma.agent.count({ where: { groupId: null } });
  await prisma.notification.createMany({ data: [
    ...newInc.map((i) => ({ target: 'reports.new', kind: 'report', title: `New report — ${i.category}`, body: i.lga, href: `/e/${i.publicId}` })),
    ...pend.map((u) => ({ target: 'users.pending', kind: 'signup', title: `New user signup — ${u.name}`, body: u.lga, href: `/e/${u.publicId}` })),
    ...nAlarms.map((a) => ({ target: `alarms.${a.type}`, kind: 'alarm', title: `${a.type === 'panic' ? 'Panic' : 'Duress'} alarm — ${a.sender}`, body: a.location, href: `/e/${a.publicId}` })),
    { target: 'agents.unassigned', kind: 'agent', title: `${unassigned} agents awaiting group assignment`, body: 'Agents', href: '/agents/unassigned' },
  ] });
  console.log(`Seed: demo data — ${users.length} users, ${agents.length} agents, ${incidents.length} incidents, ${alarms.length} alarms.`);
}

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@acintel.local').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'Passw0rd!23';
  const passwordHash = await bcrypt.hash(password, 10);
  if (process.env.SEED_RESET === 'true') {
    await prisma.$transaction([prisma.incidentMedia.deleteMany(), prisma.dispatch.deleteMany(), prisma.incident.deleteMany(), prisma.alarm.deleteMany(), prisma.user.deleteMany(), prisma.agent.deleteMany(), prisma.notification.deleteMany(), prisma.securityAlert.deleteMany()]);
  }
  await ensureReference(email, passwordHash);
  if (process.env.SEED_DEMO !== 'false' && !(await prisma.user.count())) await demo(email, passwordHash);
  else console.log('Seed: demo data skipped (existing data or SEED_DEMO=false).');
  await ensureBackfill();
  console.log(`Seed: ensured superadmin ${email}, ${GROUPS.length} groups, ${CATS.length} categories, backfills done.`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
