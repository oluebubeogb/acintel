'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CalendarDays, Check, Download, ExternalLink, Send } from 'lucide-react';
import { api, downloadCsv, titleCase } from '@/lib/api';
import { useApp } from './providers';
import { Cell, Col, Modal, Row } from './ui';

const FALLBACK_AGENCIES = ['FRSC', 'AVS', 'NIS', 'ARTSMA ADMIN', 'Military Navy/QRF', 'NDLEA', 'NPF-ABIA', 'ABIA DSS', 'NSCDC', 'EMS/Fire', 'Homeland-Watch', 'OP CRUSH', 'Joint Security Ops', 'NA-14 BRG'];
let agenciesP: Promise<string[]> | null = null;
const abbr = (a: string) => a.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase();

/**
 * Dispatch Now — hardened: agencies come from the API (single source of truth), double-submit guarded
 * (in-flight ref + server 5s guard), conflict messages surfaced (already dispatched / resolved), optional note.
 */
export function DispatchOverlay({ report, onClose, onDone }: { report: Row; onClose: () => void; onDone: () => void }) {
  const { toast, can } = useApp();
  const [agencies, setAgencies] = useState<string[]>(FALLBACK_AGENCIES);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inflight = useRef(false);
  useEffect(() => { (agenciesP ||= api<string[]>('/incidents/agencies').catch(() => FALLBACK_AGENCIES)).then(setAgencies); }, []);
  const toggle = (a: string) => { setErr(''); setPicked((p) => (p.includes(a) ? p.filter((x) => x !== a) : [...p, a])); };
  const already: string[] = report.agencies || [];
  const dispatch = async () => {
    if (inflight.current || !picked.length) return;
    inflight.current = true; setBusy(true); setErr('');
    try {
      const r = await api<{ agencies: string[] }>(`/incidents/${report._id}/dispatch`, { method: 'POST', json: { agencies: picked, note: note.trim() || undefined } });
      toast(`Dispatched to ${r.agencies.length} agenc${r.agencies.length > 1 ? 'ies' : 'y'}: ${r.agencies.join(', ')}`);
      onDone(); onClose();
    } catch (e: any) { setErr(e.message || 'Dispatch failed'); if (e.status === 409) onDone(); } finally { inflight.current = false; setBusy(false); }
  };
  const allOn = picked.length === agencies.length;
  return (
    <Modal title="Dispatch Incident" subtitle="Select the agencies to notify, then Dispatch Now." onClose={onClose}
      footer={<>
        <span className="hint" style={{ marginRight: 'auto', alignSelf: 'center' }}>{picked.length ? `${picked.length} selected` : 'No agency selected'}</span>
        <button className="btn" onClick={() => setPicked(allOn ? [] : agencies)}>{allOn ? 'Clear All' : 'Select All'}</button>
        <button className="btn btn-primary" disabled={!picked.length || busy || !can('ops')} onClick={dispatch} data-tip={can('ops') ? 'Send to the selected agencies' : 'Your role is read-only'}><Send size={15} /> {busy ? 'Dispatching…' : 'Dispatch Now'}</button>
      </>}>
      <div className="summary">
        <div><small>Category</small><b>{report.category}</b></div>
        <div><small>Report Date</small><b>{report.date}</b></div>
        <div style={{ gridColumn: '1 / -1' }}><small>Report</small><b>{report.details}</b></div>
        <div style={{ gridColumn: '1 / -1' }}><small>Location</small><b>{report.location}</b></div>
        {report.sendAgentCount != null && <div><small>Recommended Agents</small><b>{report.sendAgentCount} (category policy)</b></div>}
        {already.length > 0 && <div><small>Already Dispatched To</small><b>{already.join(', ')}</b></div>}
      </div>
      {err && <div className="chip rose" style={{ height: 'auto', padding: '8px 10px', marginBottom: 12, display: 'flex' }}><AlertTriangle size={14} /> {err}</div>}
      <div className="label" style={{ marginBottom: 10 }}>Agencies</div>
      <div className="agency-grid">
        {agencies.map((a) => (
          <button key={a} className={`agency ${picked.includes(a) ? 'on' : ''}`} onClick={() => toggle(a)} aria-pressed={picked.includes(a)} data-tip={picked.includes(a) ? 'Selected — click to remove' : already.includes(a) ? `${a} was already notified` : `Notify ${a}`}>
            <span className="a-ico">{picked.includes(a) ? <Check size={15} /> : abbr(a)}</span>{a}
          </button>
        ))}
      </div>
      <div className="field" style={{ marginTop: 14, marginBottom: 0 }}><label className="label">Note For The Log (Optional)</label>
        <input className="input" maxLength={500} placeholder="e.g. Caller confirmed 3 armed men, Ariaria junction" value={note} onChange={(e) => setNote(e.target.value)} /></div>
    </Modal>
  );
}

function MiniTable({ columns, rows, linkKey, max = 50 }: { columns: Col[]; rows: Row[]; linkKey?: string; max?: number }) {
  const lk = linkKey || columns[0]?.key;
  if (!rows.length) return <div className="hint" style={{ padding: 14 }}>Nothing recorded.</div>;
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
      <div className="table-wrap scroll" style={{ maxHeight: 360 }}>
        <table className="dt">
          <thead><tr>{columns.map((c) => <th key={c.key} style={{ cursor: 'default' }}>{c.label}</th>)}</tr></thead>
          <tbody>{rows.slice(0, max).map((r, i) => <tr key={r._id || i}>{columns.map((c) => <td key={c.key} className={c.key === lk ? 'primary' : ''}><Cell col={c} row={r} linkKey={lk} /></td>)}</tr>)}</tbody>
        </table>
      </div>
      {rows.length > max && <div className="table-foot">Showing {max} of {rows.length}</div>}
    </div>
  );
}

