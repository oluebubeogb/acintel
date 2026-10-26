'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Undo2 } from 'lucide-react';
import { api } from '@/lib/api';

type Me = { email: string; name: string; role: string; publicId: string; perms: string[] };
export type Kpi = { incidents: Record<string, number>; agents: Record<string, number>; users: Record<string, number>; alarmsNew: Record<string, number> };
type Counts = { targets: Record<string, number>; parents: Record<string, number>; total: number; kpi?: Kpi; chats?: number; at?: string };
type Prefs = { site: Record<string, any>; admin: Record<string, any>; effective: Record<string, any> };
type Toast = { id: number; kind: 'success' | 'error' | 'info'; text: string; undo?: string[]; onUndone?: () => void };
export type ConfirmOpts = { title: string; body?: React.ReactNode; items?: string[]; confirm?: string; danger?: boolean; input?: { label: string; placeholder?: string; required?: boolean } };
type Live = 'connecting' | 'live' | 'offline';

type Ctx = {
  me: Me | null; can: (perm: string) => boolean; counts: Counts; refreshCounts: () => void; markRead: (target: string) => void;
  prefs: Prefs | null; savePrefs: (scope: 'site' | 'admin', values: Record<string, any>) => Promise<void>;
  toast: (text: string, kind?: Toast['kind'], opts?: { undo?: string[]; onUndone?: () => void }) => void; pageSize: number;
  confirm: (o: ConfirmOpts) => Promise<false | { value: string }>;
  openDay: (date: string, entity?: string) => void; day: { date: string; entity?: string } | null; closeDay: () => void;
  live: Live;
};
const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => { const c = useContext(AppCtx); if (!c) throw new Error('useApp outside provider'); return c; };

/** Subscribe to realtime "changed" events for given keys (e.g. ['users','agents']). */
export function useLive(keys: string[], fn: () => void) {
  const ref = useRef(fn); ref.current = fn;
  const k = keys.join(',');
  useEffect(() => {
    let t: any;
    const h = (e: Event) => {
      const changed: string[] = (e as CustomEvent).detail?.keys || [];
      if (!k || !changed.length || changed.some((c) => k.split(',').includes(c))) { clearTimeout(t); t = setTimeout(() => ref.current(), 400); }
    };
    window.addEventListener('acintel:changed', h);
    return () => { window.removeEventListener('acintel:changed', h); clearTimeout(t); };
  }, [k]);
}

/** Max chars per excerpt line — anything longer is clipped with an ellipsis (also CSS-clamped to one line). */
export const EXCERPT_MAX = 84;
export const clip = (s: string, n = EXCERPT_MAX) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

/** Line-by-line list of affected records: first 5 visible, the rest behind "Show N more". */
export function ExcerptList({ items, max = 5 }: { items: string[]; max?: number }) {
  const [open, setOpen] = useState(false);
  const shown = open ? items : items.slice(0, max);
  return (
    <div className="excerpts">
      <ol className={open && items.length > 12 ? 'scroll' : ''}>{shown.map((t, i) => <li key={i} className="excerpt" title={t}><span className="ex-n">{i + 1}</span><span className="ex-t">{clip(t)}</span></li>)}</ol>
      {items.length > max && <button type="button" className="ex-more" onClick={() => setOpen(!open)}>{open ? 'Show less' : `Show ${items.length - max} more`}</button>}
    </div>
  );
}

