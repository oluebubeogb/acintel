'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Bell, BarChart3, ChevronRight, LayoutDashboard, LogOut, Menu, ScrollText, Settings, ShieldHalf, UserRound } from 'lucide-react';
import { DayOverlay } from './overlays';
import { NAV, parentForPath } from '@/lib/nav';
import { api } from '@/lib/api';
import { NAV_ICONS } from './icons';
import { CountBadge, useApp } from './providers';
import { GlobalSearch } from './search';
import { AiFab } from './ai';

function LagosClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  if (!now) return <div className="clock" style={{ width: 150 }} />;
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(now);
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  return <div className="clock" data-tip="Africa/Lagos (WAT, UTC+1)" data-tip-pos="bottom"><b>{time}</b><small>{date}</small></div>;
}

function UserMenu() {
  const { me } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
  const initials = (me?.name || 'AC').split(' ').map((s) => s[0]).slice(0, 2).join('');
  const logout = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => undefined); router.replace('/login'); };
  return (
    <div className="user-menu" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} data-tip={me?.email || 'Account'} data-tip-pos="bottom" aria-label="Account menu">
        <span className="avatar">{initials}</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head"><b style={{ fontSize: 13 }}>{me?.name}</b><div className="hint">{me?.email}</div><span className="chip blue" style={{ marginTop: 6 }}>{me?.role}</span></div>
          {me && <Link className="menu-item" href={`/e/${me.publicId}`} onClick={() => setOpen(false)}><UserRound size={16} /> My profile</Link>}
          <Link className="menu-item" href="/settings" onClick={() => setOpen(false)}><Settings size={16} /> Settings</Link>
          <button className="menu-item" onClick={logout} style={{ color: 'var(--rose)' }}><LogOut size={16} /> Log out</button>
        </div>
      )}
    </div>
  );
}

function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const path = usePathname();
  const { counts, can, live } = useApp();
  const [active, setActive] = useState<string>(parentForPath(path) || 'reports');
  useEffect(() => { const p = parentForPath(path); if (p) setActive(p); }, [path]);
  const parent = NAV.find((n) => n.key === active)!;
  return (
    <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
      <div className="side-label"><span>Control room</span><span className="live-dot" style={live === 'live' ? undefined : { background: '#f59e0b', boxShadow: 'none' }} data-tip={live === 'live' ? 'Live — realtime stream connected' : 'Reconnecting… badges refresh by polling'} data-tip-pos="left" /></div>
      <div className="nav-grid">
        {NAV.map((n) => {
          const Icon = NAV_ICONS[n.icon];
          return (
            <button key={n.key} className={`tile tone-${n.tone} ${active === n.key ? 'active' : ''}`} onClick={() => setActive(n.key)} data-tip={n.full} aria-pressed={active === n.key}>
              <span className="ico"><Icon size={20} strokeWidth={2} /></span>
              <span className="t-label">{n.short}</span>
              <CountBadge n={counts.parents[n.key]} />
            </button>
          );
        })}
      </div>
      <div className="panel" key={parent.key}>
        <div className="panel-head"><div><b>{parent.full}</b><small>{parent.children.length} {parent.children.length === 1 ? 'page' : 'pages'}</small></div></div>
        <ul className="stripe-list">
          {parent.children.map((c, i) => (
            <li key={c.key}>
              <Link href={c.href} className={path === c.href ? 'current' : ''} style={{ animationDelay: `${i * 25}ms` }} onClick={onNavigate} title={c.full}>
                <span>{c.label}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><CountBadge n={counts.targets[c.key]} /><ChevronRight size={14} color="var(--faint)" /></span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="side-foot">
        <Link href="/" className={`side-link ${path === '/' ? 'current' : ''}`} onClick={onNavigate}><LayoutDashboard size={16} /> Dashboard</Link>
        <Link href="/reports/analytics" className={`side-link ${path === '/reports/analytics' ? 'current' : ''}`} onClick={onNavigate}><BarChart3 size={16} /> Analytics</Link>
        {can('audit.view') && <Link href="/audit" className={`side-link ${path === '/audit' ? 'current' : ''}`} onClick={onNavigate}><ScrollText size={16} /> Audit log</Link>}
        <Link href="/settings" className={`side-link ${path === '/settings' ? 'current' : ''}`} onClick={onNavigate}><Settings size={16} /> Settings</Link>
      </div>
    </aside>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { counts, day, closeDay } = useApp();
  const path = usePathname();
  useEffect(() => setMobileOpen(false), [path]);
  useEffect(() => closeDay(), [path]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="shell">
      <header className="topbar">
        <button className="icon-btn mobile-only" onClick={() => setMobileOpen((o) => !o)} aria-label="Toggle navigation"><Menu size={20} /></button>
        <Link href="/" className="brand" data-tip="Dashboard" data-tip-pos="bottom">
          <span className="brand-mark"><ShieldHalf size={19} /></span>
          <span><div className="brand-name">Ac<span>Intel</span></div><div className="brand-sub">Actionable Intelligence</div></span>
        </Link>
        <div className="state-pill" data-tip="Abia State Homeland Security — crest placeholder" data-tip-pos="bottom"><span className="crest">AB</span>Abia Control Room</div>
        <GlobalSearch />
        <div className="top-spacer" />
        <LagosClock />
        <Link href="/alerts" className="icon-btn" data-tip="Alerts & notifications" data-tip-pos="bottom" aria-label="Alerts">
          <Bell size={19} />
          {counts.total > 0 && <span style={{ position: 'absolute', top: 2, right: 0 }}><CountBadge n={counts.total} /></span>}
        </Link>
        <Link href="/settings" className="icon-btn" data-tip="Settings" data-tip-pos="bottom" aria-label="Settings"><Settings size={19} /></Link>
        <UserMenu />
      </header>
      {mobileOpen && <div className="scrim" onClick={() => setMobileOpen(false)} />}
      <Sidebar open={mobileOpen} onNavigate={() => setMobileOpen(false)} />
      <main className="main" key={path}>{children}</main>
      <AiFab />
      {day && <DayOverlay date={day.date} entity={day.entity} onClose={closeDay} />}
    </div>
  );
}

export function PageHead({ crumbs, title, subtitle, actions }: { crumbs?: { label: string; href?: string }[]; title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {crumbs && <div className="crumbs">{crumbs.map((c, i) => <span key={i} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>{i > 0 && <ChevronRight size={12} />}{c.href ? <Link href={c.href}>{c.label}</Link> : c.label}</span>)}</div>}
        <h1 className="title">{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  );
}
