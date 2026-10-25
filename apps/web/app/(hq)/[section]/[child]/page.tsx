import { notFound } from 'next/navigation';
import { findChild } from '@/lib/nav';
import { ListView } from '@/components/listview';
export default function Page({ params }: { params: { section: string; child: string } }) {
  if (!findChild(params.section, params.child) || params.section === 'alerts') notFound();
  return <ListView section={params.section} child={params.child} />;
}
