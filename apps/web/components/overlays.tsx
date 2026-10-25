'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Download, ExternalLink, Send } from 'lucide-react';
import { api, downloadCsv, titleCase } from '@/lib/api';
import { ExcerptList, useApp } from './providers';
import { KpiIcon } from './kpi-icons';
import { Cell, Col, Modal, Row } from './ui';

const FALLBACK_AGENCIES = ['FRSC', 'AVS', 'NIS', 'ARTSMA ADMIN', 'Military Navy/QRF', 'NDLEA', 'NPF-ABIA', 'ABIA DSS', 'NSCDC', 'EMS/Fire', 'Homeland-Watch', 'OP CRUSH', 'Joint Security Ops', 'NA-14 BRG'];
let agenciesP: Promise<string[]> | null = null;
const abbr = (a: string) => a.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase();

/**
 * Dispatch Now — hardened: agencies come from the API (single source of truth), double-submit guarded
 * (in-flight ref + server 5s guard), conflict messages surfaced (already dispatched / resolved), optional note.
 */
/** One-line excerpt for confirm / dispatch lists: "Category — headline · LGA". */
export const incidentLine = (r: Row) => `${r.category || 'Report'} — ${r.title || r.details || ''}${r.lga ? ` · ${r.lga}` : ''}`;

