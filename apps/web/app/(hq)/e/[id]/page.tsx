'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Ban, CalendarDays, CheckCircle2, ExternalLink, FileText, Fingerprint, ImagePlus, KeyRound, Link2, Pencil, Send, ShieldCheck, Trash2, UserCheck, Users, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHead } from '@/components/shell';
import { DataTable, Row, Col } from '@/components/ui';
import { DispatchOverlay } from '@/components/overlays';
import { useApp, useLive } from '@/components/providers';
import { AdminModal, AssignModal, CategoryModal, EditAgentModal, GroupModal, TempPassword } from '@/components/forms';
import { GeoMap } from '@/components/geomap';

type Media = { id: string; kind: string; url: string; filename: string; by: string; date: string; storage: string };
type Ent = { type: string; tag: string; title: string; subtitle?: string; status?: string; fields: Record<string, any>; links?: Record<string, string | undefined>; dates?: Record<string, string | null>;
  activity?: { day: string; label: string; reports: number; alarms: number }[] | null; related: { title: string; columns: Col[]; rows: Row[]; linkKey?: string }[]; timeline?: Row[]; raw?: any;
  geo?: { lat: number; lng: number; label: string; online?: boolean } | null; media?: Media[] };
const dayOf = (ts: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date(ts));
const TL_COLS: Col[] = [{ key: 'date', label: 'When' }, { key: 'actor', label: 'By' }, { key: 'action', label: 'Action' }, { key: 'summary', label: 'Summary' }];
const LIVE: Record<string, string[]> = { user: ['users'], agent: ['agents'], incident: ['incidents'], alarm: ['alarms'], group: ['groups', 'agents'], category: ['categories'], admin: ['admins'], alert: ['alerts'] };

function Activity({ days, onDay }: { days: NonNullable<Ent['activity']>; onDay: (d: string) => void }) {
  const max = Math.max(1, ...days.map((d) => d.reports + d.alarms));
  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <div className="card-head" style={{ padding: 0, marginBottom: 10 }}><div><h3>Engagement · last 30 days</h3><p>Click a day to see everything that happened</p></div></div>
      <div className="strip">{days.map((d) => (
        <button key={d.day} onClick={() => onDay(d.day)} data-tip={`${d.label}: ${d.reports} reports · ${d.alarms} alarms`} style={{ height: `max(4px, ${((d.reports + d.alarms) / max) * 100}%)` }} className={d.reports + d.alarms ? 'has' : ''} />
      ))}</div>
    </div>
  );
}

function MediaPanel({ id, media, ops, onChange }: { id: string; media: Media[]; ops: boolean; onChange: () => void }) {
  const { toast, confirm } = useApp();
  const [url, setUrl] = useState(''); const [busy, setBusy] = useState(false); const [drag, setDrag] = useState(false);
  const inp = useRef<HTMLInputElement>(null);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return; setBusy(true);
    for (const file of Array.from(files)) {
      const fd = new FormData(); fd.append('file', file);
      try { const r = await fetch(`/api/incidents/${id}/media`, { method: 'POST', body: fd, credentials: 'include' }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || `Upload failed (${r.status})`); toast(`Attached ${file.name}`); }
      catch (e: any) { toast(e.message, 'error'); }
    }
    setBusy(false); onChange();
  };
  const addUrl = async (e: React.FormEvent) => {
    e.preventDefault(); if (!url.trim()) return; setBusy(true);
    try { await api(`/incidents/${id}/media/url`, { method: 'POST', json: { url: url.trim() } }); setUrl(''); toast('Link attached'); onChange(); } catch (x: any) { toast(x.message, 'error'); } finally { setBusy(false); }
  };
  const del = async (m: Media) => { if (await confirm({ title: `Remove ${m.filename}?`, body: 'The file is deleted from storage.', confirm: 'Remove', danger: true })) { try { await api(`/media/${m.id}`, { method: 'DELETE' }); toast('Media removed'); onChange(); } catch (x: any) { toast(x.message, 'error'); } } };
  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <div className="card-head" style={{ padding: 0, marginBottom: 10 }}><div><h3>Evidence & media</h3><p>{media.length} attached · images, video, audio, PDF (upload) or any https link</p></div></div>
      <div className="media-grid">
        {media.map((m) => (
          <div key={m.id} className="media-item">
            <a href={m.url} target="_blank" rel="noreferrer" data-tip={`${m.filename} · ${m.by}`}>
              {m.kind === 'image' ? <img src={m.url} alt={m.filename} loading="lazy" /> : m.kind === 'video' && m.storage === 'local' ? <video src={m.url} muted preload="metadata" /> : <div className="m-ph">{m.kind === 'link' ? <Link2 size={22} /> : <FileText size={22} />}<span>{m.kind}</span></div>}
            </a>
            <div className="m-cap"><span>{m.filename}</span><small>{m.date}</small></div>
            {ops && <button className="m-del" onClick={() => del(m)} aria-label="Remove" data-tip="Remove"><Trash2 size={13} /></button>}
          </div>
        ))}
      </div>
      {ops && <>
        <div className={`dropzone ${drag ? 'over' : ''}`} style={{ marginTop: media.length ? 12 : 0 }} onClick={() => inp.current?.click()} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}>
          <ImagePlus size={18} /> {busy ? 'Uploading…' : 'Drop files here or click to upload'}
          <input ref={inp} type="file" hidden multiple accept="image/*,video/*,audio/*,application/pdf" onChange={(e) => upload(e.target.files)} />
        </div>
        <form onSubmit={addUrl} style={{ display: 'flex', gap: 8, marginTop: 10 }}><input className="input" placeholder="…or paste a media URL (https://)" value={url} onChange={(e) => setUrl(e.target.value)} /><button className="btn" disabled={busy || !url}><Link2 size={14} /> Attach link</button></form>
      </>}
    </div>
  );
}

