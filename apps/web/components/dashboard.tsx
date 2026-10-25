'use client';
import { useEffect, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell as PieCell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, ArrowUpRight, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHead } from './shell';
import { DrillOverlay } from './overlays';
import { useApp } from './providers';
import { KpiIcon, type KpiIconName } from './kpi-icons';

type Summary = { incidents: Record<string, number>; agents: Record<string, number>; users: Record<string, number>; alarms: Record<string, number>; alarmsNew: Record<string, number>; periodTotal?: number;
  trend: { label: string; new: number; dispatched: number; acted: number; resolved: number }[]; lga: { lga: string; count: number }[]; at: string };
const SERIES = [
  { key: 'new', label: 'New', color: '#2563eb' }, { key: 'dispatched', label: 'Dispatched', color: '#7c3aed' },
  { key: 'acted', label: 'Acted Upon', color: '#f59e0b' }, { key: 'resolved', label: 'Resolved', color: '#10b981' },
] as const;

function Tip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tip"><b>{label}</b>{payload.map((p: any) => <div key={p.dataKey}><em><span className="dot" style={{ color: p.color || p.payload?.fill, marginRight: 6 }} />{p.name}</em><span>{p.value}</span></div>)}</div>;
}

export function Dashboard() {
  const { counts } = useApp();
  const [s, setS] = useState<Summary | null>(null);
  const [off, setOff] = useState<string[]>([]);
  const [drill, setDrill] = useState<{ kind: string; title: string; href: string } | null>(null);
  const [days, setDays] = useState(14);
  const load = () => api<Summary>(`/dashboard/summary?days=${days}`).then(setS).catch(() => undefined);
  useEffect(() => { load(); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps
  // Realtime: refresh when any record changes (SSE → window event).
  useEffect(() => { let t: any; const h = () => { clearTimeout(t); t = setTimeout(load, 600); }; window.addEventListener('acintel:changed', h); return () => { window.removeEventListener('acintel:changed', h); clearTimeout(t); }; }, [days]);

  const n = (o: Record<string, number> | undefined, k: string) => o?.[k] || 0;
  // KPI numbers tick live from /counts (polled while visible + SSE push); charts come from /dashboard/summary.
  const K = s ? (counts.kpi ? { ...s, ...counts.kpi } : s) : null;
  const kpis: { label: string; v: number; accent: string; kind: string; href: string; foot: string; icon: KpiIconName }[] = K ? [
    { label: 'New Incidents', v: n(K.incidents, 'new'), accent: '#2563eb', kind: 'reports.new', href: '/reports/new', foot: 'Awaiting dispatch', icon: 'doc' },
    { label: 'Dispatched', v: n(K.incidents, 'dispatched'), accent: '#7c3aed', kind: 'reports.dispatched', href: '/reports/dispatched', foot: 'With agencies', icon: 'truck' },
    { label: 'Acted Upon', v: n(K.incidents, 'acted'), accent: '#f59e0b', kind: 'reports.acted', href: '/reports/acted', foot: 'In progress', icon: 'checklist' },
    { label: 'Resolved', v: n(K.incidents, 'resolved'), accent: '#10b981', kind: 'reports.resolved', href: '/reports/resolved', foot: n(K.incidents, 'fake') ? `Closed · ${n(K.incidents, 'fake')} marked fake` : 'Closed', icon: 'seal' },
    { label: 'Active Agents', v: n(K.agents, 'active'), accent: '#0d9488', kind: 'agents.active', href: '/agents/active', foot: `${n(K.agents, 'online')} online · ${n(K.agents, 'unassigned')} un-assigned`, icon: 'agent' },
    { label: 'Suspended Agents', v: n(K.agents, 'suspended'), accent: '#e11d48', kind: 'agents.suspended', href: '/agents/suspended', foot: 'Click to review', icon: 'suspended' },
    { label: 'Pending Users', v: n(K.users, 'pending'), accent: '#f97316', kind: 'users.pending', href: '/users/pending', foot: `${n(K.users, 'active')} active users`, icon: 'pending' },
    { label: 'Alarms', v: n(K.alarmsNew, 'panic') + n(K.alarmsNew, 'duress'), accent: '#db2777', kind: 'alarms.new', href: '/alarms/new', foot: `New: ${n(K.alarmsNew, 'panic')} panic · ${n(K.alarmsNew, 'duress')} duress`, icon: 'siren' },
  ] : [];
  const agentPie = s ? [
    { name: 'Active', value: n(s.agents, 'active'), fill: '#10b981', kind: 'agents.active', href: '/agents/active' },
    { name: 'Suspended', value: n(s.agents, 'suspended'), fill: '#e11d48', kind: 'agents.suspended', href: '/agents/suspended' },
  ] : [];
  const userPie = s ? [
    { name: 'Active', value: n(s.users, 'active'), fill: '#2563eb', kind: 'users.active', href: '/users/active' },
    { name: 'Pending', value: n(s.users, 'pending'), fill: '#f59e0b', kind: 'users.pending', href: '/users/pending' },
    { name: 'Suspended', value: n(s.users, 'suspended'), fill: '#94a3b8', kind: 'users.suspended', href: '/users/suspended' },
  ] : [];

  return (
    <>
      <PageHead title="Control Room Overview"
        actions={<>
          <div className="seg" role="group" aria-label="Chart period">{[7, 14, 30, 90].map((d) => <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)} data-tip={`Charts over the last ${d} days`}>{d}d</button>)}</div>
          <button className="btn" onClick={load} data-tip="Refresh now"><RefreshCw size={15} /> Refresh</button></>} />
      <div className="grid kpis" style={{ marginBottom: 16 }}>
        {!s && Array.from({ length: 8 }).map((_, i) => <div key={i} className="kpi"><div className="skeleton" style={{ width: '50%' }} /><div className="skeleton" style={{ width: '30%', height: 26, marginTop: 10 }} /></div>)}
        {kpis.map((k) => (
          <button key={k.label} className="kpi" style={{ ['--accent' as any]: k.accent }} onClick={() => setDrill({ kind: k.kind, title: k.label, href: k.href })} data-tip={`${k.foot} · click to drill into ${k.v.toLocaleString('en-NG')}`}>
            <div className="k-label">{k.label}</div>
            <div className="k-val" key={k.v} data-live="1">{k.v.toLocaleString('en-NG')}</div>
            <div className="k-foot">{k.foot}</div>
            <KpiIcon name={k.icon} accent={k.accent} />
            <ArrowUpRight size={15} className="k-go" />
          </button>
        ))}
      </div>
      <div className="grid charts" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-head"><div><h3>Incident pipeline · last {days} days</h3><p>New → Dispatched → Acted upon → Resolved, by report date</p></div>
            <div className="legend">{SERIES.map((x) => <span key={x.key} className={off.includes(x.key) ? 'off' : ''} onClick={() => setOff((o) => (o.includes(x.key) ? o.filter((k) => k !== x.key) : [...o, x.key]))} data-tip="Toggle series"><i style={{ background: x.color }} />{x.label}</span>)}</div></div>
          <div className="chart-box">
            {s && <ResponsiveContainer><AreaChart data={s.trend} margin={{ top: 16, right: 12, left: -16, bottom: 0 }}>
              <defs>{SERIES.map((x) => <linearGradient key={x.key} id={`g-${x.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={x.color} stopOpacity={0.28} /><stop offset="1" stopColor={x.color} stopOpacity={0} /></linearGradient>)}</defs>
              <CartesianGrid vertical={false} stroke="#edf0f5" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#6a7a90' }} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#6a7a90' }} />
              <Tooltip content={<Tip />} cursor={{ stroke: '#cbd5e1', strokeDasharray: 4 }} />
              {SERIES.filter((x) => !off.includes(x.key)).map((x) => <Area key={x.key} type="monotone" dataKey={x.key} name={x.label} stackId="1" stroke={x.color} strokeWidth={2} fill={`url(#g-${x.key})`} animationDuration={600} />)}
            </AreaChart></ResponsiveContainer>}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div><h3>Agents & Users</h3><p>Click a slice to drill down</p></div></div>
          <div className="chart-box" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            {s && [['Agents', agentPie], ['Users', userPie]].map(([name, data]: any) => (
              <div key={name} style={{ position: 'relative' }}>
                <ResponsiveContainer><PieChart>
                  <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="82%" paddingAngle={3} stroke="none" animationDuration={600} style={{ cursor: 'pointer' }}
                    onClick={(d: any) => setDrill({ kind: d.kind, title: `${d.name} ${name.toLowerCase()}`, href: d.href })}>
                    {data.map((d: any) => <PieCell key={d.name} fill={d.fill} />)}
                  </Pie>
                  <Tooltip content={<Tip />} />
                </PieChart></ResponsiveContainer>
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center' }}>
                  <div><b style={{ fontSize: 20 }}>{data.reduce((a: number, d: any) => a + d.value, 0)}</b><div className="hint">{name}</div></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="grid charts">
        <div className="card">
          <div className="card-head"><div><h3>Reports by LGA</h3><p>Top local government areas · last {days} days</p></div></div>
          <div className="chart-box" style={{ height: 260 }}>
            {s && <ResponsiveContainer><BarChart data={s.lga} margin={{ top: 16, right: 12, left: -16, bottom: 0 }}>
                            <CartesianGrid vertical={false} stroke="#edf0f5" />
              <XAxis dataKey="lga" tickLine={false} axisLine={false} tick={{ fontSize: 10.5, fill: '#6a7a90' }} interval={0} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#6a7a90' }} />
              <Tooltip content={<Tip />} cursor={{ fill: 'rgba(37,99,235,.06)' }} />
              <Bar dataKey="count" name="Reports" fill="#2f6fde" radius={[6, 6, 0, 0]} maxBarSize={36} animationDuration={600} />
            </BarChart></ResponsiveContainer>}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div><h3>Live New-Ins</h3><p>Unread across the platform</p></div></div>
          <div style={{ padding: '12px 20px 18px', display: 'grid', gap: 8 }}>
            {[['users.pending', 'New User Signups', '/users/pending'], ['reports.new', 'New Reports', '/reports/new'], ['alarms.new', 'New Alarms', '/alarms/new'], ['agents.unassigned', 'Agents to Assign', '/agents/unassigned']].map(([k, l, h]) => (
              <button key={k} className="side-link" style={{ justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setDrill({ kind: k, title: l, href: h })}>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Activity size={15} color="var(--blue)" />{l}</span>
                <span className={`chip ${counts.targets[k] ? 'rose' : ''}`}>{counts.targets[k] || 0} new</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      {drill && <DrillOverlay {...drill} onClose={() => setDrill(null)} />}
    </>
  );
}
