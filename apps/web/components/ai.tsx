'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Download, MessageSquarePlus, Send, Sparkles, X } from 'lucide-react';
import { api, timeAgo } from '@/lib/api';
import { useApp } from './providers';

type Sess = { id: string; title: string; updatedAt: string };
type Meta = { exports?: { id: string; name: string; rows: number; url: string }[]; tables?: { title: string; columns: { key: string; label: string }[]; rows: any[]; total: number }[]; tools?: string[]; stub?: boolean };
type Msg = { id?: string; role: 'user' | 'assistant'; content: string; status?: string; meta?: Meta | null };
const SUGGEST = ['How many ARTSMA agents were onboarded this week?', 'Generate a CSV of all Umuahia North agents', 'Break down new reports by LGA', 'How many panic alarms are unresolved?'];

/** Tiny safe markdown: **bold**, `code`, bullets, line breaks. No HTML injection (React text nodes only). */
function Md({ text }: { text: string }) {
  return <>{text.split('\n').map((line, i) => {
    const bullet = /^\s*[-*•]\s+/.test(line); const body = line.replace(/^\s*[-*•]\s+/, '');
    const parts = body.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, j) => p.startsWith('**') && p.endsWith('**') ? <b key={j}>{p.slice(2, -2)}</b> : p.startsWith('`') && p.endsWith('`') ? <code key={j}>{p.slice(1, -1)}</code> : <span key={j}>{p}</span>);
    return bullet ? <div key={i} style={{ display: 'flex', gap: 6 }}><span>•</span><span>{parts}</span></div> : <div key={i} style={{ minHeight: line ? undefined : 8 }}>{parts}</div>;
  })}</>;
}
function MsgView({ m }: { m: Msg }) {
  if (m.status === 'pending') return <div className="msg assistant"><span className="typing"><i /><i /><i /></span></div>;
  return (
    <div className={`msg ${m.role}`}>
      <Md text={m.content} />
      {m.meta?.tables?.map((t) => (
        <div key={t.title} style={{ marginTop: 8 }}>
          <div className="hint" style={{ marginBottom: 4 }}>{t.title}{t.total > t.rows.length ? ` · first ${t.rows.length} of ${t.total}` : ''}</div>
          <table><thead><tr>{t.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>{t.rows.slice(0, 12).map((r, i) => <tr key={i}>{t.columns.map((c, j) => <td key={c.key}>{j === 0 && r._id ? <Link href={`/e/${r._id}`}>{String(r[c.key] ?? '')}</Link> : String(r[c.key] ?? '')}</td>)}</tr>)}</tbody></table>
        </div>
      ))}
      {m.meta?.exports?.map((x) => <a key={x.id} className="ex-link" href={x.url} download><Download size={13} /> {x.name} · {x.rows} rows</a>)}
    </div>
  );
}

export function AiFab() {
  const { toast, live } = useApp();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Record<string, string>>({}); // messageId -> sessionId
  const [unseen, setUnseen] = useState(false);
  const openRef = useRef(open); openRef.current = open;
  const curRef = useRef(current); curRef.current = current;
  const end = useRef<HTMLDivElement>(null);
  const busy = Object.keys(pending).length > 0;

  const loadSessions = () => api<Sess[]>('/ai/sessions').then(setSessions).catch(() => undefined);
  useEffect(() => { if (open) { loadSessions(); setUnseen(false); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [open]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  const settle = useCallback(async (messageId: string) => {
    const m = await api<Msg & { sessionId: string }>(`/ai/messages/${messageId}`).catch(() => null);
    if (!m || m.status === 'pending') return false;
    setPending((p) => { const n = { ...p }; delete n[messageId]; return n; });
    if (m.sessionId === curRef.current) setMsgs((list) => list.map((x) => (x.id === messageId ? { ...m, role: 'assistant' } : x)));
    loadSessions();
    if (!openRef.current) { setUnseen(true); toast('AcIntel Assist finished a task in the background', 'info'); }
    return true;
  }, [toast]);
  // Push: SSE ai.done → fetch just that message.
  useEffect(() => {
    const h = (e: Event) => { const id = (e as CustomEvent).detail?.messageId; if (id && pending[id]) settle(id); };
    window.addEventListener('acintel:ai', h); return () => window.removeEventListener('acintel:ai', h);
  }, [pending, settle]);
  // Heal: if the stream is down, check pending messages every 5s (only while something is pending).
  useEffect(() => {
    if (!busy || live === 'live') return;
    const t = setInterval(() => Object.keys(pending).forEach((id) => settle(id)), 5000);
    return () => clearInterval(t);
  }, [busy, live, pending, settle]);

  const openSession = async (id: string) => {
    setCurrent(id);
    const s = await api<{ messages: Msg[] }>(`/ai/sessions/${id}`).catch(() => null);
    setMsgs(s?.messages || []);
  };
  // Runs in the background by default: closing the panel never cancels the request.
  const send = async (message = text) => {
    if (!message.trim()) return;
    setText('');
    setMsgs((m) => [...m, { role: 'user', content: message }]);
    try {
      const r = await api<{ sessionId: string; messageId: string }>('/ai/chat', { method: 'POST', json: { sessionId: current, message } });
      setCurrent(r.sessionId); curRef.current = r.sessionId;
      setMsgs((m) => [...m, { id: r.messageId, role: 'assistant', content: '', status: 'pending' }]);
      setPending((p) => ({ ...p, [r.messageId]: r.sessionId }));
      loadSessions();
    } catch (e: any) {
      setMsgs((m) => [...m, { role: 'assistant', content: `Sorry — ${e.message || 'request failed'}` }]);
    }
  };

  return (
    <>
      {open && (
        <div className="ai-panel" role="dialog" aria-label="AcIntel Assist">
          <div className="ai-side">
            <div className="s-head">Sessions <button className="icon-btn" style={{ width: 30, height: 30 }} data-tip="New session" onClick={() => { setCurrent(null); setMsgs([]); }}><MessageSquarePlus size={16} /></button></div>
            <div className="ai-sessions">
              {!sessions.length && <div className="hint" style={{ padding: '4px 10px' }}>No sessions yet.</div>}
              {sessions.map((s) => (
                <button key={s.id} className={`ai-sess ${s.id === current ? 'on' : ''}`} onClick={() => openSession(s.id)}>
                  <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</span><small>{timeAgo(s.updatedAt)}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="ai-main">
            <div className="ai-top">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="brand-mark" style={{ width: 30, height: 30, borderRadius: 9 }}><Sparkles size={15} /></span>
                <b style={{ fontSize: 13.5 }}>AcIntel Assist</b>
              </div>
              <button className="icon-btn" onClick={() => setOpen(false)} data-tip="Minimise" data-tip-pos="left" aria-label="Close assistant"><X size={18} /></button>
            </div>
            <div className="ai-msgs">
              {!msgs.length && (
                <div style={{ margin: 'auto 0', display: 'grid', gap: 14 }}>
                  <b style={{ fontSize: 15 }}>Ask about the control room</b>
                  <div className="suggest">{SUGGEST.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}</div>
                </div>
              )}
              {msgs.map((m, i) => <MsgView key={m.id || i} m={m} />)}
              <div ref={end} />
            </div>
            <div className="ai-input">
              <input className="input" placeholder="Ask or give a task…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
              <button className="btn btn-primary" onClick={() => send()} disabled={!text.trim()}><Send size={15} /></button>
            </div>
          </div>
        </div>
      )}
      {!open && (
        <button className="fab" onClick={() => setOpen(true)} data-tip="AcIntel Assist" data-tip-pos="left" aria-label="Open AcIntel Assist">
          <Sparkles size={24} />
          {(busy || unseen) && <span className="live-dot" />}
        </button>
      )}
    </>
  );
}
