'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, titleCase } from '@/lib/api';
import { PageHead } from '@/components/shell';
import { Col, DataTable, Row } from '@/components/ui';

const LK: Record<string, string> = { users: 'name', agents: 'name', reports: 'category', alarms: 'sender', tips: 'title', agent: 'category', user: 'category' };
const KIND_RE = /^[a-z]+\.[a-z_]+$/;

/** Generic "Open as page" target for KPI drill-downs: /records?kind=reports.all&status=resolved&from=… */
function RecordsInner() {
  const sp = useSearchParams();
  const kind = sp.get('kind') || '';
  const title = titleCase(sp.get('title') || 'Records');
  const qs = useMemo(() => { const q = new URLSearchParams(sp.toString()); q.delete('kind'); q.delete('title'); q.set('take', '10000'); return q.toString(); }, [sp]);
  const [data, setData] = useState<{ columns: Col[]; rows: Row[]; total: number } | null>(null);
  useEffect(() => {
    setData(null);
    if (!KIND_RE.test(kind)) { setData({ columns: [], rows: [], total: 0 }); return; }
    api<{ columns: Col[]; rows: Row[]; total: number }>(`/records/${kind}?${qs}`).then(setData).catch(() => setData({ columns: [], rows: [], total: 0 }));
  }, [kind, qs]);
  const lk = kind.startsWith('user.') && kind.endsWith('alarms') ? 'sender' : LK[kind.split('.')[0]];
  return (
    <>
      <PageHead title={title} />
      <DataTable columns={data?.columns || []} rows={data?.rows || []} total={data?.total} loading={!data} linkKey={lk} exportName={`${kind.replace('.', '-') || 'records'}-filtered`} />
    </>
  );
}

export default function RecordsPage() {
  return <Suspense fallback={<div className="card card-pad"><div className="skeleton" style={{ width: '40%' }} /></div>}><RecordsInner /></Suspense>;
}
