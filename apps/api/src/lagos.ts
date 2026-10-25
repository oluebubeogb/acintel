/** Africa/Lagos helpers. WAT is a fixed UTC+1 (no DST), which keeps day maths exact. */
export const LAGOS = 'Africa/Lagos';
const OFFSET_MS = 60 * 60 * 1000;

export const fmt = (d?: Date | null) => d ? new Intl.DateTimeFormat('en-GB', {
  timeZone: LAGOS, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
}).format(d) : '—';
export const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: LAGOS }).format(d);
export const dayLabel = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: LAGOS, day: '2-digit', month: 'short' }).format(d);
export const longDay = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: LAGOS, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);

/** Start of the Lagos calendar day "YYYY-MM-DD" as a UTC instant. */
export function lagosDayStart(key: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) throw new Error('date must be YYYY-MM-DD');
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - OFFSET_MS);
}
export const lagosDayRange = (key: string) => { const s = lagosDayStart(key); return { gte: s, lt: new Date(s.getTime() + 86400000) }; };

export type Period = 'today' | 'yesterday' | 'this_week' | 'last_7_days' | 'this_month' | 'last_30_days' | 'last_90_days' | 'this_year' | 'all';
export const PERIODS: Period[] = ['today', 'yesterday', 'this_week', 'last_7_days', 'this_month', 'last_30_days', 'last_90_days', 'this_year', 'all'];

/** Resolve a named period or from/to (YYYY-MM-DD, inclusive) into a createdAt range. */
export function rangeFor(period?: string | null, from?: string | null, to?: string | null): { gte?: Date; lt?: Date } | undefined {
  if (from || to) {
    const r: { gte?: Date; lt?: Date } = {};
    if (from) r.gte = lagosDayStart(from);
    if (to) r.lt = new Date(lagosDayStart(to).getTime() + 86400000);
    return r;
  }
  if (!period || period === 'all') return undefined;
  const today = lagosDayStart(dayKey(new Date()));
  const day = 86400000;
  switch (period) {
    case 'today': return { gte: today };
    case 'yesterday': return { gte: new Date(today.getTime() - day), lt: today };
    case 'this_week': { // ISO week, Monday start (Lagos)
      const dow = (new Date(today.getTime() + OFFSET_MS).getUTCDay() + 6) % 7;
      return { gte: new Date(today.getTime() - dow * day) };
    }
    case 'last_7_days': return { gte: new Date(today.getTime() - 6 * day) };
    case 'this_month': { const k = dayKey(new Date()); return { gte: lagosDayStart(k.slice(0, 8) + '01') }; }
    case 'last_30_days': return { gte: new Date(today.getTime() - 29 * day) };
    case 'last_90_days': return { gte: new Date(today.getTime() - 89 * day) };
    case 'this_year': return { gte: lagosDayStart(dayKey(new Date()).slice(0, 4) + '-01-01') };
    default: return undefined;
  }
}
export const periodLabel = (p?: string | null) => (p || 'all').replace(/_/g, ' ');
