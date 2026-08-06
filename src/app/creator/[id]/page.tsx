import { notFound } from 'next/navigation';

import { CreatorDetailView } from '@/components/CreatorDetailView';
import { allCreatorIds, buildCreatorDetail } from '@/lib/data';

/** 静的エクスポートのため全サークルぶんのパスを列挙する */
export async function generateStaticParams(): Promise<{ id: string }[]> {
  return (await allCreatorIds()).map((id) => ({ id }));
}

export default async function CreatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await buildCreatorDetail(decodeURIComponent(id));
  if (!detail) notFound();
  return <CreatorDetailView detail={detail} />;
}
