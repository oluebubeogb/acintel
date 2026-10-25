'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Ban, KeyRound, Pencil, Plus, RotateCcw, Send, ShieldCheck, Trash2, UserCheck, UserRoundSearch, Users, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { findChild } from '@/lib/nav';
import { PageHead } from './shell';
import { DataTable, Row, Col } from './ui';
import { DispatchOverlay, incidentLine } from './overlays';
import { VigilanteOverlay } from './vigilante';
import { KpiIcon } from './kpi-icons';
import { useApp, useLive } from './providers';
import { AddAgentForm, AdminModal, AssignModal, CategoryModal, GroupModal, LGAS, SendAlertForm, TempPassword, useGroups } from './forms';
import { AgentMap, IncidentMap } from './maps';
import { Analytics } from './analytics';

const LINK_KEY: Record<string, string> = { users: 'name', agents: 'name', reports: 'category', alarms: 'sender', tips: 'title' };
const LINK_OVERRIDE: Record<string, string> = { 'users.devices': 'label' };
const IMPORT: Record<string, string> = { 'users.active': 'users', 'users.pending': 'users', 'users.generate': 'users', 'agents.active': 'agents', 'agents.unassigned': 'agents', 'agents.groups': 'groups', 'reports.categories': 'categories' };
const NO_TABLE = new Set(['agents.new', 'reports.analytics']);
const LIVE_KEYS: Record<string, string[]> = { users: ['users'], agents: ['agents', 'groups', 'admins'], reports: ['incidents', 'reports', 'categories'], alarms: ['alarms'], tips: ['alerts'] };
const PERIODS = [['all', 'All Time'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['this_week', 'This Week'], ['last_7_days', 'Last 7 Days'], ['this_month', 'This Month'], ['last_30_days', 'Last 30 Days'], ['last_90_days', 'Last 90 Days'], ['this_year', 'This Year'], ['custom', 'Custom Range…']];
type Data = { columns: Col[]; rows: Row[]; total: number };
type Filt = { lga: string; status: string; group: string; category: string; period: string; from: string; to: string; source: string };
const SOURCES = [['user', 'User'], ['agent', 'Agent'], ['call_centre', 'Call Centre'], ['ecc', 'ECC']] as const;
const SOURCE_PAGE: Record<string, string> = { 'reports.users': 'user', 'reports.agents': 'agent', 'reports.call-centre': 'call_centre', 'reports.ecc': 'ecc' };
const SOURCE_STYLE: Record<string, { icon: string; accent: string; href: string }> = { user: { icon: 'user', accent: '#2563eb', href: '/reports/users' }, agent: { icon: 'agent', accent: '#16a34a', href: '/reports/agents' }, call_centre: { icon: 'headset', accent: '#ea580c', href: '/reports/call-centre' }, ecc: { icon: 'radio', accent: '#7c3aed', href: '/reports/ecc' } };

/** Which server-side filters each list offers. */
function filtersFor(key: string): (keyof Filt)[] {
  if (key === 'users.generate') return ['status', 'lga', 'period'];
  if (key.startsWith('users.')) return key === 'users.devices' ? [] : ['lga', 'period'];
  if (['agents.active', 'agents.suspended', 'agents.unassigned', 'agents.map'].includes(key)) return key === 'agents.unassigned' ? ['lga', 'period'] : ['lga', 'group', 'period'];
  if (['reports.new', 'reports.dispatched', 'reports.acted', 'reports.resolved', 'reports.map'].includes(key)) return ['lga', 'category', 'source', 'period'];
  if (SOURCE_PAGE[key]) return ['status', 'lga', 'category', 'period'];
  if (key.startsWith('alarms.')) return key === 'alarms.new' ? ['lga', 'period'] : ['status', 'lga', 'period'];
  return [];
}

function FilterBar({ keys, f, setF, statusOpts }: { keys: (keyof Filt)[]; f: Filt; setF: (f: Filt) => void; statusOpts: string[] }) {
  const groups = useGroups();
  const [cats, setCats] = useState<string[]>([]);
  useEffect(() => { if (keys.includes('category')) api<{ name: string }[]>('/categories').then((c) => setCats(c.map((x) => x.name))).catch(() => undefined); }, [keys]);
  if (!keys.length) return null;
  const s = (k: keyof Filt) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const active = keys.some((k) => (k === 'period' ? f.period !== 'all' : k === 'from' || k === 'to' ? false : f[k] && f[k] !== 'All'));
  return (
    <div className="filters card">
      {keys.includes('status') && <label data-tip="Filter by status"><span>Status</span><select className="select" value={f.status} onChange={s('status')}>{['All', ...statusOpts].map((x) => <option key={x}>{x}</option>)}</select></label>}
      {keys.includes('lga') && <label data-tip="Filter by local government area"><span>LGA</span><select className="select" value={f.lga} onChange={s('lga')}>{['All', ...LGAS].map((x) => <option key={x}>{x}</option>)}</select></label>}
      {keys.includes('group') && <label data-tip="Filter by Homeland group"><span>Group</span><select className="select" value={f.group} onChange={s('group')}><option value="">All Groups</option><option value="none">Un-assigned</option>{groups.map((g) => <option key={g.publicId} value={g.publicId}>{g.name}</option>)}</select></label>}
      {keys.includes('category') && <label data-tip="Filter by report category"><span>Category</span><select className="select" value={f.category} onChange={s('category')}>{['All', ...cats].map((x) => <option key={x}>{x}</option>)}</select></label>}
      {keys.includes('source') && <label data-tip="Where the report came from"><span>Source</span><select className="select" value={f.source} onChange={s('source')}><option value="All">All Sources</option>{SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
      {keys.includes('period') && <label data-tip="Registration / report date (Africa/Lagos)"><span>Period</span><select className="select" value={f.period} onChange={s('period')}>{PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
      {keys.includes('period') && f.period === 'custom' && <><label><span>From</span><input type="date" className="input" value={f.from} onChange={s('from')} /></label><label><span>To</span><input type="date" className="input" value={f.to} onChange={s('to')} /></label></>}
      {active && <button className="btn btn-sm" onClick={() => setF({ lga: 'All', status: 'All', group: '', category: 'All', period: 'all', from: '', to: '', source: 'All' })} data-tip="Clear all filters"><RotateCcw size={13} /> Reset</button>}
    </div>
  );
}

export function ListView({ section, child }: { section: string; child: string }) {
  const meta = findChild(section, child)!;
  const key = `${section}.${child}`;
  const sp = useSearchParams();
  const { markRead, toast, refreshCounts, confirm, can } = useApp();
  const ops = can('ops');
  const [data, setData] = useState<Data | null>(null);
  const [f, setF] = useState<Filt>(() => ({ lga: sp.get('lga') || 'All', status: sp.get('status') || 'All', group: sp.get('group') || '', category: sp.get('category') || 'All', period: sp.get('period') || ((sp.get('from') || sp.get('to')) ? 'custom' : 'all'), from: sp.get('from') || '', to: sp.get('to') || '', source: sp.get('source') || 'All' }));
  const [dispatching, setDispatching] = useState<Row[] | null>(null);
  const [vig, setVig] = useState<string | null>(null);
  const [assign, setAssign] = useState<{ ids: string[]; clear?: () => void } | null>(null);
  const [modal, setModal] = useState<{ kind: 'group' | 'category' | 'admin'; row?: Row } | null>(null);
  const [temp, setTemp] = useState<{ email: string; pw: string } | null>(null);
  const fkeys = useMemo(() => filtersFor(key), [key]);

  const query = useMemo(() => {
    const q = new URLSearchParams({ take: '10000' });
    if (fkeys.includes('lga') && f.lga !== 'All') q.set('lga', f.lga);
    if (fkeys.includes('status') && f.status !== 'All') q.set('status', f.status);
    if (fkeys.includes('group') && f.group) q.set('group', f.group);
    if (fkeys.includes('category') && f.category !== 'All') q.set('category', f.category);
    if (fkeys.includes('source') && f.source !== 'All') q.set('source', f.source);
    if (fkeys.includes('period')) { if (f.period === 'custom') { if (f.from) q.set('from', f.from); if (f.to) q.set('to', f.to); } else if (f.period !== 'all') q.set('period', f.period); }
    return q.toString();
  }, [f, fkeys]);
  const kind = key === 'tips.send' ? 'tips.alerts' : key;
  const load = useCallback(() => { if (NO_TABLE.has(key)) return; api<Data>(`/records/${kind}?${query}`).then(setData).catch(() => setData({ columns: [], rows: [], total: 0 })); }, [kind, key, query]);
  useEffect(() => { setData(null); load(); }, [load]);
  useEffect(() => { markRead(key); }, [key, markRead]);
  useLive(LIVE_KEYS[section] || [], load);
  const done = () => { load(); refreshCounts(); };

  /** Run a write; show a toast with Undo when the API returns audit ids. */
  const run = async (path: string, json: unknown, msg: (r: any) => string, clear?: () => void) => {
    try {
      const r = await api<any>(path, { method: 'POST', json });
      toast(msg(r), r.changed === 0 ? 'info' : 'success', r.undo?.length ? { undo: r.undo, onUndone: done } : undefined);
      clear?.(); done();
    } catch (e: any) { toast(e.message, 'error'); }
  };
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const setStatus = async (ent: 'users' | 'agents', ids: string[], status: 'active' | 'suspended', label: string, clear?: () => void) => {
    const verb = status === 'suspended' ? 'Suspend' : label;
    const ok = await confirm({ title: `${verb} ${plural(ids.length, ent === 'users' ? 'user' : 'agent')}?`, body: status === 'suspended' ? 'They lose app access until re-activated. You can undo for 24 hours.' : 'They regain full app access. You can undo for 24 hours.', confirm: verb, danger: status === 'suspended' });
    if (ok) run(`/${ent}/status`, { ids, status }, (r) => `${plural(r.changed, ent === 'users' ? 'user' : 'agent')} ${status === 'suspended' ? 'suspended' : label === 'Approve' ? 'approved' : 'activated'}${r.skipped ? ` · ${r.skipped} unchanged` : ''}`, clear);
  };
  const incStatus = async (ids: string[], status: 'acted' | 'resolved' | 'fake', clear?: () => void, rows?: Row[]) => {
    const label = status === 'fake' ? 'Mark as fake' : status === 'resolved' ? 'Resolve' : 'Mark acted upon';
    const items = (rows || data?.rows.filter((r) => ids.includes(r._id!)) || []).map(incidentLine);
    const ok = await confirm({ title: `${label} — ${plural(ids.length, 'report')}?`, items, body: status === 'fake' ? 'Fake reports are closed and flagged against the reporter. A reason is required for the audit log.' : 'This moves the report forward in the pipeline and is recorded in the audit log.', confirm: label, danger: status === 'fake',
      input: { label: status === 'fake' ? 'Reason (required)' : 'Note (optional)', placeholder: status === 'fake' ? 'e.g. Caller confirmed prank' : 'e.g. Agents on site, area secured', required: status === 'fake' } });
    if (ok) run('/incidents/status', { ids, status, note: ok.value || undefined }, (r) => `${plural(r.changed, 'report')} ${status === 'fake' ? 'marked fake' : status === 'resolved' ? 'resolved' : 'marked acted upon'}${r.skipped ? ` · ${r.skipped} skipped` : ''}`, clear);
  };
  const resolveAlarms = async (ids: string[], clear?: () => void) => {
    const ok = await confirm({ title: `Resolve ${plural(ids.length, 'alarm')}?`, body: 'Marks the alarm handled and clears it from the New alarms badge.', confirm: 'Resolve' });
    if (ok) run('/alarms/resolve', { ids }, (r) => `${plural(r.changed, 'alarm')} resolved`, clear);
  };
  const del = async (path: string, what: string, body?: string) => {
    const ok = await confirm({ title: `Delete ${what}?`, body: body || 'This cannot be undone.', confirm: 'Delete', danger: true });
    if (!ok) return;
    try { const r = await api<any>(path, { method: 'DELETE' }); toast(`${what[0].toUpperCase()}${what.slice(1)} deleted${r.unassigned ? ` · ${r.unassigned} agents un-assigned` : ''}`); done(); }
    catch (e: any) { toast(e.message, 'error'); }
  };
  const resetPw = async (r: Row) => {
    const ok = await confirm({ title: `Reset password for ${r.name}?`, body: 'A new temporary password is generated and all their sessions are signed out.', confirm: 'Reset password', danger: true });
    if (!ok) return;
    try { const x = await api<{ tempPassword: string }>(`/admins/${r._id}/reset-password`, { method: 'POST' }); setTemp({ email: r.email, pw: x.tempPassword }); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const B = ({ tone, icon, label, tip, onClick }: { tone?: string; icon?: React.ReactNode; label?: string; tip?: string; onClick: () => void }) =>
    <button className={`btn btn-sm ${tone || ''}`} disabled={!ops} onClick={(e) => { e.stopPropagation(); onClick(); }} data-tip={ops ? tip : 'Read-only role'}>{icon}{label}</button>;

  let actions: ((r: Row) => React.ReactNode) | undefined;
  let bulk: ((ids: string[], clear: () => void, rows: Row[]) => React.ReactNode) | undefined;
  let toolbar: React.ReactNode = null;
  switch (key) {
    case 'users.active':
      actions = (r) => <B tone="btn-danger" icon={<Ban size={13} />} label="Suspend" tip="Suspend this user" onClick={() => setStatus('users', [r._id!], 'suspended', 'Suspend')} />;
      bulk = (ids, c) => <B tone="btn-danger" icon={<Ban size={13} />} label="Suspend" onClick={() => setStatus('users', ids, 'suspended', 'Suspend', c)} />; break;
    case 'users.suspended':
      actions = (r) => <B tone="btn-success" icon={<UserCheck size={13} />} label="Activate" tip="Restore access" onClick={() => setStatus('users', [r._id!], 'active', 'Activate')} />;
      bulk = (ids, c) => <B tone="btn-success" icon={<UserCheck size={13} />} label="Activate" onClick={() => setStatus('users', ids, 'active', 'Activate', c)} />; break;
    case 'users.pending':
      actions = (r) => <span className="row-acts"><B tone="btn-success" icon={<CheckCircle2 size={13} />} label="Approve" tip="Approve signup" onClick={() => setStatus('users', [r._id!], 'active', 'Approve')} /><B tone="btn-danger" icon={<Ban size={13} />} tip="Reject / suspend" onClick={() => setStatus('users', [r._id!], 'suspended', 'Suspend')} /></span>;
      bulk = (ids, c) => <><B tone="btn-success" icon={<CheckCircle2 size={13} />} label="Approve" onClick={() => setStatus('users', ids, 'active', 'Approve', c)} /><B tone="btn-danger" icon={<Ban size={13} />} label="Suspend" onClick={() => setStatus('users', ids, 'suspended', 'Suspend', c)} /></>; break;
    case 'agents.active': case 'agents.unassigned': case 'agents.map':
      actions = (r) => <span className="row-acts"><B icon={<Users size={13} />} tip="Assign to a group" onClick={() => setAssign({ ids: [r._id!] })} />{r.status !== 'suspended' ? <B tone="btn-danger" icon={<Ban size={13} />} tip="Suspend agent" onClick={() => setStatus('agents', [r._id!], 'suspended', 'Suspend')} /> : <B tone="btn-success" icon={<UserCheck size={13} />} tip="Activate agent" onClick={() => setStatus('agents', [r._id!], 'active', 'Activate')} />}</span>;
      bulk = (ids, c) => <><B icon={<Users size={13} />} label="Assign / remove group" onClick={() => setAssign({ ids, clear: c })} /><B tone="btn-danger" icon={<Ban size={13} />} label="Suspend" onClick={() => setStatus('agents', ids, 'suspended', 'Suspend', c)} /></>; break;
    case 'agents.suspended':
      actions = (r) => <B tone="btn-success" icon={<UserCheck size={13} />} label="Activate" tip="Re-activate agent" onClick={() => setStatus('agents', [r._id!], 'active', 'Activate')} />;
      bulk = (ids, c) => <><B tone="btn-success" icon={<UserCheck size={13} />} label="Activate" onClick={() => setStatus('agents', ids, 'active', 'Activate', c)} /><B icon={<Users size={13} />} label="Assign / remove group" onClick={() => setAssign({ ids, clear: c })} /></>; break;
    case 'agents.groups':
      toolbar = <B tone="btn-primary" icon={<Plus size={14} />} label="New Group" onClick={() => setModal({ kind: 'group' })} />;
      actions = (r) => <span className="row-acts"><B icon={<Pencil size={13} />} tip="Edit group" onClick={() => setModal({ kind: 'group', row: r })} /><B tone="btn-danger" icon={<Trash2 size={13} />} tip="Delete group" onClick={() => del(`/groups/${r._id}`, `group “${r.name}”`, `Its ${r.agents} agent(s) become un-assigned. This cannot be undone.`)} /></span>; break;
    case 'agents.admins': {
      const am = can('admins.manage');
      toolbar = <button className="btn btn-sm btn-primary" disabled={!am} onClick={() => setModal({ kind: 'admin' })} data-tip={am ? 'Create an admin login' : 'Superadmin only'}><Plus size={14} /> New admin</button>;
      actions = (r) => <span className="row-acts">
        <button className="btn btn-sm" disabled={!am} onClick={() => setModal({ kind: 'admin', row: r })} data-tip="Edit role / status"><Pencil size={13} /></button>
        <button className="btn btn-sm" disabled={!am} onClick={() => resetPw(r)} data-tip="Reset password"><KeyRound size={13} /></button>
        <button className="btn btn-sm btn-danger" disabled={!am} onClick={() => del(`/admins/${r._id}`, `admin ${r.email}`)} data-tip="Delete admin"><Trash2 size={13} /></button></span>; break;
    }
    case 'reports.categories':
      toolbar = <B tone="btn-primary" icon={<Plus size={14} />} label="New Category" onClick={() => setModal({ kind: 'category' })} />;
      actions = (r) => <span className="row-acts"><B icon={<Pencil size={13} />} tip="Edit risk, agent count, status" onClick={() => setModal({ kind: 'category', row: r })} /><B tone="btn-danger" icon={<Trash2 size={13} />} tip={r.reports ? 'In use — set inactive instead' : 'Delete category'} onClick={() => del(`/categories/${r._id}`, `category “${r.name}”`)} /></span>; break;
    case 'reports.new': case 'reports.dispatched': case 'reports.acted': case 'reports.map':
    case 'reports.users': case 'reports.agents': case 'reports.call-centre': case 'reports.ecc': {
      const open = (r: Row) => !['resolved', 'fake'].includes(r.status);
      // Actions column starts with the Agent (Send to Vigilante) icon, then Dispatch / Acted / Resolve / Fake.
      actions = (r) => open(r) ? <span className="row-acts">
        <button className="btn btn-sm btn-agent" disabled={!ops} onClick={(e) => { e.stopPropagation(); setVig(r._id!); }} data-tip={ops ? 'Send to Vigilante — verify, confirm or resolve' : 'Read-only role'} aria-label="Send to Vigilante"><UserRoundSearch size={14} /></button>
        {['new', 'dispatched'].includes(r.status) && <B tone="btn-blue" icon={<Send size={13} />} label={key === 'reports.new' ? 'Dispatch' : undefined} tip="Choose agencies and dispatch" onClick={() => setDispatching([r])} />}
        {r.status === 'dispatched' && <B tone="btn-teal" icon={<ShieldCheck size={13} />} tip="Mark acted upon" onClick={() => incStatus([r._id!], 'acted', undefined, [r])} />}
        <B tone="btn-success" icon={<CheckCircle2 size={13} />} label={key === 'reports.new' ? undefined : 'Resolve'} tip="Resolve report" onClick={() => incStatus([r._id!], 'resolved', undefined, [r])} />
        <B tone="btn-danger" icon={<XCircle size={13} />} tip="Mark as fake" onClick={() => incStatus([r._id!], 'fake', undefined, [r])} />
      </span> : <span className={`chip ${r.status === 'resolved' ? 'green' : ''}`}>{r.status}</span>;
      bulk = (ids, c, rows) => {
        const disp = rows.filter((r) => ['new', 'dispatched'].includes(r.status));
        const acted = rows.filter((r) => r.status === 'dispatched');
        return <>
          <B tone="btn-blue" icon={<Send size={13} />} label={`Dispatch${disp.length !== rows.length ? ` ${disp.length}` : ''}`} tip={disp.length ? 'Dispatch the selected reports to agencies' : 'None of the selected reports can be dispatched'} onClick={() => disp.length && setDispatching(disp)} />
          {key !== 'reports.new' && acted.length > 0 && <B tone="btn-teal" icon={<ShieldCheck size={13} />} label="Acted Upon" onClick={() => incStatus(acted.map((r) => r._id!), 'acted', c, acted)} />}
          {key === 'reports.new' && <B tone="btn-teal" icon={<ShieldCheck size={13} />} label="Acted Upon" onClick={() => incStatus(ids, 'acted', c, rows)} />}
          <B tone="btn-success" icon={<CheckCircle2 size={13} />} label="Resolve" onClick={() => incStatus(ids, 'resolved', c, rows)} />
          <B tone="btn-danger" icon={<XCircle size={13} />} label="Fake" onClick={() => incStatus(ids, 'fake', c, rows)} />
        </>;
      };
      break;
    }
    case 'alarms.new': case 'alarms.duress': case 'alarms.panic':
      actions = (r) => r.status === 'new' ? <B tone="btn-success" icon={<CheckCircle2 size={13} />} label="Resolve" tip="Mark alarm handled" onClick={() => resolveAlarms([r._id!])} /> : <span className="chip green">handled</span>;
      bulk = (ids, c) => <B tone="btn-success" icon={<CheckCircle2 size={13} />} label="Resolve" onClick={() => resolveAlarms(ids, c)} />; break;
    case 'tips.alerts': case 'tips.send':
      actions = (r) => <B tone="btn-danger" icon={<Trash2 size={13} />} tip="Delete alert" onClick={() => del(`/alerts/${r._id}`, 'security alert')} />; break;
  }

  const statusOpts = key === 'alarms.duress' || key === 'alarms.panic' ? ['resolved'] : section === 'alarms' ? ['new', 'resolved'] : ['active', 'pending', 'suspended'];
  const subtitle = key === 'agents.new' ? 'Onboard a new local agent — or import many from CSV'
    : key === 'reports.analytics' ? 'Totals, charts and a CSV pack over any date range (Africa/Lagos)'
    : key === 'users.generate' ? 'Filter by status, LGA and period, then export the list as CSV'
    : data ? `${data.total.toLocaleString('en-NG')} record${data.total === 1 ? '' : 's'}${data.total > data.rows.length ? ` · showing latest ${data.rows.length.toLocaleString('en-NG')}` : ''} · ${ops ? 'click a row name to open it' : 'read-only role'}` : 'Loading…';

  return (
    <>
      <PageHead crumbs={[{ label: 'AcIntel', href: '/' }, { label: meta.parent.full }, { label: meta.child.label }]} title={meta.child.full} subtitle={subtitle} />
      {key === 'tips.send' && <SendAlertForm onSent={done} />}
      {key === 'agents.new' && <AddAgentForm />}
      {key === 'reports.analytics' && <Analytics />}
      {!NO_TABLE.has(key) && <FilterBar keys={fkeys} f={f} setF={setF} statusOpts={statusOpts} />}
      {key === 'agents.map' && <AgentMap filters={query} />}
      {key === 'reports.map' && <IncidentMap />}
      {SOURCE_PAGE[key] && <SourceCards active={SOURCE_PAGE[key]} />}
      {!NO_TABLE.has(key) && (
        <DataTable columns={data?.columns || []} rows={data?.rows || []} total={data?.total} loading={!data} exportName={`${key.replace('.', '-')}${query.replace(/take=\d+&?/, '') ? '-filtered' : ''}`}
          linkKey={LINK_OVERRIDE[key] || LINK_KEY[section]} actions={actions} bulk={ops ? bulk : undefined} toolbar={toolbar}
          importKind={ops ? IMPORT[key] : undefined} onImported={done} />
      )}
      {dispatching && <DispatchOverlay reports={dispatching} onClose={() => setDispatching(null)} onDone={done} />}
      {vig && <VigilanteOverlay incidentId={vig} onClose={() => setVig(null)} onDone={done} />}
      {assign && <AssignModal ids={assign.ids} onClose={() => setAssign(null)} onDone={() => { assign.clear?.(); done(); }} />}
      {modal?.kind === 'group' && <GroupModal raw={modal.row} id={modal.row?._id} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'category' && <CategoryModal raw={modal.row} id={modal.row?._id} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'admin' && <AdminModal raw={modal.row ? { ...modal.row, groupId: modal.row._groupId || '' } : undefined} id={modal.row?._id} onClose={() => setModal(null)} onDone={done} />}
      {temp && <TempPassword email={temp.email} pw={temp.pw} onClose={() => setTemp(null)} />}
    </>
  );
}

/** Report-source cards (User / Agent / Call Centre / ECC) — the active page's card is marked; others link across. */
function SourceCards({ active }: { active: string }) {
  const [d, setD] = useState<{ key: string; label: string; total: number; today: number; byStatus: Record<string, number> }[] | null>(null);
  const load = useCallback(() => { api<any>('/reports/sources').then(setD).catch(() => setD([])); }, []);
  useEffect(load, [load]);
  useLive(['incidents', 'reports'], load);
  return (
    <div className="src-cards">
      {(d || SOURCES.map(([k, l]) => ({ key: k, label: l, total: 0, today: 0, byStatus: {} as Record<string, number> }))).map((x) => {
        const st = SOURCE_STYLE[x.key]; const open = (x.byStatus.new || 0) + (x.byStatus.dispatched || 0) + (x.byStatus.acted || 0);
        return (
          <Link key={x.key} href={st.href} className={`card src-card ${active === x.key ? 'on' : ''}`} style={{ ['--acc' as any]: st.accent }} aria-current={active === x.key ? 'page' : undefined}>
            <KpiIcon name={st.icon} accent={st.accent} />
            <div className="src-body"><small>{x.label === 'User' ? 'From Users' : x.label === 'Agent' ? 'From Agents' : x.label}</small><b>{d ? x.total.toLocaleString('en-NG') : '—'}</b>
              <span className="src-sub"><i className="dot-new" />{(x.byStatus.new || 0).toLocaleString('en-NG')} new · {open.toLocaleString('en-NG')} open · {(x.byStatus.resolved || 0).toLocaleString('en-NG')} resolved · {x.today} today</span></div>
          </Link>
        );
      })}
    </div>
  );
}
