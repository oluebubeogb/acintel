export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T = any>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init || {};
  const r = await fetch(`/api${path}`, {
    credentials: 'same-origin', cache: 'no-store', ...rest,
    headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...(rest.headers || {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (r.status === 401 && typeof window !== 'undefined' && !location.pathname.startsWith('/login')) {
    location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
  }
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new ApiError(r.status, (data && (Array.isArray(data.message) ? data.message.join(', ') : data.message)) || r.statusText);
  return data as T;
}

export function toCsv(columns: { key: string; label: string }[], rows: Record<string, unknown>[]) {
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(','))].join('\n');
}
export function downloadCsv(name: string, columns: { key: string; label: string }[], rows: Record<string, unknown>[]) {
  const blob = new Blob([toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${lagosStamp()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export const LAGOS = 'Africa/Lagos';
export const lagosStamp = () => new Intl.DateTimeFormat('en-CA', { timeZone: LAGOS }).format(new Date());
export const lagosTime = (d: Date | string) => new Intl.DateTimeFormat('en-GB', {
  timeZone: LAGOS, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h12',
}).format(new Date(d));
export function timeAgo(d: string | Date) {
  const s = Math.max(1, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return `${s}s ago`; const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`; return lagosTime(d);
}

/** "Acted upon reports" → "Acted Upon Reports" (keeps acronyms like LGA, CSV; small joining words stay lower). */
const SMALL = new Set(['a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'by', 'for', 'the', 'as', 'at', 'vs']);
export const titleCase = (s: string) => s.replace(/[A-Za-z][\w'’]*/g, (w, i: number) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1)));
