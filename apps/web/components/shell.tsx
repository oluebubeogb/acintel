'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Bell, BarChart3, LayoutDashboard, LogOut, Menu, MessagesSquare, ScrollText, Settings, ShieldHalf, UserRound } from 'lucide-react';
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
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h12' }).format(now);
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
          {me && <Link className="menu-item" href={`/e/${me.publicId}`} onClick={() => setOpen(false)}><UserRound size={16} /> My Profile</Link>}
          <Link className="menu-item" href="/settings" onClick={() => setOpen(false)}><Settings size={16} /> Settings</Link>
          <button className="menu-item" onClick={logout} style={{ color: 'var(--rose)' }}><LogOut size={16} /> Log Out</button>
        </div>
      )}
    </div>
  );
}

/** Number of columns the nav grid currently renders (read from CSS so breakpoints live in one place). */
function useGridCols(ref: React.RefObject<HTMLDivElement>) {
  const [cols, setCols] = useState(2);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const read = () => { const t = getComputedStyle(el).gridTemplateColumns; const n = t && t !== 'none' ? t.split(' ').filter(Boolean).length : 2; setCols(Math.max(1, n)); };
    read();
    const ro = new ResizeObserver(read); ro.observe(el);
    window.addEventListener('resize', read);
    return () => { ro.disconnect(); window.removeEventListener('resize', read); };
  }, [ref]);
  return cols;
}

function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const path = usePathname();
  const { counts, can } = useApp();
  const [active, setActive] = useState<string>(parentForPath(path) || 'reports');
  useEffect(() => { const p = parentForPath(path); if (p) setActive(p); }, [path]);
  const gridRef = useRef<HTMLDivElement>(null);
  const cols = useGridCols(gridRef);
  const parent = NAV.find((n) => n.key === active);
  const idx = parent ? NAV.indexOf(parent) : -1;
  // The pane sits directly under the row that holds the clicked tile.
  const after = idx < 0 ? -1 : Math.min(NAV.length - 1, Math.floor(idx / cols) * cols + cols - 1);
  const pane = parent && (
    <div className="panel" key={`pane-${parent.key}`}>
      <div className="panel-head"><b>{parent.full}</b></div>
      <ul className="stripe-list">
        {parent.children.map((c, i) => (
          <li key={c.key}>
            <Link href={c.href} className={path === c.href ? 'current' : ''} style={{ animationDelay: `${i * 25}ms` }} onClick={onNavigate} title={c.full}>
              <span>{c.label}</span>
              <CountBadge n={counts.targets[c.key]} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
      <div className="side-label"><span>Control Room</span></div>
      <div className="nav-grid" ref={gridRef}>
        {NAV.map((n, i) => {
          const Icon = NAV_ICONS[n.icon];
          return (
            <Fragment key={n.key}>
              <button className={`tile card-select tone-${n.tone} ${active === n.key ? 'active is-active' : ''}`} onClick={() => setActive((a) => (a === n.key ? '' : n.key))} data-tip={n.full} aria-pressed={active === n.key} aria-expanded={active === n.key}>
                <span className="ico"><Icon size={20} strokeWidth={2} /></span>
                <span className="t-label">{n.short}</span>
                <CountBadge n={counts.parents[n.key]} />
              </button>
              {i === after && pane}
            </Fragment>
          );
        })}
      </div>
      <div className="side-foot">
        <Link href="/" className={`side-link ${path === '/' ? 'current' : ''}`} onClick={onNavigate}><LayoutDashboard size={16} /> Dashboard</Link>
        <Link href="/reports/analytics" className={`side-link ${path === '/reports/analytics' ? 'current' : ''}`} onClick={onNavigate}><BarChart3 size={16} /> Analytics</Link>
        {can('audit.view') && <Link href="/audit" className={`side-link ${path === '/audit' ? 'current' : ''}`} onClick={onNavigate}><ScrollText size={16} /> Audit Log</Link>}
      </div>
    </aside>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { counts, day, closeDay, can } = useApp();
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
        <div className="top-actions">
          {can('ops') && (
            <Link href="/chats" className={`icon-btn bell ${path.startsWith('/chats') ? 'is-on' : ''}`} data-tip={counts.chats ? `Chats · ${counts.chats} unread` : 'Chats'} data-tip-pos="bottom" aria-label={`Chats${counts.chats ? `, ${counts.chats} unread` : ''}`}>
              <MessagesSquare size={19} />
              {(counts.chats || 0) > 0 && <CountBadge n={counts.chats} />}
            </Link>
          )}
          <Link href="/alerts" className="icon-btn bell" data-tip="Alerts & Notifications" data-tip-pos="bottom" aria-label="Alerts">
            <Bell size={19} />
            {counts.total > 0 && <CountBadge n={counts.total} />}
          </Link>
          <Link href="/settings" className="icon-btn" data-tip="Settings" data-tip-pos="bottom" aria-label="Settings"><Settings size={19} /></Link>
          <UserMenu />
        </div>
      </header>
      {mobileOpen && <div className="scrim" onClick={() => setMobileOpen(false)} />}
      <Sidebar open={mobileOpen} onNavigate={() => setMobileOpen(false)} />
      <main className="main" key={path}>{children}</main>
      <AiFab />
      {day && <DayOverlay date={day.date} entity={day.entity} onClose={closeDay} />}
    </div>
  );
}

/** Page header: title + actions only (crumbs/subtitle props are accepted for compatibility but no longer rendered). */
export function PageHead({ title, actions }: { crumbs?: { label: string; href?: string }[]; title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="page-head">
      <h1 className="title">{title}</h1>
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  );
}
