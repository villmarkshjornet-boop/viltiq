// ViltIQ Engine — GEOGRAFISK land/vann-validitet via OpenStreetMap/Overpass,
// BEVISST FRIKOBLET fra habitat.ts (NIBIO AR5) sin klassifisering.
//
// V1.2.2 ROOT CAUSE (Kristiansand-regresjonen): V1.2.1 avgjorde spatial
// validity ut fra det GROVE miljø-prøvegridet (500 m–1200 m avstand mellom
// prøvepunkter, se resolve.ts) — samme datakilde OG samme oppløsning som
// habitatklassifiseringen. Dette funker for store, enkle vannflater (en bred
// fjord som i Molde-testen), men en skjærgård med tette øyer/sund (som ved
// Kristiansand) kan lett ha en vannkanal SMALERE enn prøvepunktavstanden —
// da lander ALDRI noe prøvepunkt i akkurat den kanalen, og ingen
// terskeljustering av "avstand til nærmeste vannprøve" kan fikse et rent
// INFORMASJONSTAP. Løsningen er ikke en strengere terskel, men en EGEN
// datakilde, med SIN EGEN oppløsning, dedikert til nøyaktig dette
// spørsmålet — habitatklassifisering og geografisk validitet trenger ikke
// dele datakilde eller oppløsning (§3 i V1.2.2-oppdraget).
//
// Denne filen henter ÉN gang per analyseområde (samme mønster som
// roads.ts sin fetchRoadsNear): OSM sine `natural=water`-polygoner (innsjøer,
// større vannflater kartlagt som lukkede areal) OG `natural=coastline`-linjer
// (hav/fjordgrense — OSM-konvensjon: land ligger til VENSTRE for linjens
// retning, vann til HØYRE). Testen for et vilkårlig punkt gjøres deretter
// LOKALT, geometrisk, uten flere nettverkskall — og kan derfor kjøres på
// scoring-gridets FULLE ~150 m oppløsning, ikke bare på de sparsomme
// miljø-prøvepunktene.

import type { LatLng } from "../types";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

export type WaterFeatures = {
  /** Lukkede polygoner (innsjøer o.l.) — punkt-i-polygon-test. */
  waterPolygons: LatLng[][];
  /** Kystlinje-segmenter (hav/fjord-grense) — side-av-linje-test. */
  coastlineSegments: LatLng[][];
};

export const EMPTY_WATER_FEATURES: WaterFeatures = { waterPolygons: [], coastlineSegments: [] };

/**
 * V1.3 (§Q): utfallet av ETT nettverksforsøk — bevisst adskilt fra selve
 * geometrien, som er tom BÅDE ved feil OG ved et gyldig "ingen vann-
 * /kystlinjebevis i søkeradiusen"-svar. Se resolve.ts for hvordan statusen
 * faktisk brukes (den samme forvekslingen §Q advarer mot for vei, gjelder
 * like mye her — se roads.ts).
 */
export type FetchAttemptStatus = "available" | "unavailable";

function extractGeometry(el: unknown): LatLng[] {
  const geometry = (el as { geometry?: { lat: number; lon: number }[] })?.geometry;
  if (!Array.isArray(geometry)) return [];
  return geometry
    .filter((g) => typeof g?.lat === "number" && typeof g?.lon === "number")
    .map((g) => ({ latitude: g.lat, longitude: g.lon }));
}

/**
 * Henter vann-/kystlinjegeometri innenfor `radiusMeters` av `center`. Tomme
 * lister ved feil — kaller ALDRI kaster (samme feil-svelgende mønster som
 * resten av environment/-modulen), slik at et mislykket Overpass-kall
 * degraderer til "ingen vannbevis" (→ "unknown", se resolve.ts), ikke krasj.
 */
export async function fetchWaterFeaturesNear(center: LatLng, radiusMeters: number): Promise<WaterFeatures> {
  return (await fetchWaterFeaturesNearWithStatus(center, radiusMeters)).value;
}

/**
 * V1.3 (§Q): som fetchWaterFeaturesNear over, men eksponerer i tillegg om
 * selve nettverksforsøket lyktes eller ikke — se elevation.ts sin
 * fetchElevationMetersWithStatus for samme mønster/begrunnelse. Bevisst en
 * EGEN, tilleggs-eksportert funksjon fremfor å endre fetchWaterFeaturesNear
 * sin signatur.
 */
