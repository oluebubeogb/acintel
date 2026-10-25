'use client';
import { useCallback, useEffect, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowUpRight, Download, RefreshCw } from 'lucide-react';
import { api, downloadCsv, lagosStamp } from '@/lib/api';
import { LGAS } from './forms';
import { useSearchParams } from 'next/navigation';
import { DrillOverlay } from './overlays';
import { KpiIcon } from './kpi-icons';

type A = { from: string; to: string; totals: { incidents: number; byStatus: Record<string, number>; alarms: Record<string, number>; signups: number; onboarded: number; dispatched: number; avgResolveHours: number | null };
  byCategory: { name: string; count: number }[]; byLga: { name: string; count: number }[]; byAgency: { name: string; count: number }[]; byDay: { day: string; label: string; total: number; resolved: number }[] };
type Drill = { kind: string; title: string; query: Record<string, string> };
type Kpi = { label: string; v: number | string; accent: string; icon: string; tip: string; drill?: Drill };
const back = (n: number) => { const d = new Date(Date.now() - n * 86400000); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(d); };

/** Analytics over any date range; CSV pack = one file with every section. */
export function Analytics() {
  const sp = useSearchParams();
  const [f, setF] = useState({ from: sp.get('from') || back(29), to: sp.get('to') || lagosStamp(), lga: sp.get('lga') || 'All', category: sp.get('category') || 'All' });
  const [cats, setCats] = useState<string[]>([]);
  const [a, setA] = useState<A | null>(null); const [err, setErr] = useState('');
  const [drill, setDrill] = useState<Drill | null>(null);
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
  // Same server filters the analytics endpoint used, so each drill lists exactly the records behind the number.
  const base: Record<string, string> = { from: f.from, to: f.to, ...(f.lga !== 'All' ? { lga: f.lga } : {}) };
  const inc = (extra: Record<string, string> = {}) => ({ ...base, ...(f.category !== 'All' ? { category: f.category } : {}), ...extra });
  const range = a ? `${a.from} → ${a.to}` : '';
  const kpis: Kpi[] = T ? [
    { label: 'Incidents', v: T.incidents, accent: '#2563eb', icon: 'doc', tip: `All reports filed ${range}`, drill: { kind: 'reports.all', title: 'Incidents', query: inc() } },
    { label: 'Resolved', v: T.byStatus.resolved || 0, accent: '#10b981', icon: 'seal', tip: 'Reports closed as resolved', drill: { kind: 'reports.all', title: 'Resolved incidents', query: inc({ status: 'resolved' }) } },
    { label: 'Fake', v: T.byStatus.fake || 0, accent: '#e11d48', icon: 'suspended', tip: 'Reports marked fake', drill: { kind: 'reports.all', title: 'Fake reports', query: inc({ status: 'fake' }) } },
    { label: 'Panic + Duress', v: (T.alarms.panic || 0) + (T.alarms.duress || 0), accent: '#db2777', icon: 'siren', tip: `${T.alarms.panic || 0} panic · ${T.alarms.duress || 0} duress alarms`, drill: { kind: 'alarms.all', title: 'Panic & duress alarms', query: base } },
    { label: 'Signups', v: T.signups, accent: '#7c3aed', icon: 'users', tip: 'New app users registered', drill: { kind: 'users.generate', title: 'User signups', query: base } },
    { label: 'Agents Onboarded', v: T.onboarded, accent: '#0d9488', icon: 'agent', tip: 'Local agents added', drill: { kind: 'agents.all', title: 'Agents onboarded', query: base } },
    { label: 'Dispatches', v: T.dispatched, accent: '#f59e0b', icon: 'truck', tip: 'Agency dispatches made — drill shows the dispatched reports', drill: { kind: 'reports.all', title: 'Dispatched reports', query: inc({ dispatched: '1' }) } },
    { label: 'Avg Hrs to Resolve', v: T.avgResolveHours ?? '—', accent: '#64748b', icon: 'clock', tip: 'Mean hours from report to resolution', drill: { kind: 'reports.all', title: 'Resolved incidents', query: inc({ status: 'resolved' }) } },
  ] : [];
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
        <button className="btn btn-sm btn-primary" disabled={!a} onClick={csv} data-tip="Download every section as one CSV"><Download size={13} /> CSV Pack</button>
      </div>
      {err && <div className="card card-pad" style={{ color: 'var(--rose)', marginBottom: 14 }}>{err}</div>}
      <div className="grid kpis" style={{ marginBottom: 16 }}>
        {!a && Array.from({ length: 8 }).map((_, i) => <div key={i} className="kpi"><div className="skeleton" style={{ width: '50%' }} /><div className="skeleton" style={{ width: '30%', height: 26, marginTop: 10 }} /></div>)}
        {kpis.map((k) => (
          <button key={k.label} className="kpi" style={{ ['--accent' as any]: k.accent }} onClick={() => k.drill && setDrill(k.drill)} data-tip={k.tip}>
            <div className="k-label">{k.label}</div>
            <div className="k-val">{typeof k.v === 'number' ? k.v.toLocaleString('en-NG') : k.v}</div>
            <div className="k-foot">{range}</div>
            <KpiIcon name={k.icon} accent={k.accent} />
            <ArrowUpRight size={15} className="k-go" />
          </button>
        ))}
      </div>
      <div className="grid charts" style={{ marginBottom: 16 }}>
        <div className="card"><div className="card-head"><div><h3>Reports per Day</h3><p>{a ? `${a.from} → ${a.to} (Africa/Lagos)` : '…'}</p></div></div>
          <div className="chart-box">{a && <ResponsiveContainer><AreaChart data={a.byDay} margin={{ top: 16, right: 12, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#edf0f5" /><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#6a7a90' }} minTickGap={18} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#6a7a90' }} /><Tooltip />
            <Area type="monotone" dataKey="total" name="Reports" stroke="#2563eb" fill="rgba(37,99,235,.15)" strokeWidth={2} />
            <Area type="monotone" dataKey="resolved" name="Resolved" stroke="#10b981" fill="rgba(16,185,129,.15)" strokeWidth={2} />
          </AreaChart></ResponsiveContainer>}</div></div>
        <div className="card"><div className="card-head"><div><h3>By Category</h3><p>Report volume</p></div></div>
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
        <div className="card"><div className="card-head"><div><h3>Dispatches by Agency</h3><p>In range</p></div></div>
          <div style={{ padding: '6px 20px 18px', display: 'grid', gap: 8 }}>
            {a && !a.byAgency.length && <div className="hint">No dispatches in this range.</div>}
            {a?.byAgency.map((x) => { const max = Math.max(...a.byAgency.map((y) => y.count)); return (
              <div key={x.name} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 40px', gap: 10, alignItems: 'center', fontSize: 13 }}>
                <b>{x.name}</b><div style={{ height: 8, borderRadius: 8, background: 'var(--surface-2)' }}><div style={{ width: `${(x.count / max) * 100}%`, height: '100%', borderRadius: 8, background: '#2f6fde', transition: 'width 250ms' }} /></div><span>{x.count}</span></div>); })}
          </div></div>
      </div>
      {drill && <DrillOverlay kind={drill.kind} title={drill.title} query={drill.query} onClose={() => setDrill(null)} />}
    </>
  );
}
