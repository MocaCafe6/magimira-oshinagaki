import { MapView, type MapVenueData } from '@/components/MapView';
import { buildVenueIndex, loadVenueMap } from '@/lib/data';
import { VENUES, VENUE_META, defaultVenue } from '@shared/types';

export default async function MapPage() {
  const data: MapVenueData[] = [];
  for (const venue of VENUES) {
    const [index, map] = await Promise.all([buildVenueIndex(venue), loadVenueMap(venue)]);
    data.push({
      venue,
      label: index.label,
      hall: index.hall,
      days: index.days,
      route: VENUE_META[venue].route,
      map,
      creators: index.creators.map((c) => ({
        id: c.id,
        boothId: c.boothId,
        line: c.line,
        boothNo: c.boothNo,
        circleName: c.circleName,
        days: c.days,
        kind: c.kind,
        oshinagakiCount: c.oshinagakiCount,
      })),
    });
  }
  return <MapView data={data} initialVenue={defaultVenue(new Date())} />;
}
