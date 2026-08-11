// ViltIQ Engine — avstand til vei via OpenStreetMap/Overpass API.
// Verifisert manuelt (2026-08-11): Overpass returnerer highway-veier innenfor
// en gitt radius som JSON. Bevisst ÉN spørring for HELE analyseområdet per
// motorkjøring (ikke én per rutepunkt) — avstand til hvert prøvepunkt regnes
// deretter lokalt mot de returnerte veigeometriene, se resolve.ts.

import { distanceMeters } from "@/src/lib/geo";
import type { LatLng } from "../types";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

/** Henter veigeometrier (som lister av punkter) innenfor `radiusMeters` av `center`. Tom liste ved feil. */
export async function fetchRoadsNear(center: LatLng, radiusMeters: number): Promise<LatLng[][]> {
  try {
    const query = `[out:json][timeout:10];way["highway"](around:${radiusMeters},${center.latitude},${center.longitude});out geom;`;
    const url = `${OVERPASS_URL}?data=${encodeURIComponent(query)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return [];

    const data = await res.json();
    const elements: unknown[] = Array.isArray(data?.elements) ? data.elements : [];

    const roads: LatLng[][] = [];
    for (const el of elements) {
      const geometry = (el as { geometry?: { lat: number; lon: number }[] })?.geometry;
      if (!Array.isArray(geometry)) continue;
      const pts = geometry
        .filter((g) => typeof g?.lat === "number" && typeof g?.lon === "number")
        .map((g) => ({ latitude: g.lat, longitude: g.lon }));
      if (pts.length > 0) roads.push(pts);
    }
    return roads;
  } catch {
    return [];
  }
}

/** Nærmeste avstand (m) fra et punkt til en av veigeometriene. Null hvis ingen veier ble funnet. */
export function distanceToNearestRoadMeters(point: LatLng, roads: readonly LatLng[][]): number | null {
  let min = Infinity;
  for (const road of roads) {
    for (const node of road) {
      const d = distanceMeters(point, node);
      if (d < min) min = d;
    }
  }
  return Number.isFinite(min) ? min : null;
}
