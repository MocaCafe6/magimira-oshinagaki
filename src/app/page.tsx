import { CreatorBrowser } from '@/components/CreatorBrowser';
import { buildVenueIndex } from '@/lib/data';
import { VENUES } from '@shared/types';

export default async function HomePage() {
  const indexes = await Promise.all(VENUES.map((v) => buildVenueIndex(v)));
  return <CreatorBrowser indexes={indexes} />;
}
