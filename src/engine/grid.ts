// ViltIQ Engine v1 — grid og soner.
//
// Strategi (§17, §26): generer et rutenett rundt observasjonene, gi hver
// rute en score fra de rene signalfunksjonene i signals.ts, og slå sammen
// nærliggende høyt scorede ruter til soner. O(ruter × observasjoner) — for
// realistiske jaktlagsdatasett (titalls/lavthundretalls observasjoner) er
// dette trivielt raskt; maxGridCells setter et hardt ytelsestak uansett.

import { calcBearing, distanceMeters } from "@/src/lib/geo";
import type { EngineConfig } from "./config";
import {
  countWeight,
  directionalAlignment,
  distanceWeight,
  effectiveRadiusMeters,
  sourceWeight,
  timeWeight,
  trackFreshnessAgeOffsetHours,
} from "./signals";
import { corridorBonusAt } from "./reinforcement";
import type { SpeciesProfile } from "./species/profiles";
import type {
  ActivityLevel,
  EngineDebugCorridor,
  EngineObservation,
  EngineSignalBreakdown,
  LatLng,
} from "./types";

const METERS_PER_DEG_LAT = 111320;
/** For svakt bidrag til at det er verdt å fortsette å regne på — ren ytelsesoptimalisering. */
const MIN_RELEVANT_WEIGHT = 1e-4;

function emptyBreakdown(): EngineSignalBreakdown {
  return {
    recency: 0,
    repetition: 0,
    cameraDirection: 0,
    movementDirection: 0,
    cameraDiversity: 0,
    corridor: 0,
    ecology: 0,
  };
}

export type ScoredCell = {
  center: LatLng;
  score: number;
  breakdown: EngineSignalBreakdown;
};

export type RawZone = {
  center: LatLng;
  radiusMeters: number;
  rawScore: number;
  breakdown: EngineSignalBreakdown;
};

export type AreaOfInterest = { center: LatLng; radiusMeters: number };

/**
 * Genererer rutesentre som dekker observasjonene pluss en margin (så
 * signalenes avstandsfalloff ikke kuttes brått ved kartutsnittets kant).
 * Rutestørrelsen skaleres opp automatisk (aldri ned) dersom det ellers ville
 * gitt flere ruter enn `maxGridCells` — deterministisk ytelsestak uten å
 * droppe observasjoner.
 *
 * `areaOfInterest` (valgfri) utvider dekningen til minst dette området selv
 * når det finnes få/ingen observasjoner — nødvendig for at motoren skal
 * kunne score et område ut fra miljø/økologi alene (§T i motor-oppdraget),
 * ikke bare rundt eksisterende observasjoner.
 */
export function buildGridCells(
  observations: readonly EngineObservation[],
  profile: SpeciesProfile,
  cfg: EngineConfig,
  areaOfInterest?: AreaOfInterest
): { cells: LatLng[]; cellSizeMeters: number } {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const o of observations) {
    minLat = Math.min(minLat, o.position.latitude);
    maxLat = Math.max(maxLat, o.position.latitude);
    minLon = Math.min(minLon, o.position.longitude);
    maxLon = Math.max(maxLon, o.position.longitude);
  }

  if (areaOfInterest) {
    const latSpan = areaOfInterest.radiusMeters / METERS_PER_DEG_LAT;
    const lonSpan =
      areaOfInterest.radiusMeters / (METERS_PER_DEG_LAT * Math.cos((areaOfInterest.center.latitude * Math.PI) / 180) || 1);
    minLat = Math.min(minLat, areaOfInterest.center.latitude - latSpan);
    maxLat = Math.max(maxLat, areaOfInterest.center.latitude + latSpan);
    minLon = Math.min(minLon, areaOfInterest.center.longitude - lonSpan);
    maxLon = Math.max(maxLon, areaOfInterest.center.longitude + lonSpan);
  }

  const paddingMeters = profile.baseRadiusMeters * cfg.gridPaddingRadiusFactor;
  const avgLatRad = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos(avgLatRad) || 1;

  const padLat = paddingMeters / METERS_PER_DEG_LAT;
  const padLon = paddingMeters / metersPerDegLon;

  const lat0 = minLat - padLat;
  const lat1 = maxLat + padLat;
  const lon0 = minLon - padLon;
  const lon1 = maxLon + padLon;

  let cellSizeMeters = cfg.cellSizeMeters;
  let rows = Math.max(1, Math.ceil(((lat1 - lat0) * METERS_PER_DEG_LAT) / cellSizeMeters));
  let cols = Math.max(1, Math.ceil(((lon1 - lon0) * metersPerDegLon) / cellSizeMeters));

  if (rows * cols > cfg.maxGridCells) {
    const scale = Math.sqrt((rows * cols) / cfg.maxGridCells);
    cellSizeMeters *= scale;
    rows = Math.max(1, Math.ceil(((lat1 - lat0) * METERS_PER_DEG_LAT) / cellSizeMeters));
    cols = Math.max(1, Math.ceil(((lon1 - lon0) * metersPerDegLon) / cellSizeMeters));
  }

  const cells: LatLng[] = [];
  const latStep = (lat1 - lat0) / rows;
  const lonStep = (lon1 - lon0) / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({
        latitude: lat0 + latStep * (r + 0.5),
        longitude: lon0 + lonStep * (c + 0.5),
      });
    }
  }
  return { cells, cellSizeMeters };
}

