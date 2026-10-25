'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Phone, X } from 'lucide-react';
import { api } from '@/lib/api';
import { GeoMap, Pin } from './geomap';
import { useLive } from './providers';

type AgentPin = { id: string; name: string; phone: string; lga: string; group: string; groupId: string | null; lat: number; lng: number; online: boolean; lastSeen: string };
type IncPin = { id: string; category: string; lga: string; status: string; risk: string; lat: number; lng: number; date: string; details: string };
type AlarmPin = { id: string; type: string; sender: string; lat: number; lng: number; date: string };
const RISK: Record<string, string> = { critical: '#e11d48', high: '#f97316', medium: '#f59e0b', low: '#10b981' };

/** Agents on a live map. "Online only" overlay = seen within the online window; click a pin for its card. */
export function AgentMap({ filters }: { filters: string }) {
  const [online, setOnline] = useState(true);
  const [rows, setRows] = useState<AgentPin[]>([]);
  const [pick, setPick] = useState<AgentPin | null>(null);
  const q = useMemo(() => { const p = new URLSearchParams(filters); const o = new URLSearchParams(); if (p.get('lga')) o.set('lga', p.get('lga')!); if (p.get('group')) o.set('group', p.get('group')!); if (online) o.set('online', '1'); return o.toString(); }, [filters, online]);
  const load = useCallback(() => api<AgentPin[]>(`/map/agents?${q}`).then(setRows).catch(() => setRows([])), [q]);
  useEffect(() => { load(); }, [load]);
  useLive(['agents', 'agents.map'], load);
  const pins: Pin[] = useMemo(() => rows.map((a) => ({ id: a.id, lat: a.lat, lng: a.lng, color: a.online ? '#10b981' : '#94a3b8', pulse: a.online, title: a.name, sub: `${a.group} · ${a.lga}` })), [rows]);
  const on = rows.filter((r) => r.online).length;
  return (
    <div style={{ marginBottom: 16 }}>
      <GeoMap pins={pins} onPick={(id) => setPick(rows.find((r) => r.id === id) || null)}>
        <div className="map-legend">
          <button className={`chip ${online ? 'green' : ''}`} onClick={() => setOnline((o) => !o)} data-tip="Toggle the online overlay">{online ? '● Online only' : '○ All active agents'}</button>
          <span className="chip">{on} online · {rows.length} shown</span>
        </div>
        {pick && (
          <div className="map-card card card-pad">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><div><b>{pick.name}</b><div className="hint">{pick.group} · {pick.lga}</div></div><button className="icon-btn" onClick={() => setPick(null)} aria-label="Close"><X size={15} /></button></div>
            <div style={{ display: 'grid', gap: 6, margin: '10px 0', fontSize: 13 }}>
              <span><span className={`chip ${pick.online ? 'green' : ''}`}>{pick.online ? 'online' : 'offline'}</span> <span className="hint">last seen {pick.lastSeen}</span></span>
              <a href={`tel:${pick.phone}`} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Phone size={13} /> {pick.phone}</a>
              <span className="hint">{pick.lat.toFixed(5)}, {pick.lng.toFixed(5)}</span>
            </div>
            <Link href={`/e/${pick.id}`} className="btn btn-sm btn-primary"><ExternalLink size={13} /> Open agent</Link>
          </div>
        )}
      </GeoMap>
    </div>
  );
}

/** Active incidents coloured by category risk, plus unresolved alarms (pulsing rose). */
export function IncidentMap() {
  const [d, setD] = useState<{ incidents: IncPin[]; alarms: AlarmPin[] }>({ incidents: [], alarms: [] });
  const [show, setShow] = useState({ inc: true, alarms: true });
  const [pick, setPick] = useState<{ kind: 'inc'; v: IncPin } | { kind: 'alarm'; v: AlarmPin } | null>(null);
  const load = useCallback(() => api('/map/incidents').then(setD).catch(() => undefined), []);
  useEffect(() => { load(); }, [load]);
  useLive(['incidents', 'alarms'], load);
  const pins: Pin[] = useMemo(() => [
    ...(show.inc ? d.incidents.map((i) => ({ id: `i:${i.id}`, lat: i.lat, lng: i.lng, color: RISK[i.risk] || '#2563eb', big: i.risk === 'critical' || i.risk === 'high', pulse: i.status === 'new', title: i.category, sub: `${i.lga} · ${i.status}` })) : []),
    ...(show.alarms ? d.alarms.map((a) => ({ id: `a:${a.id}`, lat: a.lat, lng: a.lng, color: '#db2777', pulse: true, big: true, title: `${a.type} alarm`, sub: a.sender })) : []),
  ], [d, show]);
  const onPick = (id: string) => {
    const [k, x] = id.split(':');
    if (k === 'i') { const v = d.incidents.find((i) => i.id === x); if (v) setPick({ kind: 'inc', v }); }
    else { const v = d.alarms.find((a) => a.id === x); if (v) setPick({ kind: 'alarm', v }); }
  };
  return (
    <div style={{ marginBottom: 16 }}>
      <GeoMap pins={pins} onPick={onPick}>
        <div className="map-legend">
          <button className={`chip ${show.inc ? 'amber' : ''}`} onClick={() => setShow((s) => ({ ...s, inc: !s.inc }))} data-tip="Toggle incidents">{d.incidents.length} incidents</button>
          <button className={`chip ${show.alarms ? 'rose' : ''}`} onClick={() => setShow((s) => ({ ...s, alarms: !s.alarms }))} data-tip="Toggle unresolved alarms">{d.alarms.length} alarms</button>
          {Object.entries(RISK).map(([k, c]) => <span key={k} className="chip"><i style={{ width: 8, height: 8, borderRadius: 9, background: c, display: 'inline-block' }} /> {k}</span>)}
        </div>
        {pick && (
          <div className="map-card card card-pad">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div><b>{pick.kind === 'inc' ? pick.v.category : `${pick.v.type} alarm`}</b><div className="hint">{pick.kind === 'inc' ? `${pick.v.lga} · ${pick.v.date}` : `${pick.v.sender} · ${pick.v.date}`}</div></div>
              <button className="icon-btn" onClick={() => setPick(null)} aria-label="Close"><X size={15} /></button></div>
            {pick.kind === 'inc' && <div style={{ margin: '10px 0', fontSize: 13 }}><span className="chip">{pick.v.status}</span> <span className={`chip risk-${pick.v.risk}`}>{pick.v.risk} risk</span><p style={{ margin: '8px 0 0' }}>{pick.v.details}</p></div>}
            <Link href={`/e/${pick.v.id}`} className="btn btn-sm btn-primary" style={{ marginTop: 8 }}><ExternalLink size={13} /> Open {pick.kind === 'inc' ? 'report' : 'alarm'}</Link>
          </div>
        )}
      </GeoMap>
    </div>
  );
}
