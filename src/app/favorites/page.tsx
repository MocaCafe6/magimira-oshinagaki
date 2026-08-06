import { FavoritesView } from '@/components/FavoritesView';
import { buildVenueIndex } from '@/lib/data';
import { VENUES } from '@shared/types';

export default async function FavoritesPage() {
  const indexes = await Promise.all(VENUES.map((v) => buildVenueIndex(v)));
  return <FavoritesView indexes={indexes} />;
}