/**
 * Score én rute mot alle observasjoner. Retningssignalene (kamera/bevegelse)
 * virker MULTIPLIKATIVT på observasjonens grunnbidrag — punkter foran
 * kameraet/bevegelsesretningen får opptil hele bidraget, punkter rett bak
 * får det dempet til `behindFloor`-andelen. `signalBreakdown` er diagnostisk
 * (til forklaring/debug) og summerer IKKE nødvendigvis eksakt til `score`,
 * siden de underliggende faktorene er multiplikative, ikke additive.
 */
export function scoreCell(
  point: LatLng,
  observations: readonly EngineObservation[],
  profile: SpeciesProfile,
  cfg: EngineConfig,
  nowMs: number,
  corridors: readonly EngineDebugCorridor[],
  ecologyScoreAt?: (point: LatLng) => number
): ScoredCell {
  const breakdown = emptyBreakdown();
  let total = 0;

  for (const o of observations) {
    const recordedAgeHours = (nowMs - o.timestamp) / 3600000;
    // Spor (source === "track") får en ekstra effektiv-alder-offset basert på
    // hvor gammelt sporet SÅ UT (trackFreshness) — se signals.ts sin
    // trackFreshnessAgeOffsetHours for begrunnelse. No-op (0) for alle andre
    // kilder og for spor uten trackFreshness satt — fullt bakoverkompatibelt.
    const freshnessOffsetHours =
      o.source === "track" ? trackFreshnessAgeOffsetHours(o.trackFreshness) : 0;
    const ageHours = recordedAgeHours + freshnessOffsetHours;
    const tWeight = timeWeight(ageHours, cfg.timeDecay);
    const radius = effectiveRadiusMeters(profile.baseRadiusMeters, ageHours, cfg.distance);
    const dist = distanceMeters(point, o.position);
    const dWeight = distanceWeight(dist, radius);
    if (dWeight < MIN_RELEVANT_WEIGHT) continue;

    const cWeight = countWeight(o.count, cfg.maxCountPerObservation);
    const srcWeight = sourceWeight(o.source, profile.sourceWeights);
    const qualityFactor = 0.5 + 0.5 * o.dataQuality;

    const base = tWeight * dWeight * cWeight * srcWeight * qualityFactor;

    let camMultiplier = 1;
    let moveMultiplier = 1;
    if (dist > 1) {
      const bearingFromObs = calcBearing(o.position, point);
      if (o.cameraDirectionDeg != null && profile.cameraDirectionWeight > 0) {
        const align = directionalAlignment(bearingFromObs, o.cameraDirectionDeg, cfg.direction.behindFloor);
        camMultiplier = 1 + (align - 1) * profile.cameraDirectionWeight;
      }
      if (o.movementDirectionDeg != null && profile.movementDirectionWeight > 0) {
        const align = directionalAlignment(bearingFromObs, o.movementDirectionDeg, cfg.direction.behindFloor);
        moveMultiplier = 1 + (align - 1) * profile.movementDirectionWeight;
      }
    }

    const contribution = base * camMultiplier * moveMultiplier;
    total += contribution;

    breakdown.repetition += base;
    if (ageHours <= profile.timeHalfLifeHours) breakdown.recency += base;
    breakdown.cameraDirection += base * (camMultiplier - 1);
    breakdown.movementDirection += base * (moveMultiplier - 1);
  }

  const corridorBonus = corridorBonusAt(point, corridors, profile, cfg);
  total += corridorBonus;
  breakdown.corridor += corridorBonus;

  if (ecologyScoreAt) {
    const ecologyContribution = ecologyScoreAt(point);
    total += ecologyContribution;
    breakdown.ecology += ecologyContribution;
  }

  return { center: point, score: total, breakdown };
}

