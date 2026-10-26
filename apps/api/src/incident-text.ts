/**
 * Incident text helpers.
 * - localTitle/localSummary: deterministic fallbacks used until an AI title/summary exists (or when AI is not configured).
 * - IncidentAiWorker: when OPENAI_* is configured, fills Incident.aiTitle + aiSummary in the background from the
 *   reporter's raw words (`details`). Disable with INCIDENT_AI=false.
 * - narrative(): demo-only realistic reporter text for seeded/simulated incidents.
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { aiConfigured, cleanContent, llm } from './llm';
import { AiFeature, aiOn, incidentAiEnvOff } from './ai-flags';

export const SOURCES = ['user', 'agent', 'call_centre', 'ecc'] as const;
export type Source = (typeof SOURCES)[number];
export const SOURCE_LABEL: Record<string, string> = { user: 'User', agent: 'Agent', call_centre: 'Call Centre', ecc: 'ECC' };
export const normSource = (v?: string | null): Source | null => {
  const t = String(v || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (t === 'callcentre' || t === 'call_center' || t === 'callcenter') return 'call_centre';
  return (SOURCES as readonly string[]).includes(t) ? (t as Source) : null;
};

const clip = (s: string, n: number) => {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1); const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-–—]+$/, '') + '…';
};
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Short headline from the reporter's words: first clause, filler stripped, ≤ 64 chars. */
export function localTitle(details?: string | null, category?: string | null): string {
  let t = tidy(details || '');
  if (!t) return category || 'Incident report';
  t = t.replace(/^(please|pls|hello|hi|good (morning|afternoon|evening)|urgent|help|sos|attention)[\s,!:.-]+/i, '');
  t = t.replace(/^(i want to report( that)?|i('m| am) reporting( that)?|i (just )?(saw|noticed|witnessed)|there is|there are|there was|we (have|saw|need))\s+/i, '');
  const first = t.split(/(?<=[.!?])\s+|\s+[–—-]\s+|;\s*/)[0] || t;
  return cap(clip(first.replace(/[.!?]+$/, ''), 64));
}

/** Longer summary fallback: first two sentences, ≤ 280 chars. */
export function localSummary(details?: string | null): string {
  const t = tidy(details || '');
  if (!t) return '';
  const s = t.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
  return clip(s, 280);
}

/* ---------------------------- demo narratives ---------------------------- */
const N: Record<string, string[]> = {
  'Kidnapping': [
    'Two men in a black Sienna forced a young woman into the car near {place} this evening. They drove off towards the expressway, plate number partly covered. People are shouting, please send help quickly.',
    'My neighbour\'s son has not come back since morning and his mother just received a call asking for ransom. The caller said they are holding him somewhere around {place}. We are very afraid.',
  ],
  'Robbery': [
    'Armed boys are robbing shops at {place} right now, about four of them with guns and cutlasses. They collected phones and money from traders and are still around the junction.',
    'I was attacked on my way home near {place}, they took my bag, phone and POS machine. They ran into the bush behind the filling station on a motorcycle without plate number.',
  ],
  'Fire Outbreak': [
    'Big fire at {place}, it started from a generator shop and is spreading to the stalls beside it. Smoke everywhere, nobody has seen fire service yet, please call them.',
    'Fire has caught a residential building at {place}. Some people are still inside on the first floor and we cannot reach them because of the heat.',
  ],
  'Road Accident': [
    'Bad accident at {place}, a trailer collided with a bus and some passengers are trapped inside. Traffic is completely blocked and we need ambulance urgently.',
    'Okada rider knocked down a pedestrian at {place} and ran away. The woman is bleeding from the head and lying by the road. Somebody should come with first aid.',
  ],
  'Cult Activity': [
    'Cult boys are fighting at {place} since 9pm, we heard gunshots twice and everybody has locked their doors. They are wearing red berets and chanting.',
    'A group of young men initiated new members behind the school at {place} last night. They are threatening anybody who passes the road. Residents are scared to go out.',
  ],
  'Suspicious Movement': [
    'Strange men have been parking an unmarked Hilux near {place} every night this week and watching the houses. They leave around 2am. We suspect they are planning something.',
    'Some unknown people with big bags are camping in the uncompleted building at {place}. They only come out at night and they are not from this community.',
  ],
  'Domestic Violence': [
    'A man is beating his wife seriously in the compound at {place}, we can hear her screaming and the children crying. Neighbours are afraid to enter because he has a machete.',
    'Our neighbour at {place} has locked his wife inside the house for two days and is threatening her. She called from the window asking for help.',
  ],
  'Land Dispute': [
    'Two families are fighting over a plot of land at {place} with sticks and cutlasses. Some hired thugs have come and are destroying the fence. It may get worse.',
    'Land grabbers came with a bulldozer to the community land at {place} and are pulling down buildings. The youths are gathering to resist them.',
  ],
};
const PLACES = ['the main market', 'Ehi road junction', 'the park beside First Bank', 'the motor park', 'the Catholic church junction', 'Old Express junction', 'the stadium gate', 'the new layout', 'the school road', 'Ubani market'];
export function narrative(category: string, lga: string, rnd: () => number = Math.random): string {
  const list = N[category] || [`${category} reported near {place}. People around are asking for security to come and check what is happening.`];
  const place = `${PLACES[Math.floor(rnd() * PLACES.length)]}, ${lga}`;
  return list[Math.floor(rnd() * list.length)].replace('{place}', place);
}

/* ---------------------------- AI worker ---------------------------- */
const PROMPT = 'You write for a state security control room. Given a citizen incident report, reply with strict JSON only: {"title": "<concise headline, max 8 words, no trailing period>", "summary": "<2-3 sentence neutral summary for responders: what, where, urgency, any names/vehicles/weapons>"}';

export function parseAi(content: string): { title: string; summary: string } | null {
  const c = cleanContent(content);
  const m = c.match(/\{[\s\S]*\}/);
  try {
    const j = JSON.parse(m ? m[0] : c);
    const title = tidy(String(j.title || '')).replace(/[.]+$/, '');
    const summary = tidy(String(j.summary || ''));
    return title ? { title: clip(title, 80), summary: clip(summary, 800) } : null;
  } catch { return null; }
}

@Injectable()
export class IncidentAiWorker implements OnModuleInit, OnModuleDestroy {
  private t?: NodeJS.Timeout; private busy = false;
  constructor(private prisma: PrismaService) {}
  onModuleInit() {
    if (incidentAiEnvOff()) return; // env hard-off; Settings → AI → Report Titles & Summaries pauses it at runtime
    this.t = setInterval(() => this.run().catch((e) => console.warn('[incident-ai]', e?.message)), Number(process.env.INCIDENT_AI_INTERVAL_MS || 60000));
  }
  onModuleDestroy() { if (this.t) clearInterval(this.t); }

  /** Generate (or regenerate) AI title + summary for one incident. Returns null when AI is not configured/failed. */
  /** `feature` = which Settings switch gates this call (background worker vs on-demand regenerate). Local titles are unaffected. */
  async generate(id: string, feature: AiFeature = 'aiIncidentText', by?: { id: string; email: string }): Promise<{ title: string; summary: string } | null> {
    if (!aiConfigured() || !(await aiOn(this.prisma, feature))) return null;
    const i = await this.prisma.incident.findUnique({ where: { id } });
    if (!i) return null;
    await this.prisma.incident.update({ where: { id }, data: { aiAt: new Date() } });
    const r = await llm([{ role: 'system', content: PROMPT }, { role: 'user', content: `Category: ${i.category}\nLGA: ${i.lga}\nLocation: ${i.location}\nReport: ${i.details}` }],
      undefined, { feature: feature === 'aiRegenerate' ? 'regenerate' : 'incident_text', adminId: by?.id, adminEmail: by?.email, ref: i.publicId,
        summary: `${feature === 'aiRegenerate' ? 'Regenerated' : 'Wrote'} title & summary · ${i.category} · ${i.lga}` });
    if (!r || !r.ok || !r.message.content) return null;
    const out = parseAi(r.message.content);
    if (out) await this.prisma.incident.update({ where: { id }, data: { aiTitle: out.title, aiSummary: out.summary || null } });
    return out;
  }

  private async run() {
    if (this.busy || !aiConfigured() || incidentAiEnvOff() || !(await aiOn(this.prisma, 'aiIncidentText'))) return;
    this.busy = true;
    try {
      const retry = new Date(Date.now() - 6 * 3600000);
      const todo = await this.prisma.incident.findMany({ where: { aiTitle: null, OR: [{ aiAt: null }, { aiAt: { lt: retry } }] }, orderBy: { createdAt: 'desc' }, take: 8, select: { id: true } });
      for (const x of todo) await this.generate(x.id);
    } finally { this.busy = false; }
  }
}
