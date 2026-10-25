'use client';
import { useCallback, useEffect, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, RefreshCw } from 'lucide-react';
import { api, downloadCsv, lagosStamp } from '@/lib/api';
import { LGAS } from './forms';
import { useSearchParams } from 'next/navigation';

type A = { from: string; to: string; totals: { incidents: number; byStatus: Record<string, number>; alarms: Record<string, number>; signups: number; onboarded: number; dispatched: number; avgResolveHours: number | null };
  byCategory: { name: string; count: number }[]; byLga: { name: string; count: number }[]; byAgency: { name: string; count: number }[]; byDay: { day: string; label: string; total: number; resolved: number }[] };
const back = (n: number) => { const d = new Date(Date.now() - n * 86400000); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(d); };

/** Analytics over any date range; CSV pack = one file with every section. */
export function Analytics() {
  const sp = useSearchParams();
  const [f, setF] = useState({ from: sp.get('from') || back(29), to: sp.get('to') || lagosStamp(), lga: sp.get('lga') || 'All', category: sp.get('category') || 'All' });
  const [cats, setCats] = useState<string[]>([]);
  const [a, setA] = useState<A | null>(null); const [err, setErr] = useState('');
  useEffect(() => { api<{ name: string }[]>('/categories').then((c) => setCats(c.map((x) => x.name))).catch(() => undefined); }, []);
  const load = useCallback(() => {
    setErr(''); const q = new URLSearchParams({ from: f.from, to: f.to }); if (f.lga !== 'All') q.set('lga', f.lga); if (f.category !== 'All') q.set('category', f.category);
    api<A>(`/analytics?${q}`).then(setA).catch((e) => setErr(e.message));
  }, [f]);
  useEffect(() => { load(); }, [load]);
  const csv = () => {
    if (!a) return;
    const rows: Record<string, unknown>[] = [
      { section: 'Range', name: `${a.from} → ${a.to}`, value: '' }, { section: 'Filter', name: `LGA ${f.lga} · Category ${f.category}`, value: '' },
      { section: 'Totals', name: 'Incidents', value: a.totals.incidents }, ...Object.entries(a.totals.byStatus).map(([k, v]) => ({ section: 'Totals', name: `Incidents ${k}`, value: v })),
      ...Object.entries(a.totals.alarms).map(([k, v]) => ({ section: 'Totals', name: `${k} alarms`, value: v })),
      { section: 'Totals', name: 'User signups', value: a.totals.signups }, { section: 'Totals', name: 'Agents onboarded', value: a.totals.onboarded },
      { section: 'Totals', name: 'Dispatches', value: a.totals.dispatched }, { section: 'Totals', name: 'Avg hours to resolve', value: a.totals.avgResolveHours ?? '' },
      ...a.byCategory.map((x) => ({ section: 'By category', name: x.name, value: x.count })), ...a.byLga.map((x) => ({ section: 'By LGA', name: x.name, value: x.count })),
      ...a.byAgency.map((x) => ({ section: 'By agency', name: x.name, value: x.count })), ...a.byDay.map((x) => ({ section: 'By day', name: x.day, value: x.total, resolved: x.resolved })),
    ];
    downloadCsv(`analytics-${a.from}-to-${a.to}`, [{ key: 'section', label: 'Section' }, { key: 'name', label: 'Name' }, { key: 'value', label: 'Value' }, { key: 'resolved', label: 'Resolved' }], rows);
  };
  const s = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const T = a?.totals;
  const stats: [string, number | string, string][] = T ? [['Incidents', T.incidents, '#2563eb'], ['Resolved', T.byStatus.resolved || 0, '#10b981'], ['Fake', T.byStatus.fake || 0, '#e11d48'], ['Panic + duress', (T.alarms.panic || 0) + (T.alarms.duress || 0), '#db2777'],
    ['Signups', T.signups, '#7c3aed'], ['Agents onboarded', T.onboarded, '#0d9488'], ['Dispatches', T.dispatched, '#f59e0b'], ['Avg hrs to resolve', T.avgResolveHours ?? '—', '#64748b']] : [];
  return (
    <>
      <div className="filters card">
        <label><span>From</span><input type="date" className="input" value={f.from} max={f.to} onChange={s('from')} /></label>
        <label><span>To</span><input type="date" className="input" value={f.to} min={f.from} onChange={s('to')} /></label>
        <label><span>LGA</span><select className="select" value={f.lga} onChange={s('lga')}>{['All', ...LGAS].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label><span>Category</span><select className="select" value={f.category} onChange={s('category')}>{['All', ...cats].map((x) => <option key={x}>{x}</option>)}</select></label>
        {[7, 30, 90].map((n) => <button key={n} className="btn btn-sm" onClick={() => setF({ ...f, from: back(n - 1), to: lagosStamp() })}>{n}d</button>)}
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={load} data-tip="Re-run"><RefreshCw size={13} /></button>
        <button className="btn btn-sm btn-primary" disabled={!a} onClick={csv} data-tip="Download every section as one CSV"><Download size={13} /> CSV pack</button>
      </div>
      {err && <div className="card card-pad" style={{ color: 'var(--rose)', marginBottom: 14 }}>{err}</div>}
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        {!a && Array.from({ length: 8 }).map((_, i) => <div key={i} className="stat"><div className="skeleton" style={{ width: '60%' }} /></div>)}
        {stats.map(([l, v, c]) => <div key={l} className="stat" style={{ ['--accent' as any]: c }}><span>{l}</span><b>{typeof v === 'number' ? v.toLocaleString('en-NG') : v}</b></div>)}
      </div>
      <div className="grid charts" style={{ marginBottom: 16 }}>
        <div className="card"><div className="card-head"><div><h3>Reports per day</h3><p>{a ? `${a.from} → ${a.to} (Africa/Lagos)` : '…'}</p></div></div>
          <div className="chart-box">{a && <ResponsiveContainer><AreaChart data={a.byDay} margin={{ top: 16, right: 12, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#edf0f5" /><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#6a7a90' }} minTickGap={18} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#6a7a90' }} /><Tooltip />
            <Area type="monotone" dataKey="total" name="Reports" stroke="#2563eb" fill="rgba(37,99,235,.15)" strokeWidth={2} />
            <Area type="monotone" dataKey="resolved" name="Resolved" stroke="#10b981" fill="rgba(16,185,129,.15)" strokeWidth={2} />
          </AreaChart></ResponsiveContainer>}</div></div>
        <div className="card"><div className="card-head"><div><h3>By category</h3><p>Report volume</p></div></div>
          <div className="chart-box">{a && <ResponsiveContainer><BarChart data={a.byCategory} layout="vertical" margin={{ top: 8, right: 16, left: 30, bottom: 0 }}>
            <XAxis type="number" hide /><YAxis type="category" dataKey="name" width={120} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#475569' }} /><Tooltip />
            <Bar dataKey="count" name="Reports" fill="#7c3aed" radius={[0, 6, 6, 0]} maxBarSize={18} /></BarChart></ResponsiveContainer>}</div></div>
      </div>
      <div className="grid charts" style={{ marginBottom: 16 }}>
        <div className="card"><div className="card-head"><div><h3>By LGA</h3><p>All 17 LGAs</p></div></div>
          <div className="chart-box" style={{ height: 260 }}>{a && <ResponsiveContainer><BarChart data={a.byLga} margin={{ top: 16, right: 12, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#edf0f5" /><XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#6a7a90' }} interval={0} angle={-25} textAnchor="end" height={60} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#6a7a90' }} /><Tooltip />
            <Bar dataKey="count" name="Reports" fill="#0d9488" radius={[6, 6, 0, 0]} maxBarSize={30} /></BarChart></ResponsiveContainer>}</div></div>
        <div className="card"><div className="card-head"><div><h3>Dispatches by agency</h3><p>In range</p></div></div>
          <div style={{ padding: '6px 20px 18px', display: 'grid', gap: 8 }}>
            {a && !a.byAgency.length && <div className="hint">No dispatches in this range.</div>}
            {a?.byAgency.map((x) => { const max = Math.max(...a.byAgency.map((y) => y.count)); return (
              <div key={x.name} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 40px', gap: 10, alignItems: 'center', fontSize: 13 }}>
                <b>{x.name}</b><div style={{ height: 8, borderRadius: 8, background: 'var(--surface-2)' }}><div style={{ width: `${(x.count / max) * 100}%`, height: '100%', borderRadius: 8, background: 'linear-gradient(90deg,#2563eb,#10b981)', transition: 'width 250ms' }} /></div><span>{x.count}</span></div>); })}
          </div></div>
      </div>
    </>
  );
}