export async function fetchWaterFeaturesNearWithStatus(
  center: LatLng,
  radiusMeters: number
): Promise<{ value: WaterFeatures; status: FetchAttemptStatus }> {
  try {
    const query =
      `[out:json][timeout:15];` +
      `(` +
      `way["natural"="water"](around:${radiusMeters},${center.latitude},${center.longitude});` +
      `way["natural"="coastline"](around:${radiusMeters},${center.latitude},${center.longitude});` +
      `relation["natural"="water"](around:${radiusMeters},${center.latitude},${center.longitude});` +
      `);out geom;`;
    const url = `${OVERPASS_URL}?data=${encodeURIComponent(query)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    // Se roads.ts sin filkommentar ved samme fetch-kall: overpass-api.de
    // svarer 406 på Node sin standard fetch() uten disse headerne.
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "*/*", "User-Agent": "ViltIQ/1.0 (+https://viltiq.no)" },
    });
    clearTimeout(timeout);
    if (!res.ok) return { value: EMPTY_WATER_FEATURES, status: "unavailable" };

    const data = await res.json();
    const elements: unknown[] = Array.isArray(data?.elements) ? data.elements : [];

    const waterPolygons: LatLng[][] = [];
    const coastlineSegments: LatLng[][] = [];

    for (const el of elements) {
      const type = (el as { type?: string })?.type;
      const tags = (el as { tags?: Record<string, string> })?.tags ?? {};

      if (type === "way" && tags.natural === "coastline") {
        const pts = extractGeometry(el);
        if (pts.length >= 2) coastlineSegments.push(pts);
        continue;
      }
      if (type === "way" && tags.natural === "water") {
        const pts = extractGeometry(el);
        if (pts.length >= 3) waterPolygons.push(pts);
        continue;
      }
      if (type === "relation" && tags.natural === "water") {
        // Kun "outer"-medlemmer — god nok tilnærming for punkt-i-polygon uten
        // full multipolygon-håndtering (øyer i innsjøen behandles ikke som
        // hull, dvs. en øy midt i en stor innsjø kan i sjeldne tilfeller
        // feilklassifiseres som vann — en dokumentert, aksepert begrensning,
        // se sluttrapportens punkt I, IKKE en ny, stor GIS-motor).
        const members = (el as { members?: { role?: string; geometry?: { lat: number; lon: number }[] }[] })?.members ?? [];
        for (const m of members) {
          if (m.role !== "outer" || !Array.isArray(m.geometry)) continue;
          const pts = m.geometry
            .filter((g) => typeof g?.lat === "number" && typeof g?.lon === "number")
            .map((g) => ({ latitude: g.lat, longitude: g.lon }));
          if (pts.length >= 3) waterPolygons.push(pts);
        }
      }
    }

    return { value: { waterPolygons, coastlineSegments }, status: "available" };
  } catch {
    return { value: EMPTY_WATER_FEATURES, status: "unavailable" };
  }
}

/** Even-odd ray-casting — `polygon` behandles som lukket selv om første/siste punkt ikke er eksplisitt like. */
export function isPointInPolygon(point: LatLng, polygon: readonly LatLng[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].longitude;
    const yi = polygon[i].latitude;
    const xj = polygon[j].longitude;
    const yj = polygon[j].latitude;
    const intersects = yi > point.latitude !== yj > point.latitude && point.longitude < ((xj - xi) * (point.latitude - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

const METERS_PER_DEG_LAT = 111320;

/** Grov, lokal meter-avstand fra et punkt til ETT linjesegment (a→b) — nøyaktig nok på skalaen vi bruker den på (noen hundre meter til noen km). */
function distanceToSegmentMeters(point: LatLng, a: LatLng, b: LatLng): number {
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((point.latitude * Math.PI) / 180) || 1;
  const px = point.longitude * metersPerDegLon;
  const py = point.latitude * METERS_PER_DEG_LAT;
  const ax = a.longitude * metersPerDegLon;
  const ay = a.latitude * METERS_PER_DEG_LAT;
  const bx = b.longitude * metersPerDegLon;
  const by = b.latitude * METERS_PER_DEG_LAT;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Hvilken side av det NÆRMESTE kystlinje-segmentet punktet ligger på.
 * OSM-konvensjon for `natural=coastline`: sett i linjens tegneretning
 * (fra segmentets startpunkt til sluttpunkt) ligger LAND til venstre,
 * VANN til høyre. Kryssprodukt av retningsvektoren og vektoren til punktet
 * avgjør siden (i et lokalt meter-plan, ikke rå lat/lon-grader, siden
 * breddegrad-skalering ellers ville forvridd vinkelen).
 */
export function coastlineSide(point: LatLng, coastlineSegments: readonly LatLng[][], maxDistanceMeters: number): "land" | "water" | null {
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((point.latitude * Math.PI) / 180) || 1;
  const toXY = (p: LatLng) => ({ x: p.longitude * metersPerDegLon, y: p.latitude * METERS_PER_DEG_LAT });

  let bestDist = Infinity;
  let bestSide: "land" | "water" | null = null;

  for (const way of coastlineSegments) {
    for (let i = 0; i < way.length - 1; i++) {
      const a = way[i];
      const b = way[i + 1];
      const dist = distanceToSegmentMeters(point, a, b);
      if (dist >= bestDist) continue;

      const pa = toXY(a);
      const pb = toXY(b);
      const pp = toXY(point);
      const cross = (pb.x - pa.x) * (pp.y - pa.y) - (pb.y - pa.y) * (pp.x - pa.x);
      bestDist = dist;
      bestSide = cross > 0 ? "land" : "water";
    }
  }

  if (bestDist > maxDistanceMeters) return null;
  return bestSide;
}

/**
 * Den samlede geografiske validitets-avgjørelsen fra OSM-geometrien alene —
 * BEVISST separat fra resolve.ts sin habitat-baserte fallback (se
 * resolveSpatialValidity()), som kombinerer denne med det eldre signalet.
 * `maxCoastlineDistanceMeters` bør være romslig nok til å dekke det
 * lokale scoring-gridets cellestørrelse (ellers "ser" et punkt langt fra
 * ALL hentet kystlinje aldri noe kystlinje-bevis) — kalles alltid med et
 * tall avledet fra selve analyseradiusen, se resolve.ts.
 */
export function determineWaterStatusFromOsm(
  point: LatLng,
  water: WaterFeatures,
  maxCoastlineDistanceMeters: number
): "water" | "land" | "unknown" {
  for (const polygon of water.waterPolygons) {
    if (isPointInPolygon(point, polygon)) return "water";
  }
  const side = coastlineSide(point, water.coastlineSegments, maxCoastlineDistanceMeters);
  if (side != null) return side;
  return "unknown";
}
