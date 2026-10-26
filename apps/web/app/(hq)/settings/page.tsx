'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, Bot, ExternalLink, Save } from 'lucide-react';
import { InfoTip } from '@/components/ui';
import { api } from '@/lib/api';
import { PageHead } from '@/components/shell';
import { playChime, setChimeEnabled, useApp } from '@/components/providers';

const TOGGLES: [string, string, string][] = [
  ['notifyNewUsers', 'New User Signups', 'Show a badge and an alert whenever a new user registers on the mobile app'],
  ['notifyNewReports', 'New Incident Reports', 'Show a badge and an alert the moment a new incident report comes in from any source'],
  ['notifyAlarms', 'Panic & Duress Alarms', 'Highest-priority alerts — panic and duress alarms raised by users or agents'],
  ['notifySound', 'Sound On Alarm', 'Play a soft chime for new alarms and reports. Applies instantly for everyone — no Save needed'],
  ['compactTables', 'Compact Tables', 'Denser table rows so more of a large list fits on screen'],
];

const AI_TOGGLES: [string, string, string][] = [
  ['aiIncidentText', 'Report Titles & Summaries', 'Background worker that writes an AI headline + summary for each new report (local titles are always shown)'],
  ['aiChat', 'Control Room Chat', 'AcIntel Assist uses the AI model; when paused it answers simple count/list/CSV questions offline'],
  ['aiRegenerate', 'On-Demand Regenerate', 'The regenerate button on a single report page'],
];
type AiStatus = { configured: boolean; model: string; features: Record<string, { on: boolean; running: boolean; envOff?: boolean }> };

function Switch({ on, disabled, onToggle, label }: { on: boolean; disabled?: boolean; onToggle: () => void; label: string }) {
  return <span className={`switch ${on ? 'on' : ''} ${disabled ? 'is-disabled' : ''}`} role="switch" aria-label={label} aria-checked={on} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
    onClick={() => !disabled && onToggle()} onKeyDown={(e) => !disabled && (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), onToggle())}><i /></span>;
}

