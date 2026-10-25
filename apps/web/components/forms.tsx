'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, KeyRound, Send, Upload, UserPlus, Users } from 'lucide-react';
import { api, titleCase } from '@/lib/api';
import { useApp } from './providers';
import { ImportModal, Modal } from './ui';

export const LGAS = ['Aba North', 'Aba South', 'Arochukwu', 'Bende', 'Ikwuano', 'Isiala Ngwa North', 'Isiala Ngwa South', 'Isuikwuato', 'Obi Ngwa', 'Ohafia', 'Osisioma', 'Ugwunagbo', 'Ukwa East', 'Ukwa West', 'Umuahia North', 'Umuahia South', 'Umu Nneochi'];
export type Group = { publicId: string; name: string; status: string; lga?: string | null };
let groupsP: Promise<Group[]> | null = null;
export const loadGroups = (fresh = false) => { if (fresh || !groupsP) groupsP = api<Group[]>('/groups').catch(() => { groupsP = null; return []; }); return groupsP; };
export function useGroups() {
  const [g, setG] = useState<Group[]>([]);
  useEffect(() => { loadGroups().then(setG); }, []);
  return g;
}

type F = Record<string, any>;
function useForm(init: F) {
  const [f, setF] = useState<F>(init);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  return { f, setF, set };
}
const Field = ({ label, children, full, hint }: { label: string; children: React.ReactNode; full?: boolean; hint?: string }) => (
  <div className="field" style={full ? { gridColumn: '1 / -1' } : undefined}><label className="label">{titleCase(label)}</label>{children}{hint && <div className="hint" style={{ marginTop: 4 }}>{hint}</div>}</div>
);
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 };

/* ---------------- Agents ---------------- */
function AgentFields({ f, set, groups, edit }: { f: F; set: (k: string) => any; groups: Group[]; edit?: boolean }) {
  return (
    <div style={grid}>
      <Field label="Government Tag" hint="Official ID tag, e.g. AHS/UMN/0142"><input className="input" required minLength={3} maxLength={40} value={f.tag} onChange={set('tag')} placeholder="AHS/UMN/0142" autoFocus={!edit} /></Field>
      <Field label="First Name"><input className="input" required minLength={2} value={f.firstName} onChange={set('firstName')} placeholder="e.g. Ngozi" /></Field>
      <Field label="Last Name"><input className="input" required minLength={2} value={f.lastName} onChange={set('lastName')} placeholder="e.g. Eze" /></Field>
      <Field label="Phone" hint="Nigerian mobile, e.g. 0803 123 4567"><input className="input" required value={f.phone} onChange={set('phone')} inputMode="tel" /></Field>
      <Field label="Email"><input className="input" type="email" required value={f.email} onChange={set('email')} placeholder="name@example.com" /></Field>
      <Field label="LGA"><select className="select" value={f.lga} onChange={set('lga')}>{LGAS.map((l) => <option key={l}>{l}</option>)}</select></Field>
      <Field label="Homeland Group"><select className="select" value={f.groupId} onChange={set('groupId')}><option value="">Un-assigned</option>{groups.filter((g) => g.status === 'active' || g.publicId === f.groupId).map((g) => <option key={g.publicId} value={g.publicId}>{g.name}</option>)}</select></Field>
      {edit && <Field label="Device" hint="Set by the agent's app on sign-in"><input className="input" value={f.device || '—'} readOnly disabled /></Field>}
    </div>
  );
}
const AGENT_KEYS = ['tag', 'firstName', 'lastName', 'phone', 'email', 'lga', 'groupId'];
const agentInit = (r?: F): F => ({ tag: r?.tag || '', firstName: r?.firstName || '', lastName: r?.lastName || '', phone: r?.phone || '', email: r?.email || '', lga: r?.lga || 'Umuahia North', groupId: r?.groupId || '', device: r?.device || '' });
const agentBody = (f: F) => Object.fromEntries(AGENT_KEYS.map((k) => [k, k === 'groupId' ? f[k] || null : f[k]]));

