// ViltIQ Engine — miljø-orkestrering: bygger et GROVT prøvepunkt-grid over
// analyseområdet, henter statiske trekk (høyde/habitat/vei) per prøvepunkt
// OG én dynamisk værmåling for hele området, og returnerer en ferdig
// EnvironmentResolver den rene scoringsmotoren kan slå opp i synkront.
//
// Ytelse (§26): antall eksterne kall er bundet av ANTALL PRØVEPUNKTER
// (maxSamplePoints, default 36), UANSETT hvor fin den faktiske scoring-
// gridoppløsningen i grid.ts er — finere celler slår bare opp nærmeste
// allerede-hentede prøvepunkt (nearest-neighbor), ingen ekstra nettverkskall.
// Vei hentes med ÉTT Overpass-kall for hele området, ikke ett per punkt.

import { distanceMeters } from "@/src/lib/geo";
import type { LatLng } from "../types";
import { staticElevationCache, staticHabitatCache, roundedCoordKey } from "./cache";
import { fetchDynamicEnvironment } from "./dynamic";
import { fetchElevationMeters } from "./elevation";
import { fetchHabitatClass } from "./habitat";
import { distanceToNearestRoadMeters, fetchRoadsNear } from "./roads";
import {
  UKJENT_STATIC_FEATURES,
  type DynamicEnvironmentalFeatures,
  type EnvironmentResolver,
  type HabitatClass,
  type StaticEnvironmentalFeatures,
} from "./types";

export type ResolveEnvironmentOptions = {
  /** Avstand (m) mellom grove prøvepunkter. Default 500 m. */
  sampleSpacingMeters?: number;
  /** Hardt tak på antall prøvepunkter, uavhengig av områdets størrelse. Default 36. */
  maxSamplePoints?: number;
};

type Sample = { point: LatLng; row: number; col: number; features: StaticEnvironmentalFeatures };

async function cachedElevation(point: LatLng): Promise<number | null> {
  const key = roundedCoordKey(point);
  const cached = staticElevationCache.get(key);
  if (cached !== undefined) return cached;
  const value = await fetchElevationMeters(point);
  staticElevationCache.set(key, value);
  return value;
}

async function cachedHabitat(point: LatLng): Promise<HabitatClass> {
  const key = roundedCoordKey(point);
  const cached = staticHabitatCache.get(key);
  if (cached !== undefined) return cached as HabitatClass;
  const value = await fetchHabitatClass(point);
  staticHabitatCache.set(key, value);
  return value;
}

function buildCoarseSampleGrid(
  center: LatLng,
  radiusMeters: number,
  spacingMeters: number,
  maxPoints: number
): { points: LatLng[]; rows: number; cols: number } {
  let spacing = spacingMeters;
  let sideCount = Math.max(1, Math.ceil((radiusMeters * 2) / spacing));
  if ((sideCount + 1) ** 2 > maxPoints) {
    const scale = Math.sqrt((sideCount + 1) ** 2 / maxPoints);
    spacing *= scale;
    sideCount = Math.max(1, Math.ceil((radiusMeters * 2) / spacing));
  }
  const cols = sideCount + 1;
  const rows = sideCount + 1;

  const metersPerDegLat = 111320;
  const metersPerDegLon = metersPerDegLat * Math.cos((center.latitude * Math.PI) / 180) || 1;
  const latStep = spacing / metersPerDegLat;
  const lonStep = spacing / metersPerDegLon;

  const points: LatLng[] = [];
  const startLat = center.latitude - (latStep * (rows - 1)) / 2;
  const startLon = center.longitude - (lonStep * (cols - 1)) / 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      points.push({ latitude: startLat + r * latStep, longitude: startLon + c * lonStep });
    }
  }
  return { points, rows, cols };
}

