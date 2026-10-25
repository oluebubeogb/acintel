/**
 * Hardened OpenAI-compatible chat client (OpenAI, RunPod serverless vLLM, RunPod pods, Together, Groq, Ollama…).
 * - Normalises OPENAI_BASE_URL (strips /chat/completions, adds /openai/v1 for RunPod serverless ids, /v1 when missing).
 * - Timeouts, one retry on 429/5xx/network, RunPod IN_QUEUE/IN_PROGRESS polling, SSE bodies, array/`output` wrappers,
 *   legacy `text`/`tokens` choices, <think> blocks, Hermes-style <tool_call> JSON in content.
 * - If the configured model is not served, discovers one from GET /models (cached).
 * Failures are logged server-side; callers decide what the user sees.
 */
import { Logger } from '@nestjs/common';

export type Msg = { role: string; content: string | null; tool_calls?: any[]; tool_call_id?: string; name?: string };
export type LlmResult = { ok: true; message: Msg } | { ok: false; error: string; status?: number };

const log = new Logger('AI');
let discoveredModel: string | null = null;

export const aiConfigured = () => !!(process.env.OPENAI_BASE_URL || '').trim() && !!(process.env.OPENAI_API_KEY || '').trim();

/** Base URL that ends in /v1 (or similar) — never with /chat/completions. */
export function aiBase(): string | null {
  let b = (process.env.OPENAI_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!b) return null;
  b = b.replace(/\/chat\/completions$/i, '').replace(/\/completions$/i, '').replace(/\/+$/, '');
  const rp = /^(https?:\/\/api\.runpod\.ai\/v2\/[^/]+)(\/.*)?$/i.exec(b);
  if (rp) {
    // https://api.runpod.ai/v2/<id>[/run|/runsync|/openai] → https://api.runpod.ai/v2/<id>/openai/v1
    if (!/\/openai\/v1$/i.test(b)) b = `${rp[1]}/openai/v1`;
  } else if (!/\/v\d+[a-z]*$/i.test(b) && !/\/openai$/i.test(b)) b += '/v1';
  return b;
}
const runpodRoot = (base: string) => /^(https?:\/\/api\.runpod\.ai\/v2\/[^/]+)/i.exec(base)?.[1] || null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const timeoutMs = () => Math.max(5000, Number(process.env.OPENAI_TIMEOUT_MS || 120000));

