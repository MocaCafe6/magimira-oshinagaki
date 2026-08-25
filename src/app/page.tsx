import { CreatorBrowser } from '@/components/CreatorBrowser';
import { buildVenueIndex } from '@/lib/data';
import { VENUES, defaultVenue } from '@shared/types';

export default async function HomePage() {
  const indexes = await Promise.all(VENUES.map((v) => buildVenueIndex(v)));
  // 最初に見せる会場はビルド時に決める。クライアントで日付を見ると
  // ハイドレーションで HTML と食い違う（React error #418）。
  const initialVenue = defaultVenue(new Date());
  return <CreatorBrowser indexes={indexes} initialVenue={initialVenue} />;
}