function ConfirmDialog({ o, onDone }: { o: ConfirmOpts; onDone: (v: false | { value: string }) => void }) {
  const [v, setV] = useState('');
  const ok = !o.input?.required || v.trim().length > 0;
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onDone(false); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onDone]);
  return (
    <div className="overlay" style={{ zIndex: 110 }} onMouseDown={(e) => e.target === e.currentTarget && onDone(false)}>
      <div className="modal modal-sm" role="alertdialog" aria-modal="true" aria-label={o.title}>
        <div className="modal-head"><div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span className={`confirm-ico ${o.danger ? 'danger' : ''}`}>{o.danger ? <AlertTriangle size={18} /> : <Info size={18} />}</span>
          <div><h2>{o.title}</h2>{o.body && <div className="hint" style={{ marginTop: 4 }}>{o.body}</div>}</div></div></div>
        {o.items?.length ? <div className="modal-body" style={{ paddingTop: 0, paddingBottom: o.input ? 6 : undefined }}><ExcerptList items={o.items} /></div> : null}
        {o.input && <div className="modal-body" style={{ paddingTop: 0 }}><label className="label">{o.input.label}</label>
          <textarea autoFocus className="textarea" style={{ minHeight: 70 }} placeholder={o.input.placeholder} value={v} onChange={(e) => setV(e.target.value)} /></div>}
        <div className="modal-foot">
          <button className="btn" onClick={() => onDone(false)}>Cancel</button>
          <button autoFocus={!o.input} className={`btn ${o.danger ? 'btn-danger-solid' : 'btn-primary'}`} disabled={!ok} onClick={() => onDone({ value: v.trim() })}>{o.confirm || 'Confirm'}</button>
        </div>
      </div>
    </div>
  );
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [counts, setCounts] = useState<Counts>({ targets: {}, parents: {}, total: 0 });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dlg, setDlg] = useState<{ o: ConfirmOpts; res: (v: false | { value: string }) => void } | null>(null);
  const [day, setDay] = useState<{ date: string; entity?: string } | null>(null);
  const [live, setLive] = useState<Live>('connecting');
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((text: string, kind: Toast['kind'] = 'success', opts?: { undo?: string[]; onUndone?: () => void }) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-4), { id, kind, text, ...opts }]);
    setTimeout(() => dismiss(id), opts?.undo?.length ? 9000 : 3600);
  }, [dismiss]);
  // Live counters: one cheap /counts payload (badges + KPI numbers). Pushed refreshes (SSE) are debounced so a
  // burst of events costs one request; failures back off exponentially (see poll loop below).
  const countsReady = useRef(false); const fails = useRef(0); const inflight = useRef(false); const deb = useRef<any>(null);
  const fetchCounts = useCallback(async () => {
    if (inflight.current) return; inflight.current = true;
    try { const c = await api<Counts>('/counts'); countsReady.current = true; setCounts(c); fails.current = 0; } catch { fails.current = Math.min(fails.current + 1, 6); } finally { inflight.current = false; }
  }, []);
  const refreshCounts = useCallback(() => { clearTimeout(deb.current); deb.current = setTimeout(fetchCounts, 350); }, [fetchCounts]);
  const markRead = useCallback((target: string) => {
    setCounts((c) => {
      const n = c.targets[target] || 0; if (!n) return c;
      const p = target.split('.')[0];
      return { ...c, targets: { ...c.targets, [target]: 0, 'alerts.feed': Math.max(0, (c.targets['alerts.feed'] || 0) - n) },
        parents: { ...c.parents, [p]: Math.max(0, (c.parents[p] || 0) - n), alerts: Math.max(0, (c.parents.alerts || 0) - n) }, total: c.total - n };
    });
    api('/notifications/read', { method: 'POST', json: { target } }).catch(() => undefined);
  }, []);
  const savePrefs = useCallback(async (scope: 'site' | 'admin', values: Record<string, any>) => { setPrefs(await api<Prefs>('/prefs', { method: 'PUT', json: { scope, values } })); }, []);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<false | { value: string }>((res) => setDlg({ o, res })), []);
  const undo = async (t: Toast) => {
    dismiss(t.id);
    try { const r = await api<{ undone: number; errors: string[] }>('/audit/undo', { method: 'POST', json: { ids: t.undo } });
      toast(r.undone ? `Undone (${r.undone})` : r.errors?.[0] || 'Nothing to undo', r.undone ? 'success' : 'error'); t.onUndone?.(); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  useEffect(() => {
    api<Me>('/auth/me').then(setMe).catch(() => undefined);
    api<Prefs>('/prefs').then(setPrefs).catch(() => undefined);
    refreshCounts();
  }, [refreshCounts]);

  // Realtime push over SSE (/api/stream ← Redis pub/sub): one connection per tab. Closed after 60s hidden and
  // reopened on return, so idle background tabs hold no server connection.
  useEffect(() => {
    let es: EventSource | null = null; let retry: any; let hideT: any;
    const connect = () => {
      if (es || document.visibilityState !== 'visible') return;
      es = new EventSource('/api/stream');
      es.addEventListener('hello', () => setLive('live')); // server follows hello with a counts snapshot
      // Push-on-write: the API publishes the full counts payload after every write — apply it, no request needed.
      es.addEventListener('counts', (e) => { try { const d = JSON.parse((e as MessageEvent).data); if (d?.data?.targets) { countsReady.current = true; setCounts(d.data); fails.current = 0; } else refreshCounts(); } catch { refreshCounts(); } });
      es.addEventListener('changed', (e) => { let keys: string[] = []; try { keys = JSON.parse((e as MessageEvent).data).keys || []; } catch { /* */ }
        window.dispatchEvent(new CustomEvent('acintel:changed', { detail: { keys } })); });
      es.addEventListener('ai.done', (e) => window.dispatchEvent(new CustomEvent('acintel:ai', { detail: JSON.parse((e as MessageEvent).data) })));
      for (const t of ['chat.message', 'chat.read']) es.addEventListener(t, (e) => window.dispatchEvent(new CustomEvent('acintel:chat', { detail: { event: t, ...JSON.parse((e as MessageEvent).data) } })));
      es.addEventListener('ai.title', (e) => window.dispatchEvent(new CustomEvent('acintel:ai-title', { detail: JSON.parse((e as MessageEvent).data) })));
      es.onerror = () => { setLive('offline'); if (es?.readyState === EventSource.CLOSED) { es.close(); es = null; clearTimeout(retry); retry = setTimeout(connect, 10000); } };
    };
    const close = () => { es?.close(); es = null; setLive('offline'); };
    const onVis = () => {
      clearTimeout(hideT);
      if (document.visibilityState === 'visible') { connect(); refreshCounts(); } else hideT = setTimeout(close, 60000);
    };
    connect();
    document.addEventListener('visibilitychange', onVis);
    return () => { close(); clearTimeout(retry); clearTimeout(hideT); document.removeEventListener('visibilitychange', onVis); };
  }, [refreshCounts]);

  // Heal-only fallback poll (never the primary path): SSE live → one /counts every 120s while visible, to repair
  // anything missed across a reconnect. SSE down (e.g. a proxy that blocks streaming) → `pollSeconds` from Settings
  // (clamped 10–120s, default 15). Hidden tab → nothing. Errors back off exponentially to 5 min.
  const pollSeconds = Math.min(120, Math.max(10, Number(prefs?.effective.pollSeconds) || 15));
  useEffect(() => {
    let t: any; let dead = false;
    const base = (live === 'live' ? 120 : pollSeconds) * 1000;
    const loop = async () => {
      if (dead) return;
      if (document.visibilityState === 'visible') await fetchCounts();
      t = setTimeout(loop, Math.min(base * 2 ** fails.current, 300000));
    };
    t = setTimeout(loop, base);
    return () => { dead = true; clearTimeout(t); };
  }, [pollSeconds, fetchCounts, live]);

  // Soft chime for new alarms: fires only when Settings → Sound On Alarm is ON (strict true), only after prefs AND a real
  // counts payload have loaded (no chime on page load), and only when the unread 'alarms.new' count actually rises.
  const soundOn = prefs?.effective.notifySound === true;
  useEffect(() => { setChimeEnabled(prefs ? soundOn : false); }, [prefs, soundOn]);
  // Other tabs / admins saving Settings → refetch prefs at once so a switched-off sound is honoured everywhere.
  useEffect(() => {
    const h = (e: Event) => { if (((e as CustomEvent).detail?.keys || []).includes('prefs')) api<Prefs>('/prefs').then(setPrefs).catch(() => undefined); };
    window.addEventListener('acintel:changed', h); return () => window.removeEventListener('acintel:changed', h);
  }, []);
  const lastAlarms = useRef<number | null>(null);
  useEffect(() => { unlockChime(); }, []);
  useEffect(() => {
    if (!prefs || !countsReady.current) return; // prefs or the first real counts payload not loaded yet
    const n = counts.targets['alarms.new'] || 0;
    if (lastAlarms.current !== null && n > lastAlarms.current && soundOn) playChime();
    lastAlarms.current = n;
  }, [counts, prefs, soundOn]);

  const can = useCallback((perm: string) => !!me && (me.perms?.includes('*') || me.perms?.includes(perm)), [me]);
  const pageSize = Number(prefs?.effective.pageSize) || 500;
  return (
    <AppCtx.Provider value={{ me, can, counts, refreshCounts, markRead, prefs, savePrefs, toast, pageSize, confirm, live,
      openDay: (date, entity) => setDay({ date, entity }), day, closeDay: () => setDay(null) }}>
      {children}
      {dlg && <ConfirmDialog o={dlg.o} onDone={(v) => { dlg.res(v); setDlg(null); }} />}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'success' ? <CheckCircle2 size={17} /> : t.kind === 'error' ? <AlertCircle size={17} /> : <Info size={17} />}<span style={{ flex: 1 }}>{t.text}</span>
            {t.undo?.length ? <button className="toast-undo" onClick={() => undo(t)} data-tip="Revert this change (24h window)"><Undo2 size={14} /> Undo</button> : null}
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}

/* ---------- Web Audio chime ----------
 * Gate: every chime goes through `chimeEnabled`, which is false until prefs load and mirrors Settings → Sound On Alarm.
 * Tone: one warm sine (E5) + a quiet octave partial through a low-pass, peak gain 0.06, linear 30ms attack from true
 * silence and an exponential tail that ends at ~-80dB before the oscillator stops — no clipping, no click on stop. */
let audioCtx: AudioContext | null = null;
let lastChime = 0;
let chimeEnabled = false;
export function setChimeEnabled(on: boolean) { chimeEnabled = on; }
function ctx() {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) { const AC = window.AudioContext || (window as any).webkitAudioContext; if (!AC) return null; audioCtx = new AC({ latencyHint: 'playback' }); }
  return audioCtx;
}
/** Browsers start audio suspended until a user gesture — resume on the first click/key so later chimes can play. */
function unlockChime() {
  const go = () => { ctx()?.resume().catch(() => undefined); window.removeEventListener('pointerdown', go); window.removeEventListener('keydown', go); };
  window.addEventListener('pointerdown', go); window.addEventListener('keydown', go);
}
/** Plays the alarm chime if sound is on. `preview` (Settings switch being turned on) bypasses the gate once. */
export async function playChime(opts: { preview?: boolean } = {}) {
  if (!opts.preview && !chimeEnabled) return;
  const ac = ctx(); if (!ac) return;
  const now = performance.now(); if (now - lastChime < 2000) return; lastChime = now;
  try { if (ac.state !== 'running') await ac.resume(); } catch { return; }
  if (ac.state !== 'running') return; // still locked (no user gesture yet) — stay silent rather than glitch later
  const t = ac.currentTime + 0.06; // schedule slightly ahead so the first samples are never dropped
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 0.5;
  const out = ac.createGain(); out.gain.value = 1;
  lp.connect(out); out.connect(ac.destination);
  const voices: [number, number, number][] = [[659.25, 0.06, 0], [1318.5, 0.012, 0], [987.77, 0.035, 0.16]];
  let end = t;
  for (const [f, peak, d] of voices) {
    const o = ac.createOscillator(); const g = ac.createGain();
    const s = t + d, len = 1.1;
    o.type = 'sine'; o.frequency.setValueAtTime(f, s);
    g.gain.setValueAtTime(0, s);
    g.gain.linearRampToValueAtTime(peak, s + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, s + len);
    g.gain.linearRampToValueAtTime(0, s + len + 0.05);
    o.connect(g); g.connect(lp); o.start(s); o.stop(s + len + 0.1);
    end = Math.max(end, s + len + 0.1);
  }
  setTimeout(() => { try { out.disconnect(); lp.disconnect(); } catch { /* */ } }, (end - ac.currentTime + 0.3) * 1000);
}

/** Badge that pops when its number goes up. */
export function CountBadge({ n, soft }: { n?: number; soft?: boolean }) {
  const prev = useRef(n || 0);
  const [bump, setBump] = useState(false);
  useEffect(() => {
    if ((n || 0) > prev.current) { setBump(true); const t = setTimeout(() => setBump(false), 450); prev.current = n || 0; return () => clearTimeout(t); }
    prev.current = n || 0;
  }, [n]);
  if (!n) return null;
  return <span className={`badge ${soft ? 'badge-soft' : ''} ${bump ? 'bump' : ''}`}>{n > 99 ? '99+' : n}</span>;
}
