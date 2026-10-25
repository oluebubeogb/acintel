'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, ChevronLeft, ChevronRight, Download, Filter, Inbox, Search, Upload, X } from 'lucide-react';
import { api, downloadCsv } from '@/lib/api';
import { useApp } from './providers';

export type Col = { key: string; label: string };
export type Row = Record<string, any> & { _id?: string; _links?: Record<string, string>; _ts?: string };

export function Modal({ title, subtitle, onClose, children, footer, size }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; size?: 'sm' | 'xl' }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size === 'sm' ? 'modal-sm' : size === 'xl' ? 'modal-xl' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-btn" onClick={onClose} data-tip="Close (Esc)" data-tip-pos="left" aria-label="Close"><X size={18} /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = { active: 'green', resolved: 'green', new: 'blue', pending: 'amber', dispatched: 'violet', acted: 'teal', suspended: 'rose', panic: 'rose', duress: 'amber', fake: '', inactive: '', online: 'green', offline: '', critical: 'rose', high: 'amber', medium: 'blue', low: 'green', superadmin: 'violet', controller: 'blue', group_admin: 'teal' };
const CHIP_KEYS = new Set(['status', 'type', 'online', 'riskLevel', 'role']);
const DATE_KEYS = new Set(['regDate', 'date']);
const dayOf = (ts: string | Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));

export function Cell({ col, row, linkKey }: { col: Col; row: Row; linkKey?: string }) {
  const { openDay } = useApp();
  const v = row[col.key];
  if (CHIP_KEYS.has(col.key) && typeof v === 'string' && v) return <span className={`chip ${STATUS_TONE[v] || ''}`}>{v.replace(/_/g, ' ')}</span>;
  if (col.key === linkKey && row._id) return <Link href={`/e/${row._id}`} data-tip="Open record">{String(v ?? '')}</Link>;
  const href = row._links?.[col.key];
  // Reporter column: name + a small Agent / User / Call Centre / ECC tag underneath.
  if (col.key === 'reporter' && row._reporterRole) return (
    <span className="who">{href && v ? <Link className="cell-link" href={href} data-tip="Open">{String(v)}</Link> : <span>{String(v || '—')}</span>}
      <span className={`role-tag rt-${row._source || 'user'}`}>{row._reporterRole}</span></span>
  );
  // Admin Actions: show the admin's name, email as tooltip + secondary line.
  if (col.key === 'actor' && row._actorEmail && row._actorEmail !== v) return <span className="who" data-tip={row._actorEmail}><span>{String(v)}</span><small className="who-sub">{row._actorEmail}</small></span>;
  // Report headline (AI or local) — one line, full report text on hover.
  if (col.key === 'title' && v) return <span className="cell-title" title={row.details || String(v)}>{String(v)}</span>;
  if (href && v) return <Link className="cell-link" href={href} data-tip="Open">{String(v)}</Link>;
  if (DATE_KEYS.has(col.key) && row._ts && v) return <button className="date-link" onClick={(e) => { e.stopPropagation(); openDay(dayOf(row._ts!), row._id); }} data-tip="See everything that happened this day">{String(v)}</button>;
  return <>{v === '' || v == null ? <span style={{ color: 'var(--faint)' }}>—</span> : String(v)}</>;
}

