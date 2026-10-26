'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bot, FileText, MessageSquare, RefreshCw, RotateCcw, ShieldAlert, Sparkles, Tag } from 'lucide-react';
import { PageHead } from '@/components/shell';
import { DataTable } from '@/components/ui';
import { KpiIcon } from '@/components/kpi-icons';
import { useApp } from '@/components/providers';
import { api, lagosStamp } from '@/lib/api';

type Col = { key: string; label: string };
type Usage = {
  stats: { calls: number; failed: number; promptTokens: number; completionTokens: number; totalTokens: number; durationMs: number; avgMs: number };
  byFeature: { feature: string; label: string; calls: number; tokens: number; durationMs: number }[];
  features: { value: string; label: string }[]; admins: string[];
  columns: Col[]; rows: Record<string, any>[]; total: number;
};
const back = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date(Date.now() - n * 86400000));
const dur = (ms: number) => (ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : ms < 3600000 ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s` : `${(ms / 3600000).toFixed(1)} h`);
const num = (n: number) => n.toLocaleString('en-NG');
const FEAT: Record<string, { icon: React.ReactNode; acc: string }> = {
  chat: { icon: <MessageSquare size={16} />, acc: '#2563eb' }, chat_title: { icon: <Tag size={16} />, acc: '#7c3aed' },
  incident_text: { icon: <FileText size={16} />, acc: '#0d9488' }, regenerate: { icon: <Sparkles size={16} />, acc: '#d97706' }, other: { icon: <Bot size={16} />, acc: '#64748b' },
};
const INIT = { from: back(6), to: lagosStamp(), feature: '', admin: '', status: '' };

export default function AiUsagePage() {
  const { can, me, toast } = useApp();
  const [f, setF] = useState(INIT);
  const [data, setData] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    const qs = new URLSearchParams(Object.entries({ ...f, take: '5000' }).filter(([, v]) => v) as [string, string][]);
    setLoading(true);
    api<Usage>(`/ai/usage?${qs}`).then(setData).catch((e) => toast(e.message, 'error')).finally(() => setLoading(false));
  }, [f, toast]);
  useEffect(() => { if (can('settings.site')) load(); }, [load, can]);

  if (me && !can('settings.site')) return <div className="card card-pad empty"><ShieldAlert size={28} /><b>AI usage is restricted</b><div className="hint">Only a superadmin can view AI usage.</div></div>;
  const s = data?.stats;
  const set = (k: keyof typeof INIT) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const range = `${f.from || '…'} → ${f.to || 'today'}`;
  const kpis = s ? [
    { label: 'AI Calls', v: num(s.calls), foot: range, accent: '#2563eb', icon: 'chart', tip: 'Every request AcIntel sent to the AI provider' },
    { label: 'Tokens Used', v: num(s.totalTokens), foot: `${num(s.promptTokens)} in · ${num(s.completionTokens)} out`, accent: '#7c3aed', icon: 'doc', tip: 'Prompt (in) + completion (out) tokens reported by the provider' },
    { label: 'Time Spent', v: dur(s.durationMs), foot: `Avg ${dur(s.avgMs)} per call`, accent: '#0d9488', icon: 'clock', tip: 'Total time waiting on the AI provider' },
    { label: 'Failed Calls', v: num(s.failed), foot: s.calls ? `${Math.round((s.failed / s.calls) * 100)}% of calls` : '—', accent: '#e11d48', icon: 'siren', tip: 'Timeouts or provider errors (AcIntel falls back to local answers)' },
  ] : [];
  return (
    <>
      <PageHead title="AI Usage" actions={<Link href="/settings" className="btn btn-ghost"><ArrowLeft size={15} /> Settings</Link>} />
      <div className="filters card" style={{ marginBottom: 14 }}>
        <label><span>From</span><input type="date" className="input" value={f.from} max={f.to || undefined} onChange={set('from')} /></label>
        <label><span>To</span><input type="date" className="input" value={f.to} min={f.from || undefined} onChange={set('to')} /></label>
        {[1, 7, 30, 90].map((n) => <button key={n} className="btn btn-sm" onClick={() => setF({ ...f, from: back(n - 1), to: lagosStamp() })} data-tip={n === 1 ? 'Today' : `Last ${n} days`}>{n === 1 ? 'Today' : `${n}d`}</button>)}
        <label><span>Feature</span><select className="select" value={f.feature} onChange={set('feature')}><option value="">All Features</option>{(data?.features || []).map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
        <label><span>Admin</span><select className="select" value={f.admin} onChange={set('admin')}><option value="">Everyone</option><option value="system">System (Background)</option>{(data?.admins || []).map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
        <label><span>Status</span><select className="select" value={f.status} onChange={set('status')}><option value="">All</option><option value="ok">Success</option><option value="failed">Failed</option></select></label>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm btn-ghost" onClick={() => setF(INIT)} data-tip="Reset filters"><RotateCcw size={13} /> Reset</button>
        <button className="btn btn-sm" onClick={load} data-tip="Refresh"><RefreshCw size={13} /></button>
      </div>
      <div className="grid kpis" style={{ marginBottom: 16 }}>
        {!s && Array.from({ length: 4 }).map((_, i) => <div key={i} className="kpi"><div className="skeleton" style={{ width: '50%' }} /><div className="skeleton" style={{ width: '30%', height: 26, marginTop: 10 }} /></div>)}
        {kpis.map((k) => (
          <div key={k.label} className="kpi" style={{ ['--accent' as any]: k.accent, cursor: 'default' }} data-tip={k.tip}>
            <div className="k-label">{k.label}</div><div className="k-val">{k.v}</div><div className="k-foot">{k.foot}</div>
            <KpiIcon name={k.icon} accent={k.accent} />
          </div>
        ))}
      </div>
      <div className="sec-head"><h3>By Feature</h3><p>Click a card to filter the log</p></div>
      <div className="usage-feats" style={{ marginBottom: 16 }}>
        {(data?.byFeature || []).length === 0 && !loading && <div className="card card-pad hint">No AI calls in this range.</div>}
        {(data?.byFeature || []).map((x) => {
          const m = FEAT[x.feature] || FEAT.other; const on = f.feature === x.feature;
          return (
            <button key={x.feature} className={`card-select usage-feat ${on ? 'is-active' : ''}`} style={{ ['--acc' as any]: m.acc }} onClick={() => setF({ ...f, feature: on ? '' : x.feature })} aria-pressed={on}>
              <span className="uf-ico">{m.icon}</span>
              <span className="uf-txt"><b>{x.label}</b><small>{num(x.calls)} calls · {num(x.tokens)} tokens · {dur(x.durationMs)}</small></span>
            </button>
          );
        })}
      </div>
      <DataTable columns={data?.columns || []} rows={data?.rows || []} total={data?.total} loading={loading} exportName="ai-usage" />
    </>
  );
}