function headers(key: string) {
  return { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${key}`, 'user-agent': 'AcIntel/1.0' };
}

/** Clean model text: drop <think>…</think> reasoning and stray tags. */
export function cleanContent(s: unknown): string {
  let t = typeof s === 'string' ? s : Array.isArray(s) ? s.map((p: any) => (typeof p === 'string' ? p : p?.text || '')).join('') : '';
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
  if (/<\/think>/i.test(t)) t = t.split(/<\/think>/i).pop() || '';
  if (/^\s*<think>/i.test(t)) t = ''; // unterminated reasoning only
  return t.replace(/<\|[^|>]+\|>/g, '').trim();
}

/** Tool calls some open models emit inside content instead of `tool_calls`. */
export function inlineToolCalls(content: string, known: string[]): { calls: any[]; rest: string } {
  const calls: any[] = [];
  let rest = content;
  const add = (o: any) => {
    const name = o?.name || o?.function?.name || o?.tool;
    if (!name || !known.includes(name)) return false;
    let args = o.arguments ?? o.parameters ?? o.function?.arguments ?? o.args ?? {};
    if (typeof args !== 'string') args = JSON.stringify(args);
    calls.push({ id: `call_${calls.length}_${Date.now().toString(36)}`, type: 'function', function: { name, arguments: args } });
    return true;
  };
  rest = rest.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi, (m, body) => { try { return add(JSON.parse(body)) ? '' : m; } catch { return m; } });
  if (!calls.length) {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(rest)?.[1];
    const candidate = (fenced || rest).trim();
    if (/^[[{]/.test(candidate)) {
      try { const j = JSON.parse(candidate); const arr = Array.isArray(j) ? j : [j]; if (arr.every(add)) rest = fenced ? rest.replace(/```(?:json)?[\s\S]*?```/i, '') : ''; else calls.length = 0; } catch { /* plain text */ }
    }
  }
  return { calls, rest: rest.trim() };
}

/** Parse an SSE (stream) body into a single assistant message. */
function fromSse(text: string): any {
  let content = ''; const tcs: any[] = [];
  for (const line of text.split(/\r?\n/)) {
    const d = line.startsWith('data:') ? line.slice(5).trim() : '';
    if (!d || d === '[DONE]') continue;
    try {
      const j = JSON.parse(d); const ch = j?.choices?.[0]; const delta = ch?.delta || ch?.message || {};
      if (typeof delta.content === 'string') content += delta.content; else if (typeof ch?.text === 'string') content += ch.text;
      for (const t of delta.tool_calls || []) {
        const i = t.index ?? tcs.length; tcs[i] ||= { id: t.id, type: 'function', function: { name: '', arguments: '' } };
        if (t.id) tcs[i].id = t.id; if (t.function?.name) tcs[i].function.name += t.function.name; if (t.function?.arguments) tcs[i].function.arguments += t.function.arguments;
      }
    } catch { /* skip */ }
  }
  return { choices: [{ message: { role: 'assistant', content, tool_calls: tcs.filter(Boolean).length ? tcs.filter(Boolean) : undefined } }] };
}

/** Pull the assistant message out of whatever shape the provider returned. */
export function extractMessage(j: any): { content: string | null; tool_calls?: any[]; reasoning?: string } | null {
  let x = j;
  for (let i = 0; i < 4 && x; i++) {
    if (Array.isArray(x)) { x = x[0]; continue; }
    if (x.choices) break;
    if (x.output !== undefined) { x = x.output; continue; }
    if (x.data?.choices) { x = x.data; continue; }
    break;
  }
  const ch = x?.choices?.[0];
  if (!ch) return null;
  const m = ch.message || ch.delta || {};
  let content: string | null = m.content ?? null;
  if (content == null && typeof ch.text === 'string') content = ch.text;
  if (content == null && Array.isArray(ch.tokens)) content = ch.tokens.join('');
  const tool_calls = Array.isArray(m.tool_calls) && m.tool_calls.length ? m.tool_calls
    : m.function_call ? [{ id: 'call_fc', type: 'function', function: { name: m.function_call.name, arguments: m.function_call.arguments || '{}' } }] : undefined;
  return { content, tool_calls, reasoning: m.reasoning_content || m.reasoning || undefined };
}

async function post(url: string, key: string, body: unknown, deadline: number): Promise<{ status: number; json?: any; text?: string; error?: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(1000, deadline - Date.now()));
  try {
    const r = await fetch(url, { method: 'POST', signal: ctrl.signal, headers: headers(key), body: JSON.stringify(body) });
    const text = await r.text();
    const ct = r.headers.get('content-type') || '';
    let json: any;
    if (ct.includes('text/event-stream') || /^data:/m.test(text.slice(0, 200))) json = fromSse(text);
    else { try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; } }
    return { status: r.status, json, text };
  } catch (e: any) {
    return { status: 0, error: e?.name === 'AbortError' ? 'timed out' : `network error: ${e?.cause?.code || e?.message || e}` };
  } finally { clearTimeout(t); }
}

async function get(url: string, key: string, ms = 15000): Promise<any> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
  try { const r = await fetch(url, { headers: headers(key), signal: ctrl.signal }); return r.ok ? await r.json() : null; } catch { return null; } finally { clearTimeout(t); }
}

/** RunPod async job (IN_QUEUE / IN_PROGRESS) → poll /status/<id> until done or deadline. */
async function pollRunpod(base: string, key: string, first: any, deadline: number) {
  const root = runpodRoot(base); const id = first?.id;
  if (!root || !id) return first;
  let j = first;
  while (j && ['IN_QUEUE', 'IN_PROGRESS'].includes(j.status) && Date.now() < deadline) {
    await sleep(1500);
    j = await get(`${root}/status/${id}`, key, 15000);
  }
  return j;
}

async function pickModel(base: string, key: string): Promise<string | null> {
  const j = await get(`${base}/models`, key);
  const id = j?.data?.[0]?.id || j?.models?.[0]?.id || null;
  if (id) { discoveredModel = id; log.warn(`OPENAI_MODEL not served by the provider — using "${id}" from /models`); }
  return id;
}

/** One chat completion. Returns null when not configured. */
export async function llm(messages: Msg[], tools?: any[]): Promise<LlmResult | null> {
  const base = aiBase(); const key = (process.env.OPENAI_API_KEY || '').trim();
  if (!base || !key) return null;
  const url = `${base}/chat/completions`;
  const deadline = Date.now() + timeoutMs();
  let model = discoveredModel || (process.env.OPENAI_MODEL || '').trim() || 'gpt-4o-mini';
  const body = () => ({
    model, messages, temperature: 0.1, stream: false, max_tokens: Number(process.env.OPENAI_MAX_TOKENS || 1024),
    ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
  });
  let lastErr = '';
  for (let attempt = 0; attempt < 3 && Date.now() < deadline; attempt++) {
    const r = await post(url, key, body(), deadline);
    if (r.status === 0) {
      lastErr = r.error || 'unreachable';
      log.warn(`AI request failed (${lastErr}) → ${url}`);
      if (lastErr === 'timed out') break;
      await sleep(1200); continue;
    }
    if (r.status >= 200 && r.status < 300) {
      let j = r.json;
      if (j && ['IN_QUEUE', 'IN_PROGRESS'].includes(j.status)) j = await pollRunpod(base, key, j, deadline);
      if (j?.status === 'FAILED' || j?.error) { lastErr = `provider error: ${String(j?.error?.message || j?.error || 'FAILED').slice(0, 200)}`; log.warn(lastErr); break; }
      const m = extractMessage(j);
      if (!m) { lastErr = 'unrecognised reply shape'; log.warn(`AI reply had no choices: ${String(r.text || '').slice(0, 400)}`); break; }
      return { ok: true, message: { role: 'assistant', content: m.content, tool_calls: m.tool_calls } };
    }
    const detail = String(r.json?.error?.message || r.json?.message || r.json?.detail || r.text || '').slice(0, 300);
    log.warn(`AI provider ${r.status} (model ${model}) → ${url}: ${detail}`);
    lastErr = `AI provider returned ${r.status}`;
    if ((r.status === 404 || r.status === 400) && /model/i.test(detail) && attempt === 0) {
      const m = await pickModel(base, key); if (m && m !== model) { model = m; continue; }
    }
    if (r.status === 429 || r.status >= 500) { await sleep(1500 * (attempt + 1)); continue; }
    return { ok: false, status: r.status, error: lastErr };
  }
  return { ok: false, error: lastErr || 'AI provider timed out' };
}

/** Strict chat templates reject consecutive same-role turns and empty messages. */
export function tidyHistory(msgs: { role: string; content: string }[]): Msg[] {
  const out: Msg[] = [];
  for (const m of msgs) {
    const c = (m.content || '').trim();
    if (!c || !['user', 'assistant'].includes(m.role)) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) prev.content = `${prev.content}\n\n${c}`;
    else out.push({ role: m.role, content: c });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}