export function scoreGrid(
  cells: readonly LatLng[],
  observations: readonly EngineObservation[],
  profile: SpeciesProfile,
  cfg: EngineConfig,
  nowMs: number,
  corridors: readonly EngineDebugCorridor[],
  ecologyScoreAt?: (point: LatLng) => number
): ScoredCell[] {
  return cells.map((point) => scoreCell(point, observations, profile, cfg, nowMs, corridors, ecologyScoreAt));
}

/** displayScore = 100 × (1 − e^(−raw / saturation)) — se config.ts sin dokumentasjon av `scoreSaturation`. */
export function saturateScore(rawScore: number, saturation: number): number {
  if (saturation <= 0) return rawScore > 0 ? 100 : 0;
  return 100 * (1 - Math.exp(-Math.max(0, rawScore) / saturation));
}

function inverseSaturateScore(displayScore: number, saturation: number): number {
  const ratio = Math.min(0.999999, Math.max(0, displayScore / 100));
  return -saturation * Math.log(1 - ratio);
}

export function levelFromScore(score: number, thresholds: EngineConfig["levelThresholds"]): ActivityLevel {
  if (score >= thresholds.sværtHøy) return "Svært høy";
  if (score >= thresholds.høy) return "Høy";
  if (score >= thresholds.moderat) return "Moderat";
  return "Lav";
}

/**
 * Grådig sone-utvinning: ta høyest scorede rute som ikke allerede ligger
 * innenfor `mergeRadiusMeters` av en eksisterende sone, gjenta. Deterministisk
 * (stabil sortering på score, så likt input alltid gir likt output).
 *
 * `mergeRadiusMeters` sendes inn av kalleren (engine.ts), som utleder den fra
 * ARTENS baseRadiusMeters — ikke en fast global konstant. Uten det ville én
 * enkelt observasjon med sterk retningsbias kunne "ekko" seg selv til flere
 * separate soner (halen av samme Gaussiske topp som stikker over
 * sone-terskelen flere steder i front-sektoren), fordi et fast merge-mål
 * ikke nødvendigvis dekker hele observasjonens meningsfulle scoreflate.
 */
export function extractZones(
  scoredCells: readonly ScoredCell[],
  cellSizeMeters: number,
  mergeRadiusMeters: number,
  cfg: EngineConfig
): RawZone[] {
  const minRawScore = inverseSaturateScore(cfg.zones.minZoneScore, cfg.zones.scoreSaturation);
  const sorted = [...scoredCells].sort((a, b) => b.score - a.score);

  const zones: RawZone[] = [];
  const claimed: LatLng[] = [];

  for (const cell of sorted) {
    if (zones.length >= cfg.zones.maxZones) break;
    if (cell.score < minRawScore) break;
    const tooClose = claimed.some((c) => distanceMeters(c, cell.center) < mergeRadiusMeters);
    if (tooClose) continue;

    claimed.push(cell.center);
    zones.push({
      center: cell.center,
      radiusMeters: Math.max(cellSizeMeters, mergeRadiusMeters / 2),
      rawScore: cell.score,
      breakdown: cell.breakdown,
    });
  }

  return zones;
}
