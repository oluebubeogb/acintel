'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BadgeCheck, CalendarPlus, Check, IdCard, LogIn, MapPin, Navigation, Phone, Search, ShieldCheck, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useApp } from './providers';
import { GeoMap, Pin } from './geomap';
import { Modal } from './ui';

type Agent = { id: string; name: string; phone: string; email?: string; tag: string; agency: string; lga: string; onboarded: string; lastLogin: string; online: boolean; lat: number | null; lng: number | null; distanceKm: number | null; sent: boolean; sentAt: string | null };
type Resp = { incident: { id: string; category: string; title: string; location: string; lga: string; lat: number | null; lng: number | null; status: string }; radius: number; total: number; noLocation: number; alreadySent: number; agents: Agent[] };

const RADII = [2, 4, 8, 15];
const PURPOSES = [['verify', 'Verify'], ['confirm', 'Confirm'], ['resolve', 'Resolve']] as const;
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const km = (d: number | null) => (d == null ? 'N/A' : d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`);

/**
 * Send to Vigilante — pick nearby active agents (MapLibre + list) and ask them to verify, confirm or resolve an incident.
 * Each send is audited (incident.vigilante) and creates agent tasks; live updates push to every open dashboard.
 */
export function VigilanteOverlay({ incidentId, onClose, onDone }: { incidentId: string; onClose: () => void; onDone?: () => void }) {
  const { toast, can } = useApp();
  const [radius, setRadius] = useState(4);
  const [d, setD] = useState<Resp | null>(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [purpose, setPurpose] = useState<string>('verify');
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<{ lat: number; lng: number; n: number } | undefined>();
  const [hl, setHl] = useState('');
  const inflight = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setD(null); setErr('');
    api<Resp>(`/incidents/${incidentId}/nearby-agents?radius=${radius}`).then(setD).catch((e) => setErr(e.message || 'Could not load nearby agents'));
  }, [incidentId, radius]);

  const agents = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (d?.agents || []).filter((a) => !t || [a.name, a.phone, a.agency, a.lga, a.tag].some((x) => String(x || '').toLowerCase().includes(t)));
  }, [d, q]);
  const inc = d?.incident;
  const pins: Pin[] = useMemo(() => {
    const out: Pin[] = [];
    if (inc?.lat != null && inc.lng != null) out.push({ id: '__inc', lat: inc.lat, lng: inc.lng, color: '#e11d48', title: `${inc.category} — ${inc.title}`, sub: inc.location, pulse: true, big: true });
    agents.forEach((a) => a.lat != null && a.lng != null && out.push({ id: a.id, lat: a.lat, lng: a.lng, color: sel.has(a.id) ? '#2563eb' : a.online ? '#16a34a' : '#94a3b8', title: a.name, sub: `${a.agency} · ${km(a.distanceKm)}` }));
    return out;
  }, [agents, inc, sel]);
  const circle = useMemo(() => (inc?.lat != null && inc.lng != null ? { lat: inc.lat, lng: inc.lng, km: radius, color: '#16a34a' } : undefined), [inc?.lat, inc?.lng, radius]);

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = agents.length > 0 && agents.every((a) => sel.has(a.id));
  const pickFromMap = (id: string) => {
    if (id === '__inc') return;
    toggle(id); setHl(id);
    listRef.current?.querySelector(`[data-agent="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const send = async () => {
    if (inflight.current || !sel.size) return;
    inflight.current = true; setBusy(true); setErr('');
    try {
      const r = await api<{ sent: number; resent: number }>(`/incidents/${incidentId}/vigilante`, { method: 'POST', json: { agentIds: [...sel], purpose, note: note.trim() || undefined } });
      toast(`Sent to ${r.sent} vigilante${r.sent === 1 ? '' : 's'} to ${purpose}${r.resent ? ` · ${r.resent} re-sent` : ''}`);
      onDone?.(); onClose();
    } catch (e: any) { setErr(e.message || 'Send failed'); } finally { inflight.current = false; setBusy(false); }
  };

  return (
    <Modal size="xl" title="Send to Vigilante" subtitle={inc ? `${inc.category} — ${inc.title} · ${inc.location}` : 'Nearby active agents'} onClose={onClose}
      footer={<>
        <input className="input vg-note" maxLength={500} placeholder="Note to agents (optional) — e.g. Confirm number of vehicles" value={note} onChange={(e) => setNote(e.target.value)} />
        <span className="hint" style={{ alignSelf: 'center', whiteSpace: 'nowrap' }}>{sel.size} selected</span>
        <button className="btn" disabled={!agents.length} onClick={() => setSel(allOn ? new Set() : new Set(agents.map((a) => a.id)))}>{allOn ? 'Clear All' : 'Select All'}</button>
        <button className="btn btn-agent-solid" disabled={!sel.size || busy || !can('ops')} onClick={send} data-tip={can('ops') ? `Ask the selected agents to ${purpose}` : 'Your role is read-only'}><ShieldCheck size={15} /> {busy ? 'Sending…' : 'Send to Vigilante'}</button>
      </>}>
      <div className="vg-bar">
        <div className="vg-ctl"><span className="label">Radius</span><div className="seg">{RADII.map((r) => <button key={r} className={radius === r ? 'on' : ''} onClick={() => setRadius(r)}>&lt; {r} km</button>)}</div></div>
        <div className="vg-ctl"><span className="label">Purpose</span><div className="seg">{PURPOSES.map(([k, l]) => <button key={k} className={purpose === k ? 'on' : ''} onClick={() => setPurpose(k)}>{l}</button>)}</div></div>
        <div className="search-mini vg-search"><Search size={15} /><input className="input" placeholder="Search agents…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {err && <div className="chip rose" style={{ height: 'auto', padding: '8px 10px', marginBottom: 12, display: 'flex' }}><AlertTriangle size={14} /> {err}</div>}
      <div className="vg-grid">
        <div className="vg-map">
          <div className="vg-map-head"><b>Vigilante Location &lt; {radius} km</b>{inc?.lat == null && d && <span className="chip amber">Incident has no coordinates — listing agents in {inc?.lga}</span>}</div>
          <GeoMap pins={pins} onPick={pickFromMap} circle={circle} focus={focus} fit />
          <div className="vg-legend"><span><i style={{ background: '#e11d48' }} />Incident</span><span><i style={{ background: '#16a34a' }} />Online</span><span><i style={{ background: '#94a3b8' }} />Offline</span><span><i style={{ background: '#2563eb' }} />Selected</span></div>
        </div>
        <div className="vg-list-wrap">
          <div className="vg-list-head"><b>Vigilante List</b><span className="hint">{d ? `${agents.length} agent${agents.length === 1 ? '' : 's'}${d.noLocation ? ` · ${d.noLocation} without location` : ''}${d.alreadySent ? ` · ${d.alreadySent} already sent` : ''}` : 'Loading…'}</span></div>
          <div className="vg-list scroll" ref={listRef}>
            {!d && !err && [1, 2, 3].map((i) => <div key={i} className="vg-card skeleton-card"><div className="skeleton" style={{ width: '70%' }} /><div className="skeleton" style={{ width: '40%' }} /></div>)}
            {d && !agents.length && <div className="empty" style={{ padding: 30 }}><div className="e-ico"><Users size={22} /></div><b>No active agents within {radius} km</b><div className="hint">Widen the radius to reach more vigilantes.</div></div>}
            {agents.map((a) => (
              <div key={a.id} data-agent={a.id} className={`vg-card ${sel.has(a.id) ? 'on' : ''} ${hl === a.id ? 'hl' : ''}`} onClick={() => toggle(a.id)} role="checkbox" aria-checked={sel.has(a.id)} tabIndex={0} onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), toggle(a.id))}>
                <div className="vg-top">
                  <span className={`vg-check ${sel.has(a.id) ? 'on' : ''}`}>{sel.has(a.id) && <Check size={13} />}</span>
                  <span className="vg-av">{initials(a.name)}<i className={a.online ? 'on' : ''} /></span>
                  <div className="vg-name"><b>{a.name}</b><small>{a.agency}</small></div>
                  <span className={`vg-dist ${a.distanceKm == null ? 'na' : ''}`} data-tip={a.distanceKm == null ? 'No location reported by this agent' : 'Distance from the incident'}><Navigation size={12} />{km(a.distanceKm)}</span>
                </div>
                <div className="vg-meta">
                  <span><Phone size={12} color="#0d9488" />{a.phone}</span>
                  <span><MapPin size={12} color="#ea580c" />{a.lga}</span>
                  <span><IdCard size={12} color="#7c3aed" />{a.tag || '—'}</span>
                  <span><CalendarPlus size={12} color="#8b5cf6" />Onboarded {a.onboarded.split(',').slice(0, 2).join(',')}</span>
                  <span className="wide"><LogIn size={12} color="#0ea5e9" />Last login {a.lastLogin || '—'}</span>
                </div>
                <div className="vg-foot">
                  {a.sent ? <span className="chip green"><BadgeCheck size={12} /> Sent {a.sentAt}</span> : <span className={`chip ${a.online ? 'green' : ''}`}>{a.online ? 'online' : 'offline'}</span>}
                  <button className="btn btn-sm" disabled={a.lat == null} onClick={(e) => { e.stopPropagation(); if (a.lat != null && a.lng != null) { setFocus({ lat: a.lat, lng: a.lng, n: Date.now() }); setHl(a.id); } }} data-tip={a.lat == null ? 'No location' : 'Show on map'}><MapPin size={13} /> Map</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
