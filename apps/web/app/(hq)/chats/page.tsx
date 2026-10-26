'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Check, CheckCheck, ImagePlus, Loader2, MessageCirclePlus, MessagesSquare, Mic, Pause, Play, Search, Send, ShieldAlert, Square, Trash2, UserRound, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApp } from '@/components/providers';

type Agent = { id: string; name: string; phone: string; tag: string; lga: string; group: string; status: string; online: boolean; lastSeen: string | null; thread?: string | null };
type ThreadRow = { id: string; agent: Agent; lastAt: string; when: string; preview: string; lastSender: string | null; unread: number; match: { id: string; text: string } | null };
type Msg = { id: string; sender: 'admin' | 'agent'; by: string | null; body: string; kind: 'text' | 'image' | 'voice'; url: string | null; mime: string | null; durationSec: number | null; read: boolean; at: string; when: string; pending?: boolean };
type Thread = { id: string; agent: Agent; messages: Msg[]; more: boolean };

const TZ = 'Africa/Lagos';
const dayKey = (d: string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(d));
const clock = (d: string) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h12' }).format(new Date(d));
function listStamp(d: string) {
  const k = dayKey(d); const today = dayKey(new Date().toISOString()); const yest = dayKey(new Date(Date.now() - 86400000).toISOString());
  if (k === today) return clock(d);
  if (k === yest) return 'Yesterday';
  if (Date.now() - new Date(d).getTime() < 6 * 86400000) return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short' }).format(new Date(d));
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short' }).format(new Date(d));
}
function dayLabel(k: string) {
  const today = dayKey(new Date().toISOString()); const yest = dayKey(new Date(Date.now() - 86400000).toISOString());
  if (k === today) return 'Today'; if (k === yest) return 'Yesterday';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${k}T12:00:00+01:00`));
}
const initials = (n: string) => n.split(' ').map((s) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
const HUES = ['#2563eb', '#0d9488', '#7c3aed', '#d97706', '#db2777', '#059669', '#0891b2', '#4f46e5'];
const hue = (id: string) => HUES[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % HUES.length];
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function Avatar({ a, size = 40 }: { a: Agent; size?: number }) {
  return <span className="chat-av" style={{ width: size, height: size, background: hue(a.id), fontSize: size * 0.36 }}>{initials(a.name)}{a.online && <i className="chat-online" />}</span>;
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

/** Compact voice-note player: play/pause, scrubber, elapsed / total. */
function VoiceNote({ src, dur, mine }: { src: string; dur: number | null; mine: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false); const [t, setT] = useState(0); const [total, setTotal] = useState(dur || 0);
  useEffect(() => {
    const a = ref.current; if (!a) return;
    const up = () => setT(a.currentTime); const meta = () => { if (Number.isFinite(a.duration) && a.duration > 0) setTotal(a.duration); };
    const end = () => { setPlaying(false); setT(0); };
    a.addEventListener('timeupdate', up); a.addEventListener('loadedmetadata', meta); a.addEventListener('durationchange', meta); a.addEventListener('ended', end); a.addEventListener('pause', () => setPlaying(false)); a.addEventListener('play', () => setPlaying(true));
    return () => { a.removeEventListener('timeupdate', up); a.removeEventListener('loadedmetadata', meta); a.removeEventListener('durationchange', meta); a.removeEventListener('ended', end); };
  }, []);
  const toggle = () => { const a = ref.current; if (!a) return; if (a.paused) { document.querySelectorAll('audio').forEach((x) => x !== a && x.pause()); a.play().catch(() => undefined); } else a.pause(); };
  const pct = total ? Math.min(100, (t / total) * 100) : 0;
  return (
    <div className={`voice ${mine ? 'mine' : ''}`}>
      <button className="voice-btn" onClick={toggle} aria-label={playing ? 'Pause voice note' : 'Play voice note'}>{playing ? <Pause size={16} /> : <Play size={16} style={{ marginLeft: 2 }} />}</button>
      <div className="voice-track" onClick={(e) => { const a = ref.current; if (!a || !total) return; const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); a.currentTime = ((e.clientX - r.left) / r.width) * total; }}>
        <div className="voice-bars">{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ height: `${30 + ((i * 37) % 70)}%`, opacity: (i / 28) * 100 < pct ? 1 : 0.35 }} />)}</div>
      </div>
      <span className="voice-time">{mmss(playing || t ? t : total)}</span>
      <audio ref={ref} src={src} preload="metadata" />
    </div>
  );
}

function PeoplePicker({ onPick, onClose }: { onPick: (a: Agent) => void; onClose: () => void }) {
  const [q, setQ] = useState(''); const [rows, setRows] = useState<Agent[] | null>(null);
  useEffect(() => { const t = setTimeout(() => api<Agent[]>(`/chats/people?q=${encodeURIComponent(q)}`).then(setRows).catch(() => setRows([])), 180); return () => clearTimeout(t); }, [q]);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-sm" role="dialog" aria-label="New Message">
        <div className="modal-head"><div><h2>New Message</h2><p>Message any active field agent directly.</p></div><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-body" style={{ paddingTop: 12 }}>
          <div className="chat-search" style={{ marginBottom: 10 }}><Search size={15} /><input autoFocus className="input" placeholder="Search agents by name, phone, tag or LGA" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="people-list">
            {!rows && <div className="hint" style={{ padding: 12 }}>Loading agents…</div>}
            {rows && !rows.length && <div className="hint" style={{ padding: 12 }}>No active agents match “{q}”.</div>}
            {rows?.map((a, i) => (
              <button key={a.id} className="people-row" style={{ animationDelay: `${i * 18}ms` }} onClick={() => onPick(a)}>
                <Avatar a={a} size={36} />
                <span className="pr-txt"><b><Highlight text={a.name} q={q} /></b><small>{a.lga} · {a.group}{a.tag ? ` · ${a.tag}` : ''}</small></span>
                <span className={`chip ${a.online ? 'green' : ''}`}>{a.online ? 'Online' : 'Offline'}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatsInner() {
  const { can, me, toast, refreshCounts } = useApp();
  const router = useRouter(); const sp = useSearchParams();
  const current = sp.get('t');
  const [q, setQ] = useState(''); const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [rows, setRows] = useState<ThreadRow[] | null>(null);
  const [thread, setThread] = useState<Thread | null>(null); const [loadingThread, setLoadingThread] = useState(false);
  const [text, setText] = useState(''); const [sending, setSending] = useState(false);
  const [picker, setPicker] = useState(false); const [lightbox, setLightbox] = useState<string | null>(null);
  const [rec, setRec] = useState<{ start: number; secs: number } | null>(null);
  const recRef = useRef<{ mr: MediaRecorder; chunks: Blob[]; stream: MediaStream; cancel?: boolean } | null>(null);
  const scroller = useRef<HTMLDivElement>(null); const fileRef = useRef<HTMLInputElement>(null); const inputRef = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true);
  const ops = can('ops');

  const loadList = useCallback(() => {
    api<{ rows: ThreadRow[] }>(`/chats?q=${encodeURIComponent(q)}&filter=${filter}`).then((d) => setRows(d.rows)).catch((e) => { if (!(e instanceof ApiError && e.status === 403)) toast(e.message, 'error'); });
  }, [q, filter, toast]);
  useEffect(() => { if (!ops) return; const t = setTimeout(loadList, q ? 200 : 0); return () => clearTimeout(t); }, [loadList, ops, q]);

  const markRead = useCallback((id: string) => { api(`/chats/${id}/read`, { method: 'POST' }).then((r: any) => { if (r?.marked) { refreshCounts(); setRows((rs) => rs?.map((x) => (x.id === id ? { ...x, unread: 0 } : x)) || rs); } }).catch(() => undefined); }, [refreshCounts]);
  const loadThread = useCallback((id: string, quiet = false) => {
    if (!quiet) setLoadingThread(true);
    return api<Thread>(`/chats/${id}`).then((t) => { setThread(t); if (document.visibilityState === 'visible') markRead(id); }).catch((e) => { toast(e.message, 'error'); setThread(null); }).finally(() => setLoadingThread(false));
  }, [markRead, toast]);
  useEffect(() => { if (current && ops) { atBottom.current = true; loadThread(current); } else setThread(null); }, [current, ops, loadThread]);

  // Live: Redis → SSE → 'acintel:chat'. Refresh the list; refresh the open thread when it is the one that moved.
  useEffect(() => {
    let t: any;
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      clearTimeout(t); t = setTimeout(loadList, 250);
      if (d.threadId && d.threadId === current) loadThread(d.threadId, true);
    };
    window.addEventListener('acintel:chat', h); return () => { window.removeEventListener('acintel:chat', h); clearTimeout(t); };
  }, [loadList, loadThread, current]);
  useEffect(() => { const v = () => { if (document.visibilityState === 'visible' && current) markRead(current); }; document.addEventListener('visibilitychange', v); return () => document.removeEventListener('visibilitychange', v); }, [current, markRead]);

  // Keep pinned to the newest message unless the reader scrolled up.
  const shownId = useRef<string | null>(null);
  const pin = useCallback((smooth = false) => { const el = scroller.current; if (el && atBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); }, []);
  useEffect(() => { if (!thread) return; const first = shownId.current !== thread.id; shownId.current = thread.id; requestAnimationFrame(() => pin(!first)); }, [thread, pin]);
  const onScroll = () => { const el = scroller.current; if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };

  const open = (id: string) => router.push(`/chats?t=${id}`);
  const start = async (a: Agent) => {
    setPicker(false);
    try { const r = await api<{ id: string }>('/chats/start', { method: 'POST', json: { agentId: a.id } }); open(r.id); loadList(); } catch (e: any) { toast(e.message, 'error'); }
  };

  const pushLocal = (m: Msg) => { atBottom.current = true; setThread((t) => (t ? { ...t, messages: [...t.messages, m] } : t)); };
  const sendText = async () => {
    const body = text.trim(); if (!body || !thread || sending) return;
    setSending(true); setText('');
    const tmp: Msg = { id: `tmp-${Date.now()}`, sender: 'admin', by: me?.name || null, body, kind: 'text', url: null, mime: null, durationSec: null, read: false, at: new Date().toISOString(), when: '', pending: true };
    pushLocal(tmp);
    try { const m = await api<Msg>(`/chats/${thread.id}/messages`, { method: 'POST', json: { body } }); setThread((t) => (t ? { ...t, messages: t.messages.map((x) => (x.id === tmp.id ? m : x)) } : t)); loadList(); }
    catch (e: any) { toast(e.message, 'error'); setText(body); setThread((t) => (t ? { ...t, messages: t.messages.filter((x) => x.id !== tmp.id) } : t)); }
    finally { setSending(false); inputRef.current?.focus(); }
  };
  const upload = async (file: Blob, name: string, extra: Record<string, string> = {}) => {
    if (!thread) return;
    const fd = new FormData(); fd.append('file', file, name); for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    setSending(true);
    try {
      const r = await fetch(`/api/chats/${thread.id}/attachments`, { method: 'POST', body: fd, credentials: 'same-origin' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || 'Upload failed');
      pushLocal(d as Msg); loadList();
    } catch (e: any) { toast(e.message, 'error'); } finally { setSending(false); }
  };
  const pickImage = (f?: File | null) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('Choose a photo (JPG, PNG, WebP or GIF)', 'error');
    upload(f, f.name, text.trim() ? { body: text.trim() } : {}); setText('');
  };

  // Voice notes via MediaRecorder (Opus/WebM in Chromium + Firefox, MP4/AAC in Safari).
  useEffect(() => { if (!rec) return; const i = setInterval(() => setRec((r) => (r ? { ...r, secs: (Date.now() - r.start) / 1000 } : r)), 200); return () => clearInterval(i); }, [rec?.start]); // eslint-disable-line react-hooks/exhaustive-deps
  const startRec = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return toast('Voice notes need a browser with microphone support', 'error');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
      const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const ctx = { mr, chunks: [] as Blob[], stream, cancel: false };
      mr.ondataavailable = (e) => e.data.size && ctx.chunks.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const secs = (Date.now() - started) / 1000;
        if (ctx.cancel || secs < 0.6) return;
        const mime = (mr.mimeType || 'audio/webm').split(';')[0];
        upload(new Blob(ctx.chunks, { type: mime }), `voice-note.${mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm'}`, { durationSec: secs.toFixed(1) });
      };
      const started = Date.now();
      recRef.current = ctx; mr.start(250); setRec({ start: started, secs: 0 });
    } catch { toast('Microphone permission was blocked — allow it in the browser to record', 'error'); }
  };
  const stopRec = (cancel = false) => { const c = recRef.current; if (!c) return; c.cancel = cancel; if (c.mr.state !== 'inactive') c.mr.stop(); recRef.current = null; setRec(null); };
  useEffect(() => () => { const c = recRef.current; if (c) { c.cancel = true; c.mr.state !== 'inactive' && c.mr.stop(); } }, []);

  const groups = useMemo(() => {
    const out: { day: string; msgs: Msg[] }[] = [];
    for (const m of thread?.messages || []) { const k = dayKey(m.at); if (!out.length || out[out.length - 1].day !== k) out.push({ day: k, msgs: [] }); out[out.length - 1].msgs.push(m); }
    return out;
  }, [thread]);
  const lastMineRead = useMemo(() => { const mine = (thread?.messages || []).filter((m) => m.sender === 'admin' && !m.pending); return mine.length ? mine[mine.length - 1].id : null; }, [thread]);
  const unreadTotal = rows?.reduce((n, r) => n + r.unread, 0) || 0;

  if (me && !ops) return <div className="card card-pad empty"><div className="e-ico"><ShieldAlert size={22} /></div><b>Chats are for the control room</b><div className="hint">Superadmins and controllers can message field agents. Your role is read-only.</div></div>;

  return (
    <div className="chats-page">
      <div className="page-head" style={{ marginBottom: 14 }}>
        <h1 className="title">Chats</h1>
        <button className="btn btn-primary" onClick={() => setPicker(true)}><MessageCirclePlus size={15} /> New Message</button>
      </div>
      <div className={`chat-shell card ${current ? 'has-thread' : ''}`}>
        <aside className="chat-list">
          <div className="chat-list-head">
            <div className="chat-search"><Search size={15} /><input className="input" placeholder="Search people or messages" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search chats" />{q && <button className="icon-btn" onClick={() => setQ('')} aria-label="Clear search"><X size={14} /></button>}</div>
            <div className="seg chat-seg">
              <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</button>
              <button className={filter === 'unread' ? 'on' : ''} onClick={() => setFilter('unread')}>Unread{unreadTotal > 0 && filter === 'all' ? <span className="seg-n">{unreadTotal}</span> : null}</button>
            </div>
          </div>
          <div className="chat-threads">
            {!rows && Array.from({ length: 6 }, (_, i) => <div key={i} className="thread-row sk"><span className="skeleton" style={{ width: 40, height: 40, borderRadius: 20 }} /><span style={{ flex: 1 }}><span className="skeleton" style={{ width: '60%' }} /><span className="skeleton" style={{ width: '85%', marginTop: 8 }} /></span></div>)}
            {rows && !rows.length && (
              <div className="empty" style={{ padding: '40px 16px' }}><div className="e-ico"><MessagesSquare size={22} /></div><b>{q ? 'No matches' : filter === 'unread' ? 'All caught up' : 'No conversations yet'}</b>
                <div className="hint">{q ? `Nothing matches “${q}”.` : filter === 'unread' ? 'Every agent message has been read.' : 'Start one with New Message or from an agent’s page.'}</div></div>
            )}
            {rows?.map((r, i) => (
              <button key={r.id} className={`thread-row ${r.id === current ? 'on' : ''} ${r.unread ? 'unread' : ''}`} style={{ animationDelay: `${Math.min(i, 12) * 20}ms` }} onClick={() => open(r.id)}>
                <Avatar a={r.agent} />
                <span className="tr-main">
                  <span className="tr-top"><b><Highlight text={r.agent.name} q={q} /></b><small>{listStamp(r.lastAt)}</small></span>
                  <span className="tr-bottom">
                    <span className="tr-prev">{r.match ? <><Search size={11} /> <Highlight text={r.match.text} q={q} /></> : <>{r.lastSender === 'admin' && <span className="tr-you">You: </span>}{r.preview || 'No messages yet'}</>}</span>
                    {r.unread > 0 && <span className="badge">{r.unread}</span>}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="chat-pane">
          {!current && (
            <div className="chat-empty"><div className="ce-ico"><MessagesSquare size={28} /></div><b>Direct Messages With Field Agents</b><p>Pick a conversation, or start a new one. Photos and voice notes are supported; agents’ replies arrive live.</p>
              <button className="btn btn-primary" onClick={() => setPicker(true)}><MessageCirclePlus size={15} /> New Message</button></div>
          )}
          {current && (loadingThread && !thread ? <div className="chat-empty"><Loader2 className="spin" size={22} /></div> : thread && (
            <>
              <header className="chat-head">
                <button className="icon-btn mobile-back" onClick={() => router.push('/chats')} aria-label="Back to conversations"><ArrowLeft size={18} /></button>
                <Avatar a={thread.agent} size={40} />
                <div className="ch-txt"><b>{thread.agent.name}</b><small>{thread.agent.online ? <span className="ch-on">Online now</span> : thread.agent.lastSeen ? `Last seen ${thread.agent.lastSeen}` : 'Not seen yet'} · {thread.agent.lga} · {thread.agent.group}</small></div>
                {thread.agent.status !== 'active' && <span className="chip rose">{thread.agent.status}</span>}
                <Link href={`/e/${thread.agent.id}`} className="btn btn-sm" data-tip="Open agent profile" data-tip-pos="left"><UserRound size={14} /> Profile</Link>
              </header>
              <div className="chat-scroll" ref={scroller} onScroll={onScroll}>
                {!thread.messages.length && <div className="chat-start-hint">Say hello to {thread.agent.name.split(' ')[0]} — messages are delivered to their AcIntel agent app.</div>}
                {groups.map((g) => (
                  <div key={g.day}>
                    <div className="day-sep"><span>{dayLabel(g.day)}</span></div>
                    {g.msgs.map((m, i) => {
                      const mine = m.sender === 'admin'; const prev = g.msgs[i - 1]; const tail = !g.msgs[i + 1] || g.msgs[i + 1].sender !== m.sender;
                      const showBy = mine && m.by && (!prev || prev.sender !== 'admin' || prev.by !== m.by);
                      return (
                        <div key={m.id} className={`msg ${mine ? 'mine' : 'theirs'} ${tail ? 'tail' : ''} ${m.pending ? 'pending' : ''}`}>
                          {showBy && <div className="msg-by">{m.by === me?.name ? 'You' : m.by}</div>}
                          <div className={`bubble kind-${m.kind}`}>
                            {m.kind === 'image' && m.url && <button className="msg-img" onClick={() => setLightbox(m.url)} aria-label="Open photo"><img src={m.url} alt={m.body || 'Photo'} onLoad={() => pin()} /></button>}
                            {m.kind === 'voice' && m.url && <VoiceNote src={m.url} dur={m.durationSec} mine={mine} />}
                            {m.body && <div className="msg-text">{m.body}</div>}
                            <span className="msg-meta">{clock(m.at)}{mine && (m.pending ? <Loader2 size={12} className="spin" /> : m.read ? <CheckCheck size={14} className="seen" aria-label="Seen" /> : <Check size={14} aria-label="Sent" />)}</span>
                          </div>
                          {mine && m.id === lastMineRead && m.read && <div className="msg-seen">Seen</div>}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              <footer className="composer">
                {rec ? (
                  <div className="rec-bar">
                    <button className="icon-btn" onClick={() => stopRec(true)} data-tip="Discard" aria-label="Discard recording"><Trash2 size={18} /></button>
                    <span className="rec-dot" /><b className="rec-time">{mmss(rec.secs)}</b><span className="hint">Recording voice note…</span>
                    <button className="btn btn-primary" onClick={() => stopRec(false)}><Square size={13} /> Stop &amp; Send</button>
                  </div>
                ) : (
                  <>
                    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = ''; }} />
                    <button className="icon-btn" onClick={() => fileRef.current?.click()} disabled={sending || thread.agent.status !== 'active'} data-tip="Send a photo" aria-label="Attach photo"><ImagePlus size={19} /></button>
                    <textarea ref={inputRef} className="input composer-input" rows={1} placeholder={thread.agent.status === 'active' ? `Message ${thread.agent.name.split(' ')[0]}…` : 'Messaging is paused for this agent'} value={text} disabled={thread.agent.status !== 'active'}
                      onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } }}
                      onPaste={(e) => { const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); pickImage(f); } }} />
                    {text.trim() ? <button className="btn btn-primary send-btn" onClick={sendText} disabled={sending} aria-label="Send message"><Send size={16} /></button>
                      : <button className="btn btn-primary send-btn" onClick={startRec} disabled={sending || thread.agent.status !== 'active'} data-tip="Record a voice note" aria-label="Record voice note"><Mic size={17} /></button>}
                  </>
                )}
              </footer>
            </>
          ))}
        </section>
      </div>
      {picker && <PeoplePicker onPick={start} onClose={() => setPicker(false)} />}
      {lightbox && (
        <div className="overlay lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="Photo">
          <button className="icon-btn lb-close" onClick={() => setLightbox(null)} aria-label="Close photo"><X size={20} /></button>
          <img src={lightbox} alt="Photo" onClick={(e) => e.stopPropagation()} />
          <a className="btn btn-sm lb-open" href={lightbox} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Open Original</a>
        </div>
      )}
    </div>
  );
}

export default function ChatsPage() {
  return <Suspense fallback={<div className="card card-pad"><div className="skeleton" style={{ width: '30%' }} /></div>}><ChatsInner /></Suspense>;
}