export default function EntityPage({ params }: { params: { id: string } }) {
  const { can, confirm, toast, refreshCounts, openDay } = useApp();
  const ops = can('ops');
  const [e, setE] = useState<Ent | null>(null);
  const [err, setErr] = useState('');
  const [ui, setUi] = useState<'' | 'dispatch' | 'edit' | 'assign'>('');
  const [temp, setTemp] = useState<{ email: string; pw: string } | null>(null);
  const load = useCallback(() => api<Ent>(`/entity/${params.id}`).then(setE).catch((x) => setErr(x.status === 404 ? 'Record not found' : x.message)), [params.id]);
  useEffect(() => { load(); }, [load]);
  useLive(e ? LIVE[e.type] || [] : ['__none'], load);
  const done = () => { load(); refreshCounts(); };
  const post = async (path: string, json: unknown, msg: string) => {
    try { const r = await api<any>(path, { method: 'POST', json }); toast(msg, 'success', r.undo?.length ? { undo: r.undo, onUndone: done } : undefined); done(); } catch (x: any) { toast(x.message, 'error'); }
  };

  if (err) return <div className="card empty"><div className="e-ico"><Fingerprint size={22} /></div><b>{err}</b><div className="hint">Reference {params.id}</div><Link href="/" className="btn" style={{ marginTop: 12 }}>Back to dashboard</Link></div>;
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
    {st === 'new' && <B tone="btn-primary" icon={<Send size={15} />} label="Dispatch" tip="Choose agencies and dispatch" on={() => setUi('dispatch')} />}
    {st === 'dispatched' && <B icon={<ShieldCheck size={15} />} label="Acted upon" on={() => incAct('acted')} />}
    {['new', 'dispatched', 'acted'].includes(st) && <><B tone="btn-success" icon={<CheckCircle2 size={15} />} label="Resolve" on={() => incAct('resolved')} /><B tone="btn-danger" icon={<XCircle size={15} />} label="Fake" tip="Mark as fake (reason required)" on={() => incAct('fake')} /></>}</>;
  if (e.type === 'user') actions = st === 'pending' ? <><B tone="btn-success" icon={<CheckCircle2 size={15} />} label="Approve" on={() => statusAct('active', 'Approve')} /><B tone="btn-danger" icon={<Ban size={15} />} label="Suspend" on={() => statusAct('suspended', 'Suspend')} /></>
    : st === 'active' ? <B tone="btn-danger" icon={<Ban size={15} />} label="Suspend" on={() => statusAct('suspended', 'Suspend')} /> : <B tone="btn-success" icon={<UserCheck size={15} />} label="Activate" on={() => statusAct('active', 'Activate')} />;
  if (e.type === 'agent') actions = <><B icon={<Pencil size={15} />} label="Edit" on={() => setUi('edit')} /><B icon={<Users size={15} />} label="Assign group" on={() => setUi('assign')} />
    {st === 'suspended' ? <B tone="btn-success" icon={<UserCheck size={15} />} label="Activate" on={() => statusAct('active', 'Activate')} /> : <B tone="btn-danger" icon={<Ban size={15} />} label="Suspend" on={() => statusAct('suspended', 'Suspend')} />}</>;
  if (e.type === 'alarm' && st === 'new') actions = <B tone="btn-success" icon={<CheckCircle2 size={15} />} label="Resolve alarm" on={async () => { if (await confirm({ title: 'Resolve this alarm?', confirm: 'Resolve' })) post(`/alarms/${params.id}/resolve`, {}, 'Alarm resolved'); }} />;
  if (e.type === 'group' || e.type === 'category') actions = <B icon={<Pencil size={15} />} label="Edit" on={() => setUi('edit')} />;
  if (e.type === 'admin') actions = <><B perm="admins.manage" icon={<Pencil size={15} />} label="Edit" on={() => setUi('edit')} />
    <B perm="admins.manage" tone="btn-danger" icon={<KeyRound size={15} />} label="Reset password" on={async () => { if (await confirm({ title: 'Reset password?', body: 'All their sessions are signed out.', confirm: 'Reset', danger: true })) { try { const r = await api<any>(`/admins/${params.id}/reset-password`, { method: 'POST' }); setTemp({ email: e.raw?.email, pw: r.tempPassword }); } catch (x: any) { toast(x.message, 'error'); } } }} /></>;

  const dates = e.dates || {};
  const fieldKeys = Object.keys(e.fields);
  return (
    <>
      <PageHead crumbs={[{ label: 'AcIntel', href: '/' }, { label: e.tag }, { label: `Ref ${params.id.slice(0, 6)}…` }]} title={e.title} subtitle={e.subtitle} actions={<div className="row-acts">{actions}</div>} />
      <div className={e.geo ? 'ent-grid' : ''} style={{ marginBottom: 16 }}>
        <div className="card card-pad">
          <div className="kv">{fieldKeys.map((k) => {
            const v = e.fields[k]; const href = e.links?.[k]; const d = dates[k];
            const text = v === null || v === undefined || v === '' ? '—' : String(v);
            return <div key={k}><small>{k}</small><b>{
              d && text !== '—' ? <button className="date-link" onClick={() => openDay(dayOf(d), params.id)} data-tip="Open this day's engagement"><CalendarDays size={12} /> {text}</button>
              : href && text !== '—' ? <Link className="cell-link" href={href}>{text}</Link>
              : k === 'Status' || k === 'Presence' || k === 'Risk level' ? <span className={`chip ${text === 'active' || text === 'online' || text === 'resolved' ? 'green' : text === 'suspended' || text === 'fake' || text === 'critical' ? 'rose' : text === 'new' ? 'blue' : text === 'pending' || text === 'high' ? 'amber' : ''}`}><span className="dot" />{text}</span>
              : text}</b></div>;
          })}</div>
          {e.type === 'incident' && e.raw?.agencies?.length > 0 && <div className="hint" style={{ marginTop: 12 }}>Dispatched to {e.raw.agencies.join(', ')}</div>}
        </div>
        {e.geo && <div><GeoMap mini pins={[{ id: params.id, lat: e.geo.lat, lng: e.geo.lng, color: e.type === 'alarm' ? '#db2777' : e.type === 'agent' ? (e.geo.online ? '#10b981' : '#94a3b8') : '#f59e0b', pulse: e.type === 'alarm' || !!e.geo.online, big: true, title: e.geo.label }]} />
          <a className="hint" style={{ display: 'inline-flex', gap: 4, marginTop: 6 }} href={`https://www.openstreetmap.org/?mlat=${e.geo.lat}&mlon=${e.geo.lng}#map=16/${e.geo.lat}/${e.geo.lng}`} target="_blank" rel="noreferrer"><ExternalLink size={12} /> {e.geo.lat.toFixed(5)}, {e.geo.lng.toFixed(5)}</a></div>}
      </div>
      {e.activity && <Activity days={e.activity} onDay={(d) => openDay(d, params.id)} />}
      {e.type === 'incident' && <MediaPanel id={params.id} media={e.media || []} ops={ops} onChange={load} />}
      {e.related.map((r) => <div key={r.title} style={{ marginBottom: 16 }}><h3 style={{ margin: '0 0 8px' }}>{r.title} <span className="chip">{r.rows.length}</span></h3><DataTable columns={r.columns} rows={r.rows} linkKey={r.linkKey} exportName={`${e.type}-${r.title.toLowerCase().replace(/\s+/g, '-')}`} /></div>)}
      {!!e.timeline?.length && <div style={{ marginBottom: 16 }}><h3 style={{ margin: '0 0 8px' }}>Audit trail <span className="chip">{e.timeline.length}</span></h3><DataTable columns={TL_COLS} rows={e.timeline.map(({ _id, ...r }) => r)} exportName={`${e.type}-audit`} /></div>}
      {ui === 'dispatch' && <DispatchOverlay report={{ _id: params.id, category: e.title, details: e.fields.Report, location: e.fields.Location, lga: e.fields.LGA, status: st, date: e.fields['Report date'] }} onClose={() => setUi('')} onDone={done} />}
      {ui === 'edit' && e.type === 'agent' && <EditAgentModal raw={{ ...e.raw, groupId: e.raw?.groupId || '' }} id={params.id} onClose={() => setUi('')} onDone={done} />}
      {ui === 'edit' && e.type === 'group' && <GroupModal raw={e.raw} id={params.id} onClose={() => setUi('')} onDone={done} />}
      {ui === 'edit' && e.type === 'category' && <CategoryModal raw={e.raw} id={params.id} onClose={() => setUi('')} onDone={done} />}
      {ui === 'edit' && e.type === 'admin' && <AdminModal raw={{ ...e.raw, groupId: e.raw?.groupId || '' }} id={params.id} onClose={() => setUi('')} onDone={done} />}
      {ui === 'assign' && <AssignModal ids={[params.id]} onClose={() => setUi('')} onDone={done} />}
      {temp && <TempPassword email={temp.email} pw={temp.pw} onClose={() => setTemp(null)} />}
    </>
  );
}