export default function SettingsPage() {
  const { prefs, savePrefs, toast, me, can, live } = useApp();
  const [v, setV] = useState<Record<string, any> | null>(null);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const loadAi = () => api<AiStatus>('/ai/status').then(setAi).catch(() => undefined);
  useEffect(() => { loadAi(); }, []);
  useEffect(() => { if (prefs && !v) setV({ ...prefs.site }); }, [prefs, v]);
  if (!v) return <div className="card card-pad"><div className="skeleton" style={{ width: '40%' }} /></div>;
  const opts: number[] = v.pageSizeOptions || [25, 100, 500, 1000];
  const isCustom = !opts.includes(Number(v.pageSize));
  const save = async () => {
    setBusy(true);
    try { await savePrefs('site', v); toast('Site settings saved'); loadAi(); } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  // Sound On Alarm applies the moment it is flipped (saved straight away) so "off" is never left pending an unsaved form.
  const flip = async (k: string) => {
    const next = !v[k]; setV({ ...v, [k]: next });
    if (k !== 'notifySound') return;
    setChimeEnabled(next);
    if (next) playChime({ preview: true });
    if (!can('settings.site')) return;
    try { await savePrefs('site', { notifySound: next }); toast(next ? 'Alarm sound on' : 'Alarm sound off'); } catch (e: any) { toast(e.message, 'error'); }
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
          <div className="field"><label className="label label-tip">Fallback Refresh (Seconds)<InfoTip text="Badges and KPI numbers are pushed the moment data changes (SSE + Redis) — no polling while idle. This 10–120s interval is only used if the live stream is blocked; with the stream up the screen heals every 120s and on tab refocus." /></label>
            <input className="input" type="number" min={10} max={120} value={v.pollSeconds} onChange={(e) => setV({ ...v, pollSeconds: Math.min(120, Math.max(10, Number(e.target.value) || 15)) })} /></div>
        </div>
        <div className="card card-pad">
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center' }}>Your Access<InfoTip text="Superadmin: everything · Controller: operations + audit log · Group admin: read-only" /></h3>
          <div className="kv" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div><small>Signed In As</small><b>{me?.email}</b></div><div><small>Role</small><b><span className="chip violet">{me?.role?.replace('_', ' ')}</span></b></div>
            <div><small>Live Stream</small><b><span className={`chip ${live === 'live' ? 'green' : 'amber'}`}>{live}</span></b></div><div><small>Timezone</small><b>Africa/Lagos (WAT)</b></div>
          </div>
          <div className="hint" style={{ marginTop: 10 }}>Permissions: {(me?.perms || []).map((p: string) => <span key={p} className="chip" style={{ marginRight: 4 }}>{p}</span>)}</div>

        </div>
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Notifications</h3>
          {TOGGLES.map(([k, l, h]) => (
            <label key={k} className="toggle-row">
              <div className="tr-label"><b>{l}</b><InfoTip text={h} /></div>
              <span className={`switch ${v[k] ? 'on' : ''}`} role="switch" aria-checked={!!v[k]} tabIndex={0}
                onClick={() => flip(k)} onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), flip(k))}><i /></span>
            </label>
          ))}
        </div>
        <div className="card card-pad ai-settings">
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Bot size={17} /> AI
            <Link href="/settings/ai-usage" className="btn btn-sm btn-ghost ai-usage-link" data-tip="Open AI usage — what ran, tokens and time" data-tip-pos="left"><Activity size={14} /> Usage <ExternalLink size={13} /></Link></h3>
          <div className={`ai-provider ${ai?.configured ? 'ok' : 'off'}`}>
            {ai ? (ai.configured ? <><b>Provider Configured</b> · model <code>{ai.model}</code></> : <><b>Provider Not Configured</b> · switches can be saved, but no AI credits are used until <code>OPENAI_BASE_URL</code> and <code>OPENAI_API_KEY</code> are set on the API</>) : 'Checking provider…'}
          </div>
          {(() => {
            const site = can('settings.site');
            const master = v.aiEnabled !== false;
            const state = (k: string) => {
              const on = master && v[k] !== false;
              const saved = prefs?.site[k] !== false && prefs?.site.aiEnabled !== false;
              if (!on) return <span className="chip">Paused</span>;
              if (k === 'aiIncidentText' && ai?.features?.aiIncidentText?.envOff) return <span className="chip amber" data-tip="INCIDENT_AI=false is set on the API">Off (Env)</span>;
              if (ai && !ai.configured) return <span className="chip amber">Idle · No Keys</span>;
              return <span className="chip green">{saved ? 'Running' : 'Running After Save'}</span>;
            };
            return <>
              <label className="toggle-row">
                <div className="tr-label"><b>AI Enabled</b><InfoTip text="Master switch — pause every AI feature at once without touching the server env" /></div>
                <Switch label="AI Enabled" on={master} disabled={!site} onToggle={() => setV({ ...v, aiEnabled: !master })} />
              </label>
              {AI_TOGGLES.map(([k, l, h]) => (
                <label key={k} className={`toggle-row ${master ? '' : 'is-muted'}`}>
                  <div className="tr-label"><b>{l}</b><InfoTip text={h} />{state(k)}</div>
                  <Switch label={l} on={v[k] !== false} disabled={!site || !master} onToggle={() => setV({ ...v, [k]: v[k] === false })} />
                </label>
              ))}
              <p className="hint" style={{ display: 'flex', alignItems: 'center' }}>{site ? 'Applies after Save Changes' : 'Superadmin only'}<InfoTip text="Changes apply within a few seconds of Save Changes — no API restart. The provider itself (OPENAI_*) stays in the server env." /></p>
            </>;
          })()}
        </div>
      </div>
    </>
  );
}
