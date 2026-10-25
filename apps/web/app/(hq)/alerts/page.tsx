'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, CheckCheck, FileWarning, Siren, UserPlus, ShieldCheck } from 'lucide-react';
import { api, lagosTime, timeAgo } from '@/lib/api';
import { PageHead } from '@/components/shell';
import { useApp } from '@/components/providers';

type N = { id: string; target: string; kind: string; title: string; body?: string; href?: string; readAt: string | null; createdAt: string };
const ICON: Record<string, any> = { report: FileWarning, alarm: Siren, user: UserPlus, agent: ShieldCheck, dispatch: CheckCheck };
const TONE: Record<string, string> = { report: 'amber', alarm: 'rose', user: 'blue', agent: 'green', dispatch: 'violet' };

export default function AlertsPage() {
  const { counts, refreshCounts, toast } = useApp();
  const [items, setItems] = useState<N[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const load = useCallback(() => api<{ items: N[] }>(`/notifications?limit=300${filter === 'unread' ? '&unread=1' : ''}`).then((r) => setItems(r.items)), [filter]);
  useEffect(() => { load(); }, [load, counts.total]);
  const read = async (body: object, msg?: string) => { await api('/notifications/read', { method: 'POST', json: body }); load(); refreshCounts(); if (msg) toast(msg); };
  return (
    <>
      <PageHead crumbs={[{ label: 'AcIntel', href: '/' }, { label: 'Alerts' }]} title="Alerts & notifications" subtitle={`${counts.total} unread · new signups, reports, alarms and dispatches`}
        actions={<>
          <div className="seg">{(['all', 'unread'] as const).map((f) => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : 'Unread'}</button>)}</div>
          <button className="btn" disabled={!counts.total} onClick={() => read({ all: true }, 'All notifications marked as read')}><CheckCheck size={15} /> Mark all read</button>
        </>} />
      <div className="card">
        {!items && Array.from({ length: 6 }).map((_, i) => <div key={i} className="feed-item"><div className="skeleton" style={{ width: '60%' }} /></div>)}
        {items?.length === 0 && <div className="empty"><div className="e-ico"><Bell size={22} /></div><b>You're all caught up</b><div className="hint">New activity will appear here in real time.</div></div>}
        {items?.map((n) => {
          const I = ICON[n.kind] || Bell;
          return (
            <div key={n.id} className={`feed-item ${n.readAt ? '' : 'unread'}`}>
              <span className={`feed-ico ${TONE[n.kind] || 'blue'}`}><I size={16} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{n.href ? <Link href={n.href} onClick={() => !n.readAt && read({ ids: [n.id] })}>{n.title}</Link> : n.title}</div>
                <div className="hint">{n.body} · <span className="chip">{n.target}</span></div>
              </div>
              <span className="hint" data-tip={`${lagosTime(n.createdAt)} WAT`}>{timeAgo(n.createdAt)}</span>
              {!n.readAt && <button className="btn btn-sm btn-ghost" onClick={() => read({ ids: [n.id] })} data-tip="Mark as read"><CheckCheck size={14} /></button>}
            </div>
          );
        })}
      </div>
    </>
  );
}