/** CSV import (users, agents, groups, categories): validate first (dry run), then commit. */
export function ImportModal({ kind, onClose, onDone }: { kind: string; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [csv, setCsv] = useState(''); const [file, setFile] = useState('');
  const [rep, setRep] = useState<any>(null); const [busy, setBusy] = useState(false); const [over, setOver] = useState(false);
  const read = (f?: File) => { if (!f) return; if (f.size > 5e6) return toast('CSV too large (5 MB max)', 'error'); f.text().then((t) => { setCsv(t); setFile(f.name); setRep(null); }); };
  const run = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const r = await api<any>(`/import/${kind}`, { method: 'POST', json: { csv, dryRun } });
      setRep(r);
      if (!dryRun) { toast(`Imported ${r.created} ${kind}${r.invalid ? ` · ${r.invalid} rejected` : ''}`); onDone(); if (!r.invalid) onClose(); }
    } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Import ${kind} from CSV`} subtitle="Validate first — nothing is saved until you commit." onClose={onClose}
      footer={<>
        <a className="btn" href={`/api/import/${kind}/template`} style={{ marginRight: 'auto' }}><Download size={15} /> Template</a>
        <button className="btn" disabled={!csv || busy} onClick={() => run(true)}>{busy && !rep ? 'Checking…' : 'Validate'}</button>
        <button className="btn btn-primary" disabled={!rep?.dryRun || !rep.valid || busy} onClick={() => run(false)} data-tip={rep?.dryRun ? `Create ${rep.valid} valid rows` : 'Validate first'}><Upload size={15} /> Import {rep?.dryRun ? rep.valid : ''} rows</button>
      </>}>
      <label className={`dropzone ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); read(e.dataTransfer.files[0]); }} style={{ display: 'block' }}>
        <input type="file" accept=".csv,text/csv" hidden onChange={(e) => read(e.target.files?.[0])} />
        <Upload size={20} /><div style={{ marginTop: 6, fontWeight: 600 }}>{file || 'Drop a CSV here or click to choose'}</div>
        <div className="hint">Header row required · download the template for the exact columns</div>
      </label>
      {rep && (
        <>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <span className="chip">{rep.total} rows</span><span className="chip green">{rep.valid} valid</span>{rep.invalid > 0 && <span className="chip rose">{rep.invalid} rejected</span>}
            {!rep.dryRun && <span className="chip blue">{rep.created} created</span>}{rep.newGroups?.length > 0 && <span className="chip amber">New groups: {rep.newGroups.join(', ')}</span>}
          </div>
          <div className="import-report"><table className="dt"><thead><tr><th>Row</th><th>Name</th><th>Result</th></tr></thead>
            <tbody>{rep.rows.map((r: any) => <tr key={r.row}><td>{r.row}</td><td>{r.name || '—'}</td><td>{r.ok ? <span className="chip green">{r.action}</span> : <span className="chip rose">{r.error}</span>}</td></tr>)}</tbody></table></div>
        </>
      )}
    </Modal>
  );
}