export function DispatchOverlay({ report, reports, onClose, onDone }: { report?: Row; reports?: Row[]; onClose: () => void; onDone: () => void }) {
  const { toast, can } = useApp();
  const list = reports?.length ? reports : report ? [report] : [];
  const multi = list.length > 1;
  const one = list[0] || {};
  const [agencies, setAgencies] = useState<string[]>(FALLBACK_AGENCIES);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inflight = useRef(false);
  useEffect(() => { (agenciesP ||= api<string[]>('/incidents/agencies').catch(() => FALLBACK_AGENCIES)).then(setAgencies); }, []);
  const toggle = (a: string) => { setErr(''); setPicked((p) => (p.includes(a) ? p.filter((x) => x !== a) : [...p, a])); };
  const already: string[] = multi ? [] : one.agencies || [];
  const dispatch = async () => {
    if (inflight.current || !picked.length) return;
    inflight.current = true; setBusy(true); setErr('');
    try {
      if (multi) {
        const r = await api<{ dispatched: number; skipped: number }>(`/incidents/dispatch`, { method: 'POST', json: { ids: list.map((x) => x._id), agencies: picked, note: note.trim() || undefined } });
        toast(`${r.dispatched} report${r.dispatched === 1 ? '' : 's'} dispatched to ${picked.length} agenc${picked.length > 1 ? 'ies' : 'y'}${r.skipped ? ` · ${r.skipped} skipped (already closed)` : ''}`, r.dispatched ? 'success' : 'info');
      } else {
        const r = await api<{ agencies: string[] }>(`/incidents/${one._id}/dispatch`, { method: 'POST', json: { agencies: picked, note: note.trim() || undefined } });
        toast(`Dispatched to ${r.agencies.length} agenc${r.agencies.length > 1 ? 'ies' : 'y'}: ${r.agencies.join(', ')}`);
      }
      onDone(); onClose();
    } catch (e: any) { setErr(e.message || 'Dispatch failed'); if (e.status === 409) onDone(); } finally { inflight.current = false; setBusy(false); }
  };
  const allOn = picked.length === agencies.length;
  return (
    <Modal title={multi ? `Dispatch ${list.length} Incidents` : 'Dispatch Incident'} subtitle="Select the agencies to notify, then Dispatch Now." onClose={onClose}
      footer={<>
        <span className="hint" style={{ marginRight: 'auto', alignSelf: 'center' }}>{picked.length ? `${picked.length} selected` : 'No agency selected'}</span>
        <button className="btn" onClick={() => setPicked(allOn ? [] : agencies)}>{allOn ? 'Clear All' : 'Select All'}</button>
        <button className="btn btn-primary" disabled={!picked.length || busy || !can('ops')} onClick={dispatch} data-tip={can('ops') ? 'Send to the selected agencies' : 'Your role is read-only'}><Send size={15} /> {busy ? 'Dispatching…' : 'Dispatch Now'}</button>
      </>}>
      {multi ? (
        <div style={{ marginBottom: 14 }}><div className="label" style={{ marginBottom: 8 }}>Incidents ({list.length})</div><ExcerptList items={list.map(incidentLine)} /></div>
      ) : (
        <div className="summary">
          <div><small>Category</small><b>{one.category}</b></div>
          <div><small>Report Date</small><b>{one.date}</b></div>
          <div style={{ gridColumn: '1 / -1' }}><small>Report</small><b className="clamp-2" title={one.details}>{one.title || one.details}</b></div>
          <div style={{ gridColumn: '1 / -1' }}><small>Location</small><b>{one.location}</b></div>
          {one.sendAgentCount != null && <div><small>Recommended Agents</small><b>{one.sendAgentCount} (category policy)</b></div>}
          {already.length > 0 && <div><small>Already Dispatched To</small><b>{already.join(', ')}</b></div>}
        </div>
      )}
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
          <tbody>{rows.slice(0, max).map((r, i) => <tr key={i}>{columns.map((c) => <td key={c.key} className={c.key === lk ? 'primary' : ''}><Cell col={c} row={r} linkKey={lk} /></td>)}</tr>)}</tbody>
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

type DayCard = { k: string; label: string; count: number; icon: string; accent: string; list?: string };
/** "Click a date → that day's engagement". The KPI cards are the table selector (no tabs, no per-record focus card). */
export function DayOverlay({ date, entity, onClose }: { date: string; entity?: string; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  const [tab, setTab] = useState('incidents');
  useEffect(() => { api(`/engagement?date=${date}${entity ? `&entity=${entity}` : ''}`).then(setD).catch(() => setD({ error: true })); }, [date, entity]);
  const cards: DayCard[] = d?.counts ? [
    { k: 'incidents', label: 'Reports', count: d.counts.incidents, icon: 'doc', accent: '#2563eb', list: 'incidents' },
    { k: 'alarms', label: 'Alarms', count: d.counts.alarms, icon: 'siren', accent: '#e11d48', list: 'alarms' },
    { k: 'users', label: 'New Users', count: d.counts.users, icon: 'users', accent: '#0891b2', list: 'users' },
    { k: 'agents', label: 'New Agents', count: d.counts.agents, icon: 'agent', accent: '#16a34a', list: 'agents' },
    { k: 'audit', label: 'Admin Actions', count: d.counts.actions, icon: 'gear', accent: '#7c3aed', list: 'audit' },
    { k: 'logins', label: 'User Logins', count: d.counts.userLogins, icon: 'login', accent: '#0ea5e9' },
    { k: 'dispatches', label: 'Dispatches', count: d.counts.dispatches, icon: 'truck', accent: '#ea580c' },
  ] : [];
  const cur = d?.lists?.[tab];
  const curLabel = cards.find((c) => c.k === tab)?.label || '';
  return (
    <Modal title={d?.label || date} subtitle="Engagements for the day" onClose={onClose}
      footer={cur ? <button className="btn" onClick={() => downloadCsv(`engagement-${date}-${tab}`, cur.columns, cur.rows)}><Download size={15} /> Export {curLabel} CSV</button> : undefined}>
      {!d ? <div className="skeleton" style={{ width: '60%' }} /> : d.error ? <div className="hint">Could not load this day.</div> : (
        <>
          <div className="day-cards">
            {cards.map((c) => c.list ? (
              <button key={c.k} type="button" className={`card day-card card-select ${tab === c.k ? 'is-active' : ''}`} style={{ ['--acc' as any]: c.accent }} aria-pressed={tab === c.k} onClick={() => setTab(c.k)} data-tip={`Show ${c.label.toLowerCase()}`}>
                <KpiIcon name={c.icon} accent={c.accent} /><span><small>{c.label}</small><b>{c.count}</b></span>
              </button>
            ) : (
              <div key={c.k} className="card day-card" style={{ ['--acc' as any]: c.accent }}><KpiIcon name={c.icon} accent={c.accent} /><span><small>{c.label}</small><b>{c.count}</b></span></div>
            ))}
          </div>
          {/* key={tab} remounts the table per selection so no cell/row state leaks between lists. */}
          <MiniTable key={tab} columns={cur.columns} rows={cur.rows} linkKey={tab === 'audit' ? undefined : LK[tab === 'incidents' ? 'reports' : tab]} />
        </>
      )}
    </Modal>
  );
}
