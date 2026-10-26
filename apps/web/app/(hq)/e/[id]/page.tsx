'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, AtSign, Ban, EyeOff, ImageOff, MapPin, Phone, Bot, CalendarDays, MessageSquareQuote, RefreshCw, Sparkles, UserRoundSearch, CheckCircle2, ExternalLink, FileText, MessageCircle, Fingerprint, KeyRound, Link2, Pencil, Send, ShieldCheck, UserCheck, Users, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHead } from '@/components/shell';
import { DataTable, Row, Col } from '@/components/ui';
import { DispatchOverlay, DrillOverlay } from '@/components/overlays';
import { KpiIcon } from '@/components/kpi-icons';
import { MiniIcon } from '@/components/mini-icon';
import { useApp, useLive } from '@/components/providers';
import { AdminModal, AssignModal, CategoryModal, EditAgentModal, GroupModal, TempPassword } from '@/components/forms';
import { GeoMap } from '@/components/geomap';
import { VigilanteOverlay } from '@/components/vigilante';

type Media = { id: string; kind: string; url: string; filename: string; by: string; date: string; storage: string };
type Ent = { type: string; tag: string; title: string; subtitle?: string; status?: string; fields: Record<string, any>; links?: Record<string, string | undefined>; dates?: Record<string, string | null>;
  activity?: ({ day: string; label: string } & Record<string, any>)[] | null; activityKeys?: { key: string; label: string }[];
  stats?: Stat[]; related: { title: string; columns: Col[]; rows: Row[]; linkKey?: string }[]; timeline?: Row[]; raw?: any;
  geo?: { lat: number; lng: number; label: string; online?: boolean } | null; media?: Media[] };
type Stat = { label: string; value: string | number; accent: string; icon: string; tip: string; drill?: { kind: string; query?: Record<string, string>; title: string; href?: string } };
const dayOf = (ts: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date(ts));
const TL_COLS: Col[] = [{ key: 'date', label: 'When' }, { key: 'actor', label: 'By' }, { key: 'action', label: 'Action' }, { key: 'summary', label: 'Summary' }];
const ACT_KEYS = [{ key: 'reports', label: 'reports' }, { key: 'alarms', label: 'alarms' }];
const LIVE: Record<string, string[]> = { user: ['users'], agent: ['agents'], incident: ['incidents', 'reports', 'agents'], alarm: ['alarms'], group: ['groups', 'agents'], category: ['categories'], admin: ['admins'], alert: ['alerts'] };

function Activity({ days, keys, onDay }: { days: NonNullable<Ent['activity']>; keys: { key: string; label: string }[]; onDay: (d: string) => void }) {
  const sum = (d: Record<string, any>) => keys.reduce((n, k) => n + (Number(d[k.key]) || 0), 0);
  const max = Math.max(1, ...days.map(sum));
  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <div className="card-head" style={{ padding: 0, marginBottom: 10 }}><div><h3>Engagement · Last 30 Days</h3><p>Click a day to see everything that happened</p></div></div>
      <div className="strip">{days.map((d) => (
        <button key={d.day} onClick={() => onDay(d.day)} data-tip={`${d.label}: ${keys.map((k) => `${d[k.key] || 0} ${k.label}`).join(' · ')}`} style={{ height: `max(4px, ${(sum(d) / max) * 100}%)` }} className={sum(d) ? 'has' : ''} />
      ))}</div>
    </div>
  );
}

/** Evidence sent by the reporter at the point of the report — view-only for the control room. */
function MediaPanel({ media }: { media: Media[] }) {
  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <div className="card-head" style={{ padding: 0, marginBottom: 10 }}><div><h3>Evidence & Media</h3><p>{media.length ? `${media.length} file${media.length === 1 ? '' : 's'} sent by the reporter with this report` : 'Photos, video or files sent by the reporter appear here'}</p></div></div>
      {media.length ? <div className="media-grid">
        {media.map((m) => (
          <div key={m.id} className="media-item">
            <a href={m.url} target="_blank" rel="noreferrer" data-tip={`Open ${m.filename}`}>
              {m.kind === 'image' ? <img src={m.url} alt={m.filename} loading="lazy" /> : m.kind === 'video' && m.storage === 'local' ? <video src={m.url} muted preload="metadata" /> : <div className="m-ph">{m.kind === 'link' ? <Link2 size={22} /> : <FileText size={22} />}<span>{m.kind}</span></div>}
            </a>
            <div className="m-cap"><span>{m.filename}</span><small>{m.date}</small></div>
          </div>
        ))}
      </div> : <div className="media-empty"><ImageOff size={18} /> No media was sent with this report</div>}
    </div>
  );
}