export function PageSizeControl({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { prefs } = useApp();
  const opts: number[] = prefs?.effective.pageSizeOptions || [25, 100, 500, 1000];
  const isCustom = !opts.includes(value);
  const [custom, setCustom] = useState(isCustom ? String(value) : '');
  return (
    <div className="page-size" data-tip="Rows per page — default 500 (change sitewide in Settings)">
      Show
      <select className="select" value={isCustom ? 'custom' : value} onChange={(e) => e.target.value === 'custom' ? setCustom(String(value)) : onChange(Number(e.target.value))}>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}<option value="custom">Custom…</option>
      </select>
      {(isCustom || custom) && <input className="input" type="number" min={1} max={10000} placeholder="Rows" value={custom}
        onChange={(e) => setCustom(e.target.value)} onBlur={() => { const n = Number(custom); if (n >= 1) onChange(Math.min(n, 10000)); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />}
      entries
    </div>
  );
}

export function DataTable({ columns, rows, loading, exportName, linkKey, actions, importKind, onImported, total, toolbar, bulk, scroll }: {
  columns: Col[]; rows: Row[]; loading?: boolean; exportName: string; linkKey?: string; total?: number;
  actions?: (row: Row) => React.ReactNode; importKind?: string; onImported?: () => void; toolbar?: React.ReactNode;
  /** Bulk actions for marked rows. Return buttons; call clear() after a successful action. */
  bulk?: (ids: string[], clear: () => void, rows: Row[]) => React.ReactNode;
  /** Inner scroll with a max height — only for pages/overlays that stack several tables. Single-table pages paginate instead. */
  scroll?: boolean;
}) {
  const { pageSize } = useApp();
  const [importing, setImporting] = useState(false);
  const [size, setSize] = useState(pageSize);
  useEffect(() => setSize(pageSize), [pageSize]);
  const [q, setQ] = useState('');
  const [filterCol, setFilterCol] = useState('');
  const [filterVal, setFilterVal] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const rowId = (r: Row, i: number) => r._id || `${i}`;

  const filtered = useMemo(() => {
    let out = rows;
    if (q.trim()) { const t = q.toLowerCase(); out = out.filter((r) => columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(t))); }
    if (filterCol && filterVal) out = out.filter((r) => String(r[filterCol] ?? '').toLowerCase().includes(filterVal.toLowerCase()));
    if (sort) out = [...out].sort((a, b) => {
      const av = a._ts && (sort.key === 'regDate' || sort.key === 'date') ? new Date(a._ts).getTime() : a[sort.key];
      const bv = b._ts && (sort.key === 'regDate' || sort.key === 'date') ? new Date(b._ts).getTime() : b[sort.key];
      return (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''))) * sort.dir;
    });
    return out;
  }, [rows, q, filterCol, filterVal, sort, columns]);
  useEffect(() => setPage(0), [q, filterCol, filterVal, size]);
  useEffect(() => { const ids = new Set(rows.map((r, i) => rowId(r, i))); setMarked((m) => { const n = new Set([...m].filter((x) => ids.has(x))); return n.size === m.size ? m : n; }); }, [rows]);
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const view = filtered.slice(page * size, page * size + size);
  const toggleMark = (id: string) => setMarked((m) => { const n = new Set(m); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const exportRows = marked.size ? filtered.filter((r, i) => marked.has(rowId(r, i))) : filtered;

  return (
    <div className="card dt-card">
      <div className="table-tools">
        <div className="search-mini"><Search size={15} /><input className="input" placeholder="Search this table…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} data-tip="Filter by column" data-tip-pos="bottom">
          <Filter size={15} color="var(--muted)" />
          <select className="select" style={{ height: 34, width: 'auto' }} value={filterCol} onChange={(e) => setFilterCol(e.target.value)}>
            <option value="">Any Column</option>{columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          {filterCol && <input className="input" style={{ height: 34, width: 140 }} placeholder="contains…" value={filterVal} onChange={(e) => setFilterVal(e.target.value)} />}
        </div>
        <div style={{ flex: 1 }} />
        {toolbar}
        {marked.size > 0 && <span className="chip amber">{marked.size} marked</span>}
        {importKind && <button className="btn btn-sm" data-tip={`Import ${importKind} from CSV (validate first)`} onClick={() => setImporting(true)}><Upload size={14} /> Import</button>}
        <button className="btn btn-sm" data-tip={marked.size ? 'Export marked rows' : 'Export filtered rows'} onClick={() => downloadCsv(exportName, columns, exportRows)}><Download size={14} /> CSV</button>
        <PageSizeControl value={size} onChange={setSize} />
      </div>
      {bulk && marked.size > 0 && (
        <div className="bulkbar"><b style={{ fontSize: 13 }}>{marked.size} selected</b>
          {(() => { const sel = filtered.filter((r, i) => marked.has(rowId(r, i)) && r._id); return bulk(sel.map((r) => r._id!), () => setMarked(new Set()), sel); })()}
          <button className="btn btn-sm" onClick={() => setMarked(new Set())}>Clear</button></div>
      )}
      <div className={`table-wrap ${scroll ? 'scroll' : ''}`}>
        <table className="dt">
          <thead><tr>
            <th className="chk" data-tip="Mark rows to export or act on" data-tip-pos="right"><label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" aria-label="Mark all on this page" checked={view.length > 0 && view.every((r, i) => marked.has(rowId(r, page * size + i)))}
              onChange={(e) => setMarked((m) => { const n = new Set(m); view.forEach((r, i) => (e.target.checked ? n.add(rowId(r, page * size + i)) : n.delete(rowId(r, page * size + i)))); return n; })} />#</label></th>
            {columns.map((c) => (
              <th key={c.key} onClick={() => setSort((s) => (s?.key === c.key ? (s.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }))}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{c.label}{sort?.key === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : <ArrowDownUp size={11} opacity={0.4} />}</span>
              </th>
            ))}
            {actions && <th style={{ cursor: 'default' }}>Actions</th>}
          </tr></thead>
          <tbody>
            {loading && Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={columns.length + 2}><div className="skeleton" style={{ width: `${60 + ((i * 13) % 35)}%` }} /></td></tr>)}
            {!loading && view.map((r, i) => {
              const id = rowId(r, page * size + i);
              return (
                <tr key={`${id}:${page * size + i}`} className={marked.has(id) ? 'marked' : ''}>
                  <td className="chk"><label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', color: 'var(--faint)', fontSize: 12 }}><input type="checkbox" checked={marked.has(id)} onChange={() => toggleMark(id)} />{page * size + i + 1}</label></td>
                  {columns.map((c) => <td key={c.key} className={c.key === linkKey ? 'primary' : ''}><Cell col={c} row={r} linkKey={linkKey} /></td>)}
                  {actions && <td>{actions(r)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && !view.length && <div className="empty"><div className="e-ico"><Inbox size={22} /></div><b>No records</b><div className="hint">{rows.length ? 'Nothing matches your search or filter.' : 'Records will appear here once data arrives.'}</div></div>}
      </div>
      <div className="table-foot">
        <span>Showing {filtered.length ? page * size + 1 : 0}–{Math.min(filtered.length, (page + 1) * size)} of {filtered.length}{total && total > rows.length ? ` (loaded ${rows.length} of ${total})` : ''}</span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={14} /></button>
          Page {page + 1} / {pages}
          <button className="btn btn-sm" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}><ChevronRight size={14} /></button>
        </span>
      </div>
      {importing && importKind && <ImportModal kind={importKind} onClose={() => setImporting(false)} onDone={() => onImported?.()} />}
    </div>
  );
}
