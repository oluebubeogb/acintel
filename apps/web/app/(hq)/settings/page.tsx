'use client';
import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { PageHead } from '@/components/shell';
import { playChime, useApp } from '@/components/providers';

const TOGGLES: [string, string, string][] = [
  ['notifyNewUsers', 'New User Signups', 'Badge + alert when a user registers'],
  ['notifyNewReports', 'New Incident Reports', 'Badge + alert when a report comes in'],
  ['notifyAlarms', 'Panic & Duress Alarms', 'Highest priority alerts'],
  ['notifySound', 'Sound On Alarm', 'Play a soft chime for new alarms'],
  ['compactTables', 'Compact Tables', 'Denser rows for large lists'],
];

export default function SettingsPage() {
  const { prefs, savePrefs, toast, me, can, live } = useApp();
  const [v, setV] = useState<Record<string, any> | null>(null);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (prefs && !v) setV({ ...prefs.site }); }, [prefs, v]);
  if (!v) return <div className="card card-pad"><div className="skeleton" style={{ width: '40%' }} /></div>;
  const opts: number[] = v.pageSizeOptions || [25, 100, 500, 1000];
  const isCustom = !opts.includes(Number(v.pageSize));
  const save = async () => {
    setBusy(true);
    try { await savePrefs('site', v); toast('Site settings saved'); } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHead crumbs={[{ label: 'AcIntel', href: '/' }, { label: 'Settings' }]} title="Site Settings" subtitle="Applies to every control-room admin · stored in the database"
        actions={<button className="btn btn-primary" onClick={save} disabled={busy || !can('settings.site')} data-tip={can('settings.site') ? 'Save for everyone' : 'Superadmin only'}><Save size={15} /> {busy ? 'Saving…' : 'Save Changes'}</button>} />
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Tables & Pagination</h3>
          <div className="field"><label className="label">Default Page Size</label>
            <div className="seg">{opts.map((o) => <button key={o} className={Number(v.pageSize) === o ? 'on' : ''} onClick={() => setV({ ...v, pageSize: o })}>{o}</button>)}
              <button className={isCustom ? 'on' : ''} onClick={() => setCustom(String(v.pageSize))}>Custom</button></div></div>
          <div className="field"><label className="label">Custom Size (1–10000)</label>
            <div style={{ display: 'flex', gap: 8 }}><input className="input" type="number" min={1} max={10000} value={custom || (isCustom ? v.pageSize : '')} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. 750" />
              <button className="btn" onClick={() => { const n = Math.round(Number(custom)); if (n >= 1 && n <= 10000) setV({ ...v, pageSize: n }); else toast('Enter 1–10000', 'error'); }}>Apply</button></div>
            <p className="hint">Current: <b>{v.pageSize}</b> rows per page (default 500)</p></div>
          <div className="field"><label className="label">Fallback Refresh When The Live Stream Is Down (Seconds)</label>
            <input className="input" type="number" min={10} max={120} value={v.pollSeconds} onChange={(e) => setV({ ...v, pollSeconds: Math.min(120, Math.max(10, Number(e.target.value) || 15)) })} />
            <p className="hint">Badges and KPI numbers are <b>pushed</b> the moment data changes (SSE + Redis) — no polling while idle. This interval (10–120s) is only used if the stream is blocked; with the stream up the screen heals once every 120s and on tab refocus.</p></div>
        </div>
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Your Access</h3>
          <div className="kv" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div><small>Signed In As</small><b>{me?.email}</b></div><div><small>Role</small><b><span className="chip violet">{me?.role?.replace('_', ' ')}</span></b></div>
            <div><small>Live Stream</small><b><span className={`chip ${live === 'live' ? 'green' : 'amber'}`}>{live}</span></b></div><div><small>Timezone</small><b>Africa/Lagos (WAT)</b></div>
          </div>
          <div className="hint" style={{ marginTop: 10 }}>Permissions: {(me?.perms || []).map((p: string) => <span key={p} className="chip" style={{ marginRight: 4 }}>{p}</span>)}</div>
          <p className="hint">Superadmin: everything · Controller: operations + audit log · Group admin: read-only.</p>
        </div>
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Notifications</h3>
          {TOGGLES.map(([k, l, h]) => (
            <label key={k} className="toggle-row">
              <div><b>{l}</b><div className="hint">{h}</div></div>
              <span className={`switch ${v[k] ? 'on' : ''}`} role="switch" aria-checked={!!v[k]} tabIndex={0}
                onClick={() => { if (k === 'notifySound' && !v[k]) playChime(); setV({ ...v, [k]: !v[k] }); }} onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), setV({ ...v, [k]: !v[k] }))}><i /></span>
            </label>
          ))}
        </div>
      </div>
    </>
  );
}
