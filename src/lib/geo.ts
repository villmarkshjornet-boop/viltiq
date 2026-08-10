// Delte geometri-/kartberegninger. Tidligere kopiert med små variasjoner i
// app/index.tsx, app/kart.tsx og app/kamera/[id].tsx — samlet her som eneste
// kilde til sannhet slik at f.eks. en retningsberegning ikke kan gå ut av sync
// mellom skjermene.

export type LatLng = { latitude: number; longitude: number };

const EARTH_RADIUS_M = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Avstand mellom to punkter i meter (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return EARTH_RADIUS_M * (2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

/** Kompassretning (0–360°, 0 = nord) fra punkt `from` til punkt `to`. */
export function calcBearing(from: LatLng, to: LatLng): number {
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const dLon = toRad(to.longitude - from.longitude);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Flytt et punkt `distM` meter i retning `bearingDeg` (0 = nord). */
export function movePoint(
  lat: number,
  lng: number,
  bearingDeg: number,
  distM: number
): LatLng {
  const ang = toRad(bearingDeg);
  return {
    latitude:
      lat + ((distM / EARTH_RADIUS_M) * (180 / Math.PI)) * Math.cos(ang),
    longitude:
      lng +
      (((distM / EARTH_RADIUS_M) * (180 / Math.PI)) * Math.sin(ang)) /
        Math.cos(toRad(lat)),
  };
}

/** Kompassdirection som norsk forkortelse ("N", "NØ", ...). */
export function vindRetningLabel(grader: number): string {
  const dirs = ["N", "NØ", "Ø", "SØ", "S", "SV", "V", "NV"];
  return dirs[Math.round(grader / 45) % 8];
}

/**
 * Anonymiser en posisjon med et tilfeldig avvik innenfor en sirkel med gitt
 * radius i meter (jevnt fordelt over arealet, ikke bare langs aksene).
 * Standard ±200 m i tråd med personvernerklæringen.
 */
export function anonymiserPosisjon(
  lat: number,
  lon: number,
  radiusM = 200
): LatLng {
  const r = radiusM * Math.sqrt(Math.random());
  const theta = Math.random() * 2 * Math.PI;
  return movePoint(lat, lon, (theta * 180) / Math.PI, r);
}

/** Sektor (kakestykke) rundt et senterpunkt — brukt til å vise kamera-/dyreretning i kart. */
export function buildSector(
  center: LatLng,
  radiusM: number,
  bearingDeg: number,
  spanDeg = 110,
  steps = 24
): LatLng[] {
  const coords: LatLng[] = [center];
  const start = bearingDeg - spanDeg / 2;
  for (let i = 0; i <= steps; i++) {
    coords.push(movePoint(center.latitude, center.longitude, start + (i / steps) * spanDeg, radiusM));
  }
  coords.push(center);
  return coords;
}
