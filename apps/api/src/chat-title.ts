/**
 * Short conversation titles for AcIntel Assist sessions (≈3–7 words, Title Case).
 * localChatTitle() is the deterministic fallback (no AI / AI paused); TITLE_PROMPT + cleanTitle() handle the LLM path.
 */
import { LGAS } from './geo';

const GREETING = /^(hi+|hello+|hey+|yo|good (morning|afternoon|evening|day)|thanks?( you)?|ok(ay)?|test(ing)?|ping|sup|how are you\??)[\s!.?,]*$/i;
const SMALL = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'for', 'and', 'or', 'to', 'by', 'at', 'vs', 'with', 'from']);
const FILLER = /\b(please|pls|kindly|can you|could you|would you|i want( you)? to|i need( you)? to|i'd like( you)? to|help me|for me|give me|show me|tell me|let me know|get me|generate|create|make|produce|prepare|me|us|all( of)?( the)?|the|a|an|some|list of|now|quickly)\b/gi;

export const PLACEHOLDER_TITLE = 'New Conversation';
export const isSmallTalk = (s: string) => GREETING.test(s.trim()) || s.trim().length < 3;

export function titleCaseWords(s: string) {
  return s.split(/\s+/).filter(Boolean).map((w, i) => {
    if (/^[A-Z0-9]{2,}$/.test(w)) return w; // CSV, LGA, ECC
    const l = w.toLowerCase();
    if (i > 0 && SMALL.has(l)) return l;
    return l.charAt(0).toUpperCase() + l.slice(1);
  }).join(' ');
}

const ENTITIES: [RegExp, string][] = [
  [/\bvigilante|agents?\b/i, 'Agents'], [/\busers?|residents?|citizens?\b/i, 'Users'], [/\balarms?|panic|duress\b/i, 'Alarms'],
  [/\b(security )?alerts?\b/i, 'Security Alerts'], [/\btips?\b/i, 'Tips'], [/\bcall ?cent(re|er)\b/i, 'Call Centre Reports'], [/\becc\b/i, 'ECC Reports'],
  [/\breports?|incidents?|cases?\b/i, 'Reports'], [/\badmins?\b/i, 'Admins'], [/\bgroups?\b/i, 'Groups'],
];
const STATUS = /\b(active|suspended|pending|new|acted|resolved|fake|unassigned|assigned)\b/i;
const PERIOD: [RegExp, string][] = [[/\btoday\b/i, 'Today'], [/\byesterday\b/i, 'Yesterday'], [/\bthis week\b/i, 'This Week'], [/\blast (7|seven) days\b/i, 'Last 7 Days'], [/\bthis month\b/i, 'This Month'], [/\blast (30|thirty) days\b/i, 'Last 30 Days'], [/\bthis year\b/i, 'This Year']];

/** Deterministic intent-based title, e.g. "Generate a CSV of all Umuahia North agents" → "Umuahia North Agents CSV Export". */
export function localChatTitle(message: string): string {
  const m = message.replace(/\s+/g, ' ').trim();
  if (!m || isSmallTalk(m)) return PLACEHOLDER_TITLE;
  const ent = ENTITIES.find(([re]) => re.test(m))?.[1];
  const lga = [...LGAS].sort((a, b) => b.length - a.length).find((l) => new RegExp(`\\b${l.replace(/ /g, '\\s+')}\\b`, 'i').test(m))
    || (/\bumua\w*/i.test(m) ? 'Umuahia' : /\baba\b/i.test(m) ? 'Aba' : undefined);
  const status = STATUS.exec(m)?.[1];
  const period = PERIOD.find(([re]) => re.test(m))?.[1];
  if (ent) {
    const subject = [status && titleCaseWords(status), ent].filter(Boolean).join(' ');
    const where = lga ? `${lga} ` : '';
    let t: string;
    if (/\b(csv|export|download|spreadsheet|excel)\b/i.test(m)) t = `${where}${subject} CSV Export`;
    else if (/\b(how many|count|number of|total)\b/i.test(m)) t = `${where}${subject} Count`;
    else if (/\b(trend|compare|breakdown|by lga|by category|per|analy[sz]e|analysis)\b/i.test(m)) t = `${where}${subject} Breakdown`;
    else if (/\b(list|show|which|who|find|top|latest|recent)\b/i.test(m)) t = `${where}${subject} List`;
    else t = `${where}${subject} Overview`;
    if (period && t.split(' ').length < 6) t += ` ${period}`;
    return clipWords(t, 7);
  }
  const words = m.replace(/[?!.,;:"'`()[\]]/g, ' ').replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  return clipWords(titleCaseWords(words || m), 6) || PLACEHOLDER_TITLE;
}

function clipWords(s: string, max: number) { return s.split(/\s+/).filter(Boolean).slice(0, max).join(' ').slice(0, 60).trim(); }

export const TITLE_PROMPT = 'You name chat conversations for a state security control-room assistant. Reply with ONLY a short title of 3 to 6 words in Title Case ' +
  'that describes what the admin wanted (e.g. "Umuahia North Agents CSV Export", "New Reports Count This Week"). No quotes, no emoji, no trailing punctuation. ' +
  'If there is no real topic yet (just a greeting or small talk), reply with exactly NONE.';

/** Validate an LLM title; null = unusable (fall back to local). */
export function cleanTitle(raw: string | null | undefined): string | null {
  let t = String(raw || '').split('\n').map((x) => x.trim()).find(Boolean) || '';
  t = t.replace(/^(title|conversation title)\s*[:\-]\s*/i, '').replace(/^["'“”‘’*_#\s]+|["'“”‘’*_.!?:;,\s]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!t || /^none$/i.test(t)) return null;
  const words = t.split(' ');
  if (words.length < 2 || words.length > 8 || t.length > 64) return null;
  return titleCaseWords(t);
}
