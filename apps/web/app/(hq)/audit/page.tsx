'use client';
import { useCallback, useEffect, useState } from 'react';
import { RotateCcw, ShieldAlert, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { PageHead } from '@/components/shell';
import { DataTable } from '@/components/ui';
import { useApp, useLive } from '@/components/providers';
import { api } from '@/lib/api';

type Col = { key: string; label: string };
type Row = Record<string, any> & { _id?: string; _auditId?: string };
const UNDOABLE = new Set(['user.approve', 'user.suspend', 'user.activate', 'agent.suspend', 'agent.activate', 'agent.assign', 'agent.unassign', 'incident.acted', 'incident.resolved', 'incident.fake', 'alarm.resolve']);
const PERIODS: [string, string][] = [['all', 'All Time'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['last_7_days', 'Last 7 Days'], ['last_30_days', 'Last 30 Days'], ['this_month', 'This Month'], ['last_90_days', 'Last 90 Days']];
const raw = (r: Row) => String(r._action || r.action || '');
const AREA: Record<string, string> = { auth: 'Sign-in', user: 'User', agent: 'Agent', incident: 'Report', alarm: 'Alarm', admin: 'Admin', group: 'Group', category: 'Category', alert: 'Alert', settings: 'Settings', import: 'Import', media: 'Media', ai: 'AI' };
const tone = (a: string) => a.endsWith('.undo') ? 'violet' : a.includes('failed') || a.includes('fake') || a.includes('suspend') || a.includes('delete') ? 'rose' : a.startsWith('auth') ? 'teal' : a.includes('resolve') || a.includes('approve') || a.includes('activate') ? 'green' : 'blue';

export default function AuditPage() {
  const { can, me, toast } = useApp();
  const [actions, setActions] = useState<{ action: string; label?: string; count: number }[]>([]);
  const [f, setF] = useState({ action: '', actor: '', period: 'last_30_days' });
  const [data, setData] = useState<{ columns: Col[]; rows: Row[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    const qs = new URLSearchParams({ take: '10000', period: f.period, ...(f.action ? { action: f.action } : {}), ...(f.actor ? { actor: f.actor } : {}) });
    setLoading(true);
    api<{ columns: Col[]; rows: Row[]; total: number }>(`/records/audit.log?${qs}`).then(setData).catch((e) => toast(e.message, 'error')).finally(() => setLoading(false));
  }, [f, toast]);
  useEffect(() => { if (can('audit.view')) { load(); api<{ action: string; label?: string; count: number }[]>('/audit/actions').then(setActions).catch(() => undefined); } }, [load, can]);
  useLive(['audit', 'users', 'agents', 'reports', 'alarms'], load);

  if (me && !can('audit.view')) return <div className="card card-pad empty"><ShieldAlert size={28} /><b>Audit log is restricted</b><div className="hint">Ask a superadmin for the audit.view permission.</div></div>;

  const undo = async (ids: string[]) => {
    if (!confirm(`Undo ${ids.length} change(s)? Only works within 24h and if the record hasn't changed since.`)) return;
    try { const r = await api<{ undone: number; errors: string[] }>('/audit/undo', { method: 'POST', json: { ids } });
      toast(r.undone ? `Undone ${r.undone} change(s)` : r.errors?.[0] || 'Nothing to undo', r.undone ? 'success' : 'error'); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };
  const actors = [...new Set((data?.rows || []).map((r) => r.actor).filter(Boolean))];
  // Audit rows share the entity id; key them by audit id so marking/undo is per change.
  const rows: Row[] = (data?.rows || []).map((r) => ({ ...r, _entity: r._id, _id: r._auditId }));
  const columns = (data?.columns || []).map((c) => c);

  return (
    <>
      <PageHead title="Audit Log" />
      <div className="filters card card-pad" style={{ marginBottom: 14 }}>
        <label><span>Action</span><select className="input" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>
          <option value="">All Actions</option>{actions.map((a) => <option key={a.action} value={a.action}>{a.label || a.action} ({a.count})</option>)}</select></label>
        <label><span>Admin</span><select className="input" value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })}>
          <option value="">Everyone</option>{[...new Set([f.actor, ...actors].filter(Boolean))].map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
        <label><span>Period</span><select className="input" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}>
          {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <button className="btn btn-ghost" onClick={() => setF({ action: '', actor: '', period: 'last_30_days' })} data-tip="Reset filters"><RotateCcw size={14} /> Reset</button>
      </div>
      <DataTable columns={columns} rows={rows} total={data?.total} loading={loading} exportName="audit-log"
        actions={(r) => (<span className="row-acts">
          <span className={`chip ${tone(raw(r))}`}>{AREA[raw(r).split('.')[0]] || raw(r).split('.')[0]}</span>
          {r._entity && r._entityType !== 'admin' && !raw(r).startsWith('auth') && <Link className="btn btn-sm btn-ghost" href={`/e/${r._entity}`} data-tip="Open the record">Open</Link>}
          {UNDOABLE.has(raw(r)) && can('ops') && <button className="btn btn-sm" onClick={() => undo([r._auditId!])} data-tip="Revert this change"><Undo2 size={13} /> Undo</button>}
        </span>)}
        bulk={can('ops') ? (ids, clear) => {
          const audit = rows.filter((r) => ids.includes(String(r._id)) && UNDOABLE.has(raw(r))).map((r) => r._auditId!);
          return <button className="btn btn-sm" disabled={!audit.length} onClick={async () => { await undo(audit); clear(); }}><Undo2 size={13} /> Undo {audit.length || ''}</button>;
        } : undefined} />
    </>
  );
}