/** Under the map: AI summary (narrower, left) beside the reporter's original words (wider, right). */
function IncidentText({ raw, id, ops, onChange }: { raw: any; id: string; ops: boolean; onChange: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [regenOn, setRegenOn] = useState(true);
  useEffect(() => { api<any>('/ai/status').then((s) => setRegenOn(!!s?.features?.aiRegenerate?.on)).catch(() => undefined); }, []);
  const ai = !!raw.aiSummary;
  const regen = async () => {
    setBusy(true);
    try { await api(`/incidents/${id}/ai`, { method: 'POST' }); toast('AI summary updated'); onChange(); } catch (x: any) { toast(x.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="ai-split">
      <div className="card card-pad ai-card">
        <div className="ai-head"><span className="ai-ico"><Sparkles size={15} /></span><div><h3>{ai ? 'AI Summary' : 'Summary'}</h3><p>{ai ? `Generated ${raw.aiAt || ''}` : 'Local summary · AI pending or not configured'}</p></div>
          {ops && <button className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} disabled={busy || !regenOn} onClick={regen} data-tip={regenOn ? 'Re-generate the headline and summary with AI' : 'On-Demand Regenerate is paused in Settings → AI'}><RefreshCw size={13} className={busy ? 'spin' : ''} /></button>}</div>
        <div className="ai-title">{raw.title}</div>
        <p className="ai-body">{raw.aiSummary || raw.localSummary}</p>
        <div className="ai-foot">{ai ? <span className="chip violet"><Bot size={12} /> AI</span> : <span className="chip">Local summary</span>}<span className="chip">{raw.category}</span><span className="chip">{raw.lga}</span></div>
      </div>
      <div className="card card-pad orig-card">
        <div className="ai-head"><span className="ai-ico orig"><MessageSquareQuote size={15} /></span><div><h3>Reporter&apos;s Original Report</h3><p>Exactly as submitted · {raw.date}</p></div></div>
        <blockquote className="orig-body">{raw.details}</blockquote>
        <div className="ai-foot"><span className="who-line">{raw.anonymous ? <b className="anon"><EyeOff size={13} /> Anonymous</b> : raw.reporterHref ? <Link className="cell-link" href={raw.reporterHref}>{raw.reporter}</Link> : <b>{raw.reporter}</b>}<span className={`role-tag rt-${raw.source || 'user'}`}>{raw.sourceLabel}</span></span>
          {raw.anonymous ? <span className="hint">Identity withheld by the reporter</span> : (raw.reporterPhone || raw.reporterEmail) && <span className="who-contact">{raw.reporterPhone && <span><Phone size={12} />{raw.reporterPhone}</span>}{raw.reporterEmail && <span><AtSign size={12} />{raw.reporterEmail}</span>}{raw.reporterLga && <span><MapPin size={12} />{raw.reporterLga}</span>}</span>}
          <span className="hint">{raw.location}</span></div>
      </div>
    </div>
  );
}

export default function EntityPage({ params }: { params: { id: string } }) {
  const { can, confirm, toast, refreshCounts, openDay } = useApp();
  const router = useRouter();
  const ops = can('ops');
  const [e, setE] = useState<Ent | null>(null);
  const [err, setErr] = useState('');
  const [ui, setUi] = useState<'' | 'dispatch' | 'edit' | 'assign' | 'vigilante'>('');
  const [temp, setTemp] = useState<{ email: string; pw: string } | null>(null);
  const [drill, setDrill] = useState<NonNullable<Stat['drill']> | null>(null);
  const load = useCallback(() => api<Ent>(`/entity/${params.id}`).then(setE).catch((x) => setErr(x.status === 404 ? 'Record not found' : x.message)), [params.id]);
  useEffect(() => { load(); }, [load]);
  useLive(e ? LIVE[e.type] || [] : ['__none'], load);
  const done = () => { load(); refreshCounts(); };
  const post = async (path: string, json: unknown, msg: string) => {
    try { const r = await api<any>(path, { method: 'POST', json }); toast(msg, 'success', r.undo?.length ? { undo: r.undo, onUndone: done } : undefined); done(); } catch (x: any) { toast(x.message, 'error'); }
  };

  if (err) return <div className="card empty"><div className="e-ico"><Fingerprint size={22} /></div><b>{err}</b><div className="hint">Reference {params.id}</div><Link href="/" className="btn" style={{ marginTop: 12 }}>Back to Dashboard</Link></div>;
  if (!e) return <div className="card card-pad"><div className="skeleton" style={{ width: '40%' }} /><div className="skeleton" style={{ width: '70%', marginTop: 12 }} /><div className="skeleton" style={{ width: '55%', marginTop: 12 }} /></div>;
  const st = String(e.status || e.fields.Status || '').toLowerCase();
  const B = (p: { tone?: string; icon: React.ReactNode; label: string; tip?: string; on: () => void; perm?: string }) => <button className={`btn ${p.tone || ''}`} disabled={!can(p.perm || 'ops')} onClick={p.on} data-tip={can(p.perm || 'ops') ? p.tip : 'Read-only role'}>{p.icon}{p.label}</button>;
  const ent = e.type === 'user' ? 'users' : 'agents';
  const statusAct = async (status: 'active' | 'suspended', label: string) => {
    if (await confirm({ title: `${label} ${e.title}?`, body: 'Recorded in the audit log; undo is available for 24 hours.', confirm: label, danger: status === 'suspended' })) post(`/${ent}/${params.id}/status`, { status }, `${e.title} ${status === 'suspended' ? 'suspended' : label === 'Approve' ? 'approved' : 'activated'}`);
  };
  const incAct = async (status: 'acted' | 'resolved' | 'fake') => {
    const label = status === 'fake' ? 'Mark as fake' : status === 'resolved' ? 'Resolve' : 'Mark acted upon';
    const ok = await confirm({ title: `${label}?`, body: `${e.title} · ${e.fields.LGA}`, confirm: label, danger: status === 'fake', input: { label: status === 'fake' ? 'Reason (required)' : 'Note (optional)', required: status === 'fake' } });
    if (ok) post(`/incidents/${params.id}/status`, { status, note: ok.value || undefined }, `Report ${status === 'fake' ? 'marked fake' : status === 'resolved' ? 'resolved' : 'marked acted upon'}`);
  };
  let actions: React.ReactNode = null;
  if (e.type === 'incident') actions = <>
    {['new', 'dispatched', 'acted'].includes(st) && <B tone="btn-agent-solid" icon={<UserRoundSearch size={15} />} label="Send to Vigilante" tip="Ask nearby agents to verify, confirm or resolve" on={() => setUi('vigilante')} />}
    {['new', 'dispatched'].includes(st) && <B tone="btn-blue" icon={<Send size={15} />} label="Dispatch" tip="Choose agencies and dispatch" on={() => setUi('dispatch')} />}
    {st === 'dispatched' && <B icon={<ShieldCheck size={15} />} label="Acted Upon" on={() => incAct('acted')} />}
    {['new', 'dispatched', 'acted'].includes(st) && <><B tone="btn-success" icon={<CheckCircle2 size={15} />} label="Resolve" on={() => incAct('resolved')} /><B tone="btn-danger" icon={<XCircle size={15} />} label="Fake" tip="Mark as fake (reason required)" on={() => incAct('fake')} /></>}</>;
  if (e.type === 'user') actions = st === 'pending' ? <><B tone="btn-success" icon={<CheckCircle2 size={15} />} label="Approve" on={() => statusAct('active', 'Approve')} /><B tone="btn-danger" icon={<Ban size={15} />} label="Suspend" on={() => statusAct('suspended', 'Suspend')} /></>
    : st === 'active' ? <B tone="btn-danger" icon={<Ban size={15} />} label="Suspend" on={() => statusAct('suspended', 'Suspend')} /> : <B tone="btn-success" icon={<UserCheck size={15} />} label="Activate" on={() => statusAct('active', 'Activate')} />;
  const message = async () => {
    try { const r = await api<{ id: string }>('/chats/start', { method: 'POST', json: { agentId: params.id } }); router.push(`/chats?t=${r.id}`); } catch (x: any) { toast(x.message, 'error'); }
  };
  if (e.type === 'agent') actions = <><B tone="btn-primary" icon={<MessageCircle size={15} />} label="Send Message" tip={st === 'active' ? 'Open a direct conversation with this agent' : 'Activate the agent to message them'} on={message} />
    <B icon={<Pencil size={15} />} label="Edit" on={() => setUi('edit')} /><B icon={<Users size={15} />} label="Assign Group" on={() => setUi('assign')} />
    {st === 'suspended' ? <B tone="btn-success" icon={<UserCheck size={15} />} label="Activate" on={() => statusAct('active', 'Activate')} /> : <B tone="btn-danger" icon={<Ban size={15} />} label="Suspend" on={() => statusAct('suspended', 'Suspend')} />}</>;
  if (e.type === 'alarm' && st === 'new') actions = <B tone="btn-success" icon={<CheckCircle2 size={15} />} label="Resolve Alarm" on={async () => { if (await confirm({ title: 'Resolve this alarm?', confirm: 'Resolve' })) post(`/alarms/${params.id}/resolve`, {}, 'Alarm resolved'); }} />;
  if (e.type === 'group' || e.type === 'category') actions = <B icon={<Pencil size={15} />} label="Edit" on={() => setUi('edit')} />;
  if (e.type === 'admin') actions = <><B perm="admins.manage" icon={<Pencil size={15} />} label="Edit" on={() => setUi('edit')} />
    <B perm="admins.manage" tone="btn-danger" icon={<KeyRound size={15} />} label="Reset Password" on={async () => { if (await confirm({ title: 'Reset password?', body: 'All their sessions are signed out.', confirm: 'Reset', danger: true })) { try { const r = await api<any>(`/admins/${params.id}/reset-password`, { method: 'POST' }); setTemp({ email: e.raw?.email, pw: r.tempPassword }); } catch (x: any) { toast(x.message, 'error'); } } }} /></>;

  const dates = e.dates || {};
  const fieldKeys = Object.keys(e.fields);
  return (
    <>
      <PageHead title={e.title} actions={<div className="row-acts">{actions}</div>} />
      {!!e.stats?.length && (
        <div className="grid kpis" style={{ marginBottom: 16 }}>
          {e.stats.map((k) => (
            <button key={k.label} className="kpi" style={{ ['--accent' as any]: k.accent }} onClick={() => k.drill && setDrill(k.drill)} data-tip={k.tip} disabled={!k.drill}>
              <div className="k-label">{k.label}</div>
              <div className="k-val">{typeof k.value === 'number' ? k.value.toLocaleString('en-NG') : k.value}</div>
              <KpiIcon name={k.icon} accent={k.accent} />
              {k.drill && <ArrowUpRight size={15} className="k-go" />}
            </button>
          ))}
        </div>
      )}
      <div className={e.geo ? 'ent-grid' : ''} style={{ marginBottom: 16 }}>
        <div className="card card-pad">
          <div className="kv">{fieldKeys.map((k) => {
            const v = e.fields[k]; const href = e.links?.[k]; const d = dates[k];
            const text = v === null || v === undefined || v === '' ? '—' : String(v);
            return <div key={k}><small><MiniIcon label={k} />{k}</small><b>{
              d && text !== '—' ? <button className="date-link" onClick={() => openDay(dayOf(d), params.id)} data-tip="Open this day's engagement"><CalendarDays size={12} /> {text}</button>
              : href && text !== '—' ? <Link className="cell-link" href={href}>{text}</Link>
              : k === 'Status' || k === 'Presence' || k === 'Risk Level' ? <span className={`chip ${text === 'active' || text === 'online' || text === 'resolved' ? 'green' : text === 'suspended' || text === 'fake' || text === 'critical' ? 'rose' : text === 'new' ? 'blue' : text === 'pending' || text === 'high' ? 'amber' : ''}`}>{text}</span>
              : text}</b></div>;
          })}</div>
          {e.type === 'incident' && e.raw?.agencies?.length > 0 && <div className="hint" style={{ marginTop: 12 }}>Dispatched to {e.raw.agencies.join(', ')}</div>}
        </div>
        {e.geo && <div><GeoMap mini pins={[{ id: params.id, lat: e.geo.lat, lng: e.geo.lng, color: e.type === 'alarm' ? '#db2777' : e.type === 'agent' ? (e.geo.online ? '#10b981' : '#94a3b8') : '#f59e0b', pulse: e.type === 'alarm' || !!e.geo.online, big: true, title: e.geo.label }]} />
          <a className="hint" style={{ display: 'inline-flex', gap: 4, marginTop: 6 }} href={`https://www.openstreetmap.org/?mlat=${e.geo.lat}&mlon=${e.geo.lng}#map=16/${e.geo.lat}/${e.geo.lng}`} target="_blank" rel="noreferrer"><ExternalLink size={12} /> {e.geo.lat.toFixed(5)}, {e.geo.lng.toFixed(5)}</a></div>}
      </div>
      {e.type === 'incident' && e.raw && <IncidentText raw={e.raw} id={params.id} ops={ops} onChange={load} />}
      {e.activity && <Activity days={e.activity} keys={e.activityKeys || ACT_KEYS} onDay={(d) => openDay(d, params.id)} />}
      {e.type === 'incident' && <MediaPanel media={e.media || []} />}
      {e.related.map((r) => <div key={r.title} style={{ marginBottom: 16 }}><h3 style={{ margin: '0 0 8px' }}>{r.title} <span className="chip">{r.rows.length}</span></h3><DataTable scroll columns={r.columns} rows={r.rows} linkKey={r.linkKey} exportName={`${e.type}-${r.title.toLowerCase().replace(/\s+/g, '-')}`} /></div>)}
      {!!e.timeline?.length && <div style={{ marginBottom: 16 }}><h3 style={{ margin: '0 0 8px' }}>Audit Trail <span className="chip">{e.timeline.length}</span></h3><DataTable scroll columns={TL_COLS} rows={e.timeline.map(({ _id, ...r }) => r)} exportName={`${e.type}-audit`} /></div>}
      {ui === 'dispatch' && <DispatchOverlay report={{ _id: params.id, category: e.title, title: e.raw?.title, details: e.raw?.details, location: e.fields.Location, lga: e.fields.LGA, status: st, date: e.fields['Report Date'] }} onClose={() => setUi('')} onDone={done} />}
      {ui === 'vigilante' && <VigilanteOverlay incidentId={params.id} onClose={() => setUi('')} onDone={done} />}
      {ui === 'edit' && e.type === 'agent' && <EditAgentModal raw={{ ...e.raw, groupId: e.raw?.groupId || '' }} id={params.id} onClose={() => setUi('')} onDone={done} />}
      {ui === 'edit' && e.type === 'group' && <GroupModal raw={e.raw} id={params.id} onClose={() => setUi('')} onDone={done} />}
      {ui === 'edit' && e.type === 'category' && <CategoryModal raw={e.raw} id={params.id} onClose={() => setUi('')} onDone={done} />}
      {ui === 'edit' && e.type === 'admin' && <AdminModal raw={{ ...e.raw, groupId: e.raw?.groupId || '' }} id={params.id} onClose={() => setUi('')} onDone={done} />}
      {ui === 'assign' && <AssignModal ids={[params.id]} onClose={() => setUi('')} onDone={done} />}
      {drill && <DrillOverlay kind={drill.kind} query={drill.query} title={drill.title} href={drill.href} onClose={() => setDrill(null)} />}
      {temp && <TempPassword email={temp.email} pw={temp.pw} onClose={() => setTemp(null)} />}
    </>
  );
}