export function AddAgentForm() {
  const { toast, can } = useApp(); const router = useRouter();
  const groups = useGroups();
  const { f, setF, set } = useForm(agentInit());
  const [busy, setBusy] = useState(false); const [imp, setImp] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { const r = await api<{ id: string }>('/agents', { method: 'POST', json: agentBody(f) }); toast(`Agent ${f.firstName} ${f.lastName} added`); setF(agentInit()); router.push(`/e/${r.id}`); }
    catch (x: any) { toast(x.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <>
      <form className="card card-pad" onSubmit={submit} style={{ marginBottom: 16 }}>
        <AgentFields f={f} set={set} groups={groups} />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={() => setImp(true)} data-tip="Bulk onboard agents from a CSV file"><Upload size={15} /> Import CSV</button>
          <button className="btn btn-primary" disabled={busy || !can('ops')}><UserPlus size={15} /> {busy ? 'Saving…' : 'Add Local Agent'}</button>
        </div>
      </form>
      {imp && <ImportModal kind="agents" onClose={() => setImp(false)} onDone={() => router.push('/agents/active')} />}
    </>
  );
}
export function EditAgentModal({ raw, id, onClose, onDone }: { raw: F; id: string; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp(); const groups = useGroups();
  const { f, set } = useForm(agentInit(raw)); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const changed = Object.fromEntries(AGENT_KEYS.filter((k) => (raw[k] || '') !== f[k]).map((k) => [k, k === 'groupId' ? f[k] || null : f[k]]));
    try { if (Object.keys(changed).length) await api(`/agents/${id}`, { method: 'PATCH', json: changed }); toast('Agent updated'); onDone(); onClose(); }
    catch (x: any) { toast(x.message, 'error'); } finally { setBusy(false); }
  };
  return <Modal title="Edit Agent" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>Save Changes</button></>}><AgentFields edit f={f} set={set} groups={groups} /></Modal>;
}

