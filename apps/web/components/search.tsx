'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CornerDownLeft, Search } from 'lucide-react';
import { api } from '@/lib/api';

type Result = { tag: string; origin?: string; label: string; sub: string; href: string };
const tagTone = (tag: string) => tag.startsWith('Page') || tag.startsWith('Nav') ? 'violet' : tag.startsWith('Users') ? 'blue' : tag.startsWith('Agents') ? 'green'
  : tag.includes('alarm') ? 'rose' : tag.includes('eport') ? 'amber' : 'teal';

function Highlight({ text, q }: { text: string; q: string }) {
  const tokens = q.trim().split(/\s+/).filter((t) => t.length > 0).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!tokens.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${tokens.join('|')})`, 'ig'));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}</>;
}

export function GlobalSearch() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !/input|textarea|select/i.test((e.target as HTMLElement).tagName))) { e.preventDefault(); input.current?.focus(); setOpen(true); }
    };
    const click = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', k); document.addEventListener('mousedown', click);
    return () => { window.removeEventListener('keydown', k); document.removeEventListener('mousedown', click); };
  }, []);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    const t = setTimeout(() => {
      api<{ results: Result[] }>(`/search?q=${encodeURIComponent(q)}`).then((r) => {
        // Group by entity type (keeping rank order of each group's best hit) so origins read clearly.
        const order: string[] = []; const by: Record<string, Result[]> = {};
        for (const x of r.results) { if (!by[x.tag]) { by[x.tag] = []; order.push(x.tag); } by[x.tag].push(x); }
        setResults(order.flatMap((t) => by[t])); setSel(0);
      }).catch(() => setResults([])).finally(() => setLoading(false));
    }, 140);
    return () => clearTimeout(t);
  }, [q]);

  const go = (r?: Result) => { if (!r) return; setOpen(false); setQ(''); input.current?.blur(); router.push(r.href); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') go(results[sel]);
    else if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
  };

  return (
    <div className="gsearch" ref={box}>
      <Search size={17} className="g-ico" />
      <input ref={input} className="g-input" placeholder="Search agents, users, reports, pages…  e.g. “agent mike”, “suspended ag”"
        value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey} aria-label="Global search" />
      <span className="kbd">Ctrl K</span>
      {open && q.trim() && (
        <div className="g-results" role="listbox">
          {loading && !results.length && <div style={{ padding: 16, display: 'grid', gap: 10 }}><div className="skeleton" style={{ width: '70%' }} /><div className="skeleton" style={{ width: '45%' }} /></div>}
          {!loading && !results.length && <div className="empty" style={{ padding: 26 }}>No matches for “{q}”</div>}
          {results.map((r, i) => (<div key={r.href + i}>
            {(i === 0 || results[i - 1].tag !== r.tag) && <div className="g-group">{r.tag}{r.tag.endsWith('s') ? '' : 's'}</div>}
            <div className={`g-item ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); go(r); }} role="option" aria-selected={i === sel}>
              <div className="g-l"><b><Highlight text={r.label} q={q} /></b><small><Highlight text={r.sub} q={q} /></small></div>
              <span className={`chip ${tagTone(r.tag + (r.origin || ''))}`} data-tip="Where this result lives">{r.origin || r.tag}</span>
            </div>
          </div>))}
          {results.length > 0 && <div className="g-foot"><span>↑↓ navigate</span><span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><CornerDownLeft size={11} /> open</span><span>esc close</span><span style={{ marginLeft: 'auto' }}>{results.length} results</span></div>}
        </div>
      )}
    </div>
  );
}
