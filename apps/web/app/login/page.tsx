'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, Lock, Mail, ShieldHalf } from 'lucide-react';
import { api } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      await api('/auth/login', { method: 'POST', json: { email, password } });
      const next = params.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (e: any) { setErr(e.status === 401 ? 'Invalid email or password' : e.message || 'Login failed'); setBusy(false); }
  };
  return (
    <form className="login-card" onSubmit={submit}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="brand-mark"><ShieldHalf size={19} /></span>
        <div><div className="brand-name">Ac<span>Intel</span></div><div className="brand-sub">Actionable Intelligence</div></div>
      </div>
      <h2>Control room sign in</h2>
      <p className="hint" style={{ marginTop: 0, marginBottom: 22 }}>Abia Homeland Security Service · authorised staff only</p>
      {err && <div className="err">{err}</div>}
      <div className="field"><label className="label" htmlFor="email">Email</label>
        <div style={{ position: 'relative' }}><Mail size={16} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--faint)' }} />
          <input id="email" className="input" style={{ paddingLeft: 36 }} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@acintel.local" /></div></div>
      <div className="field"><label className="label" htmlFor="pw">Password</label>
        <div style={{ position: 'relative' }}><Lock size={16} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--faint)' }} />
          <input id="pw" className="input" style={{ paddingLeft: 36, paddingRight: 40 }} type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" className="icon-btn" style={{ position: 'absolute', right: 2, top: 1 }} onClick={() => setShow((s) => !s)} data-tip={show ? 'Hide password' : 'Show password'} aria-label="Toggle password">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></div>
      <button className="btn btn-primary" style={{ width: '100%', height: 44, justifyContent: 'center', marginTop: 6 }} disabled={busy}>{busy ? 'Signing in…' : <>Sign in <ArrowRight size={16} /></>}</button>
      <p className="hint" style={{ marginTop: 18, textAlign: 'center' }}>Sessions expire after 12 hours · times shown in Africa/Lagos</p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="login-wrap">
      <section className="login-art">
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 10 }}><span className="crest">AB</span><b>Abia Control Room</b></div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h1>Every report, agent and alarm — one live picture.</h1>
          <p>AcIntel turns Homeland reports, alarms and field agents into actionable intelligence for the Abia control room.</p>
        </div>
        <div className="login-stats"><div><b>17</b><small>LGAs covered</small></div><div><b>14</b><small>Partner agencies</small></div><div><b>24/7</b><small>Live monitoring</small></div></div>
      </section>
      <section className="login-form"><Suspense><LoginForm /></Suspense></section>
    </div>
  );
}