/** Grov helning/aspekt fra naboprøvepunktenes høyde i det samme gridet — ingen ekstra API-kall. */
function estimateSlopeAspect(
  row: number,
  col: number,
  rows: number,
  cols: number,
  elevations: readonly (number | null)[],
  spacingMeters: number
): { slopeDegrees: number | null; aspectDeg: number | null } {
  const at = (r: number, c: number): number | null =>
    r >= 0 && r < rows && c >= 0 && c < cols ? elevations[r * cols + c] : null;

  const east = at(row, col + 1);
  const west = at(row, col - 1);
  const north = at(row - 1, col);
  const south = at(row + 1, col);

  if (east == null || west == null || north == null || south == null) {
    return { slopeDegrees: null, aspectDeg: null };
  }

  const gradEast = (east - west) / (2 * spacingMeters);
  const gradNorth = (north - south) / (2 * spacingMeters);
  const gradMagnitude = Math.sqrt(gradEast * gradEast + gradNorth * gradNorth);
  const slopeDegrees = (Math.atan(gradMagnitude) * 180) / Math.PI;

  if (gradMagnitude < 1e-6) return { slopeDegrees: 0, aspectDeg: null };

  // Nedoverbakke-retning (den siden skråningen "vender") — motsatt av gradienten, som peker oppover.
  const aspectRad = Math.atan2(-gradEast, -gradNorth);
  const aspectDeg = ((aspectRad * 180) / Math.PI + 360) % 360;
  return { slopeDegrees, aspectDeg };
}

/** Grov kantsone-proxy (§M): skiller habitatklassen seg fra minst én nabo i gridet? Ingen ekstra API-kall. */
function estimateNearHabitatEdge(
  row: number,
  col: number,
  rows: number,
  cols: number,
  habitats: readonly HabitatClass[]
): boolean {
  const at = (r: number, c: number): HabitatClass | null =>
    r >= 0 && r < rows && c >= 0 && c < cols ? habitats[r * cols + c] : null;
  const self = at(row, col);
  if (self == null || self === "ukjent") return false;
  const neighbors = [at(row, col - 1), at(row, col + 1), at(row - 1, col), at(row + 1, col)];
  return neighbors.some((n) => n != null && n !== "ukjent" && n !== self);
}

function nearestSample(point: LatLng, samples: readonly Sample[]): Sample | null {
  let best: Sample | null = null;
  let bestDist = Infinity;
  for (const s of samples) {
    const d = distanceMeters(point, s.point);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

/**
 * Løser miljøkonteksten for et helt analyseområde og returnerer en synkron
 * EnvironmentResolver. Feiler ALDRI — enkeltkall som mislykkes degraderer til
 * "ukjent" for akkurat det trekket, uten å stoppe resten av oppslaget
 * (Promise.all over uavhengige, allerede feil-svelgende kall).
 */
export async function resolveEnvironmentContext(
  areaCenter: LatLng,
  areaRadiusMeters: number,
  options: ResolveEnvironmentOptions = {}
): Promise<EnvironmentResolver> {
  const spacing = options.sampleSpacingMeters ?? 500;
  const maxPoints = options.maxSamplePoints ?? 36;

  const { points, rows, cols } = buildCoarseSampleGrid(areaCenter, areaRadiusMeters, spacing, maxPoints);

  const [elevations, habitats, roads, dynamic] = await Promise.all([
    Promise.all(points.map((p) => cachedElevation(p))),
    Promise.all(points.map((p) => cachedHabitat(p))),
    fetchRoadsNear(areaCenter, areaRadiusMeters + spacing),
    fetchDynamicEnvironment(areaCenter),
  ]);

  const validElevations = elevations.filter((e): e is number => e != null);
  const meanElevation =
    validElevations.length > 0 ? validElevations.reduce((a, b) => a + b, 0) / validElevations.length : null;

  const samples: Sample[] = points.map((point, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const elevation = elevations[i];
    const relativeElevation = elevation != null && meanElevation != null ? elevation - meanElevation : null;
    const { slopeDegrees, aspectDeg } = estimateSlopeAspect(row, col, rows, cols, elevations, spacing);
    return {
      point,
      row,
      col,
      features: {
        elevationMeters: elevation,
        relativeElevationMeters: relativeElevation,
        slopeDegrees,
        aspectDeg,
        habitat: habitats[i],
        roadDistanceMeters: distanceToNearestRoadMeters(point, roads),
        nearHabitatEdge: estimateNearHabitatEdge(row, col, rows, cols, habitats),
      },
    };
  });

  return (point: LatLng) => ({
    static: samples.length > 0 ? (nearestSample(point, samples)?.features ?? UKJENT_STATIC_FEATURES) : UKJENT_STATIC_FEATURES,
    dynamic: dynamic as DynamicEnvironmentalFeatures,
  });
}
