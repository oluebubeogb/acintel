/**
 * Site-level AI feature switches (Settings → AI). OPENAI_* env supplies the provider; these prefs decide whether
 * AcIntel actually *uses* it. Read from the DB with a short cache (≤ 3s) so a Pause takes effect without an API restart;
 * PrefsController calls invalidateAiFlags() on every save so the change is immediate on this instance.
 */
import { PrismaService } from './prisma.service';

export const AI_FLAG_DEFAULTS = {
  aiEnabled: true, // master switch — when false every AI feature below is paused
  aiIncidentText: true, // background Report Titles & Summaries (IncidentAiWorker)
  aiChat: true, // Control Room Chat (AcIntel Assist uses the provider)
  aiRegenerate: true, // On-Demand Regenerate (POST /incidents/:id/ai)
};
export type AiFlagKey = keyof typeof AI_FLAG_DEFAULTS;
export type AiFeature = Exclude<AiFlagKey, 'aiEnabled'>;
export const AI_FLAG_KEYS = Object.keys(AI_FLAG_DEFAULTS) as AiFlagKey[];

let cache: { at: number; v: Record<AiFlagKey, boolean> } | null = null;
const TTL = 3000;

export function invalidateAiFlags() { cache = null; }

/** Raw stored switches (defaults applied). */
export async function aiFlags(prisma: PrismaService): Promise<Record<AiFlagKey, boolean>> {
  if (cache && Date.now() - cache.at < TTL) return cache.v;
  const v = { ...AI_FLAG_DEFAULTS };
  try {
    const rows = await prisma.preference.findMany({ where: { scope: 'site', key: { in: AI_FLAG_KEYS } } });
    for (const r of rows) v[r.key as AiFlagKey] = r.value !== false && r.value !== 'false';
  } catch { /* DB hiccup → keep defaults */ }
  cache = { at: Date.now(), v };
  return v;
}

/** True when the feature is switched on in Settings (master switch AND the feature's own switch). */
export async function aiOn(prisma: PrismaService, f: AiFeature): Promise<boolean> {
  const v = await aiFlags(prisma);
  return v.aiEnabled && v[f];
}

/** Env hard-off for the background worker (INCIDENT_AI=false). */
export const incidentAiEnvOff = () => process.env.INCIDENT_AI === 'false';
