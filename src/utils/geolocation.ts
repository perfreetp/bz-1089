export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function deg2rad(deg: number): number {
  return deg * (Math.PI / 180);
}

export function generateHeatmapGrid(
  points: { latitude: number; longitude: number; weight: number }[],
  cellSizeKm: number = 1
): { latitude: number; longitude: number; intensity: number; count: number }[] {
  if (points.length === 0) return [];

  const grid = new Map<
    string,
    { latitude: number; longitude: number; intensity: number; count: number }
  >();

  for (const p of points) {
    const latBucket = Math.round(p.latitude / (cellSizeKm / 111));
    const lonBucket = Math.round(
      p.longitude / (cellSizeKm / (111 * Math.cos(deg2rad(p.latitude))))
    );
    const key = `${latBucket}_${lonBucket}`;

    const existing = grid.get(key);
    if (existing) {
      existing.intensity += p.weight;
      existing.count += 1;
      existing.latitude =
        (existing.latitude * (existing.count - 1) + p.latitude) / existing.count;
      existing.longitude =
        (existing.longitude * (existing.count - 1) + p.longitude) / existing.count;
    } else {
      grid.set(key, {
        latitude: p.latitude,
        longitude: p.longitude,
        intensity: p.weight,
        count: 1,
      });
    }
  }

  return Array.from(grid.values());
}

export function isWithinRadius(
  centerLat: number,
  centerLon: number,
  lat: number,
  lon: number,
  radiusKm: number
): boolean {
  return haversineDistanceKm(centerLat, centerLon, lat, lon) <= radiusKm;
}