/** Assign / remove marked agents to/from a group. */
export function AssignModal({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: (undo: string[]) => void }) {
  const { toast } = useApp(); const groups = useGroups();
  const [g, setG] = useState(''); const [busy, setBusy] = useState(false);
  const go = async (groupId: string | null) => {
    setBusy(true);
    try { const r = await api<{ changed: number; undo: string[] }>('/agents/assign', { method: 'POST', json: { ids, groupId } }); toast(groupId ? `${r.changed} agent(s) assigned` : `${r.changed} agent(s) removed from their group`, 'success', { undo: r.undo }); onDone(r.undo); onClose(); }
    catch (x: any) { toast(x.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal size="sm" title={`Assign ${ids.length} agent${ids.length > 1 ? 's' : ''}`} subtitle="Move to a Homeland group, or remove from their current group." onClose={onClose}
      footer={<><button className="btn" disabled={busy} onClick={() => go(null)} data-tip="Make un-assigned">Remove from group</button><button className="btn btn-primary" disabled={!g || busy} onClick={() => go(g)}><Users size={15} /> Assign</button></>}>
      <Field label="Group"><select className="select" value={g} onChange={(e) => setG(e.target.value)}><option value="">Choose a group…</option>{groups.filter((x) => x.status === 'active').map((x) => <option key={x.publicId} value={x.publicId}>{x.name}{x.lga ? ` · ${x.lga}` : ''}</option>)}</select></Field>
    </Modal>
  );
}

/* ---------------- Groups / Categories / Admins (modal CRUD) ---------------- */
export function GroupModal({ raw, id, onClose, onDone }: { raw?: F; id?: string; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const { f, set } = useForm({ name: raw?.name || '', description: raw?.description || '', lga: raw?.lga || '', status: raw?.status || 'active' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api(id ? `/groups/${id}` : '/groups', { method: id ? 'PATCH' : 'POST', json: f }); loadGroups(true); toast(id ? 'Group updated' : `Group ${f.name} created`); onDone(); onClose(); }
    catch (x: any) { toast(x.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title={id ? 'Edit Group' : 'New Homeland Group'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || f.name.trim().length < 2} onClick={save}>{id ? 'Save' : 'Create Group'}</button></>}>
      <div style={grid}>
        <Field label="Name"><input className="input" value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Base LGA"><select className="select" value={f.lga} onChange={set('lga')}><option value="">—</option>{LGAS.map((l) => <option key={l}>{l}</option>)}</select></Field>
        <Field label="Status"><select className="select" value={f.status} onChange={set('status')}><option value="active">active</option><option value="inactive">inactive</option></select></Field>
        <Field label="Description" full><textarea className="textarea" value={f.description} onChange={set('description')} /></Field>
      </div>
    </Modal>
  );
}
export function CategoryModal({ raw, id, onClose, onDone }: { raw?: F; id?: string; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const { f, set } = useForm({ name: raw?.name || '', description: raw?.description || '', riskLevel: raw?.riskLevel || 'medium', sendAgentCount: String(raw?.sendAgentCount ?? 3), status: raw?.status || 'active' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api(id ? `/categories/${id}` : '/categories', { method: id ? 'PATCH' : 'POST', json: { ...f, sendAgentCount: Number(f.sendAgentCount) } }); toast(id ? 'Category updated' : `Category ${f.name} created`); onDone(); onClose(); }
    catch (x: any) { toast(x.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title={id ? 'Edit Category' : 'New Report Category'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || f.name.trim().length < 2} onClick={save}>{id ? 'Save' : 'Create Category'}</button></>}>
      <div style={grid}>
        <Field label="Name"><input className="input" value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Risk level"><select className="select" value={f.riskLevel} onChange={set('riskLevel')}>{['low', 'medium', 'high', 'critical'].map((r) => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Agents to send" hint="Recommended responders per report"><input className="input" type="number" min={0} max={100} value={f.sendAgentCount} onChange={set('sendAgentCount')} /></Field>
        <Field label="Status"><select className="select" value={f.status} onChange={set('status')}><option value="active">active</option><option value="inactive">inactive</option></select></Field>
        <Field label="Description" full><textarea className="textarea" value={f.description} onChange={set('description')} /></Field>
      </div>
    </Modal>
  );
}
export function TempPassword({ email, pw, onClose }: { email: string; pw: string; onClose: () => void }) {
  const { toast } = useApp();
  return (
    <Modal size="sm" title="Temporary Password" subtitle={`Share it with ${email} securely — it is shown only once.`} onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <code style={{ flex: 1, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--line)', fontSize: 15 }}><KeyRound size={14} /> {pw}</code>
        <button className="btn" onClick={() => navigator.clipboard?.writeText(pw).then(() => toast('Copied'))}><Copy size={15} /></button>
      </div>
    </Modal>
  );
}
export function AdminModal({ raw, id, onClose, onDone }: { raw?: F; id?: string; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp(); const groups = useGroups();
  const [roles, setRoles] = useState<string[]>(['superadmin', 'controller', 'group_admin']);
  useEffect(() => { api<string[]>('/admins/roles').then(setRoles).catch(() => undefined); }, []);
  const { f, set } = useForm({ name: raw?.name || '', email: raw?.email || '', phone: raw?.phone || '', role: raw?.role || 'controller', status: raw?.status || 'active', groupId: raw?.groupId || '' });
  const [busy, setBusy] = useState(false); const [pw, setPw] = useState('');
  const save = async () => {
    setBusy(true);
    try {
      const body = id ? Object.fromEntries(Object.entries(f).filter(([k, v]) => (raw?.[k] || '') !== v)) : f;
      const r = await api<{ tempPassword?: string }>(id ? `/admins/${id}` : '/admins', { method: id ? 'PATCH' : 'POST', json: body });
      toast(id ? 'Admin updated' : `Admin ${f.email} created`); onDone();
      if (r.tempPassword) setPw(r.tempPassword); else onClose();
    } catch (x: any) { toast(x.message, 'error'); } finally { setBusy(false); }
  };
  if (pw) return <TempPassword email={f.email} pw={pw} onClose={onClose} />;
  return (
    <Modal title={id ? 'Edit Admin' : 'New Admin'} subtitle={id ? undefined : 'A temporary password is generated and shown once.'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>{id ? 'Save' : 'Create Admin'}</button></>}>
      <div style={grid}>
        <Field label="Name"><input className="input" value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Email"><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Phone (optional)"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Role" hint="superadmin: everything · controller: operations + audit · group_admin: read-only"><select className="select" value={f.role} onChange={set('role')}>{roles.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}</select></Field>
        <Field label="Status"><select className="select" value={f.status} onChange={set('status')}><option value="active">active</option><option value="suspended">suspended</option></select></Field>
        <Field label="Group (group admins)"><select className="select" value={f.groupId} onChange={set('groupId')}><option value="">—</option>{groups.map((g) => <option key={g.publicId} value={g.publicId}>{g.name}</option>)}</select></Field>
      </div>
    </Modal>
  );
}

/* ---------------- Security alerts ---------------- */
export function SendAlertForm({ onSent }: { onSent: () => void }) {
  const { toast, can } = useApp();
  const { f, setF, set } = useForm({ title: '', lga: 'All', userType: 'All', group: 'All', body: '' });
  const [est, setEst] = useState<{ users: number; agents: number; total: number; options: { lgas: string[]; userTypes: string[]; groups: string[] } } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => api(`/alerts/audience?lga=${encodeURIComponent(f.lga)}&userType=${f.userType}&group=${encodeURIComponent(f.group)}`).then(setEst).catch(() => undefined), 200);
    return () => clearTimeout(t);
  }, [f.lga, f.userType, f.group]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { const r = await api<{ recipients: { total: number } }>('/alerts', { method: 'POST', json: f }); toast(`Security alert saved for ~${r.recipients.total} recipients (live broadcast after the Homeland handshake)`); setF({ ...f, title: '', body: '' }); onSent(); }
    catch (x: any) { toast(x.message, 'error'); } finally { setBusy(false); }
  };
  const o = est?.options;
  return (
    <form className="card card-pad" style={{ marginBottom: 16 }} onSubmit={submit}>
      <div style={grid}>
        <Field label="Alert title" full><input className="input" required maxLength={140} value={f.title} onChange={set('title')} placeholder="e.g. Avoid Ariaria junction this evening" /></Field>
        <Field label="LGA"><select className="select" value={f.lga} onChange={set('lga')}>{(o?.lgas || ['All', ...LGAS]).map((l) => <option key={l}>{l}</option>)}</select></Field>
        <Field label="User type"><select className="select" value={f.userType} onChange={(e) => setF({ ...f, userType: e.target.value, group: e.target.value === 'Users' ? 'All' : f.group })}>{(o?.userTypes || ['All', 'Users', 'Agents']).map((l) => <option key={l}>{l}</option>)}</select></Field>
        <Field label="Homeland group" hint={f.group !== 'All' ? 'Group targets agents only' : undefined}><select className="select" value={f.group} onChange={set('group')} disabled={f.userType === 'Users'}>{(o?.groups || ['All']).map((l) => <option key={l}>{l}</option>)}</select></Field>
        <Field label="Alert description" full><textarea className="textarea" required maxLength={4000} value={f.body} onChange={set('body')} /></Field>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="chip blue" data-tip="Active users + active agents matching the audience">{est ? `~${est.total.toLocaleString('en-NG')} recipients · ${est.users} users · ${est.agents} agents` : 'Estimating audience…'}</span>
        <button className="btn btn-primary" disabled={busy || !can('ops')}><Send size={15} /> {busy ? 'Sending…' : 'Send Alert'}</button>
      </div>
    </form>
  );
}