const LK: Record<string, string> = { users: 'name', agents: 'name', reports: 'category', alarms: 'sender', tips: 'title' };
/** KPI drill-down: overlay first (fast), "Open as page" for the full table, CSV exports the full list. */
/** Link to the generic records page for any list kind + server filters ("Open as page"). */
export const recordsHref = (kind: string, query?: Record<string, string>, title?: string) =>
  `/records?${new URLSearchParams({ kind, ...(title ? { title } : {}), ...(query || {}) })}`;

export function DrillOverlay({ kind, title, href, query, onClose, linkKey }: { kind: string; title: string; href?: string; query?: Record<string, string>; onClose: () => void; linkKey?: string }) {
  const [data, setData] = useState<{ columns: Col[]; rows: Row[]; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const qs = new URLSearchParams(query || {}).toString();
  useEffect(() => { api(`/records/${kind}?take=200${qs ? `&${qs}` : ''}`).then(setData).catch(() => setData({ columns: [], rows: [], total: 0 })); }, [kind, qs]);
  const cols = data?.columns.slice(0, 6) || [];
  const csv = async () => {
    if (!data) return; setBusy(true);
    try { const all = data.total > data.rows.length ? await api<typeof data>(`/records/${kind}?take=10000${qs ? `&${qs}` : ''}`) : data; downloadCsv(`${kind.replace('.', '-')}${qs ? '-filtered' : ''}`, all.columns, all.rows); } finally { setBusy(false); }
  };
  const page = href || recordsHref(kind, query, title);
  return (
    <Modal title={titleCase(title)} subtitle={data ? `${data.total.toLocaleString('en-NG')} record${data.total === 1 ? '' : 's'}` : 'Loading…'} onClose={onClose}
      footer={<>
        <button className="btn" disabled={!data || busy} onClick={csv}><Download size={15} /> {busy ? 'Preparing…' : 'Export CSV'}</button>
        <Link className="btn btn-primary" href={page} onClick={onClose}><ExternalLink size={15} /> Open as Page</Link>
      </>}>
      {!data ? <div style={{ display: 'grid', gap: 10 }}>{[80, 60, 70, 50].map((w) => <div key={w} className="skeleton" style={{ width: `${w}%` }} />)}</div>
        : <MiniTable columns={cols} rows={data.rows} linkKey={linkKey || LK[kind.split('.')[0]]} />}
    </Modal>
  );
}

/** "Click a date → that day's engagement": everything on one Lagos day, optionally focused on one record. */
export function DayOverlay({ date, entity, onClose }: { date: string; entity?: string; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  const [tab, setTab] = useState('incidents');
  useEffect(() => { api(`/engagement?date=${date}${entity ? `&entity=${entity}` : ''}`).then(setD).catch(() => setD({ error: true })); }, [date, entity]);
  const tabs = [['incidents', 'Reports'], ['alarms', 'Alarms'], ['users', 'New Users'], ['agents', 'New Agents'], ['audit', 'Admin Actions']] as const;
  return (
    <Modal title={d?.label || date} subtitle="Engagement for the day · Africa/Lagos" onClose={onClose}
      footer={d?.lists ? <button className="btn" onClick={() => downloadCsv(`engagement-${date}-${tab}`, d.lists[tab].columns, d.lists[tab].rows)}><Download size={15} /> Export {tab} CSV</button> : undefined}>
      {!d ? <div className="skeleton" style={{ width: '60%' }} /> : d.error ? <div className="hint">Could not load this day.</div> : (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' }}>
            {[['Reports', d.counts.incidents], ['Alarms', d.counts.alarms], ['New Users', d.counts.users], ['User Logins', d.counts.userLogins], ['New Agents', d.counts.agents], ['Dispatches', d.counts.dispatches], ['Admin Actions', d.counts.actions]].map(([l, v]) => (
              <div key={l} className="card stat"><small>{l}</small><b>{v}</b></div>))}
          </div>
          {d.focus && (
            <div className="card card-pad" style={{ marginBottom: 14 }}>
              <h3 style={{ display: 'flex', gap: 8, alignItems: 'center' }}><CalendarDays size={16} /> {d.focus.title} on this day</h3>
              {d.focus.events.length ? <ul className="timeline">{d.focus.events.map((e: any, i: number) => <li key={i}><span className="tl-dot" /><div><b>{e.time}</b> — {e.href ? <Link href={e.href} onClick={onClose}>{e.text}</Link> : e.text}</div></li>)}</ul> : <div className="hint">No activity for this record on this day.</div>}
            </div>
          )}
          <div className="seg" style={{ marginBottom: 10 }}>{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l} · {d.lists[k].rows.length}</button>)}</div>
          <MiniTable columns={d.lists[tab].columns} rows={d.lists[tab].rows} linkKey={tab === 'audit' ? undefined : LK[tab === 'incidents' ? 'reports' : tab]} />
        </>
      )}
    </Modal>
  );
}
