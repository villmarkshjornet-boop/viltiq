// ViltIQ Engine v1 — orkestrering.
//
// Pipeline: normaliser → isoler art → generer grid → finn korridorer →
// score ruter → klynge til soner → kamera-diversitetsbonus → confidence →
// forklaring → sett sammen resultat. Ingen tilfeldighet, ingen eksternt
// kall, ingen AI — samme input gir alltid samme output (§27).

import { distanceMeters } from "@/src/lib/geo";
import type { Observasjon } from "@/src/types/observation";
import { DEFAULT_ENGINE_CONFIG, ENGINE_VERSION, type EngineConfig } from "./config";
import { computeFallbackConfidence, computeZoneConfidence, confidenceLevelFromScore } from "./confidence";
import { buildZoneExplanation } from "./explain";
import {
  buildGridCells,
  extractZones,
  levelFromScore,
  saturateScore,
  scoreGrid,
} from "./grid";
import { normalizeObservations } from "./normalize";
import { cameraDiversityBonus, computeMovementCorridors } from "./reinforcement";
import { effectiveRadiusMeters, distanceWeight } from "./signals";
import { getSpeciesProfile } from "./species/profiles";
import type { EngineDebugInfo, EngineObservation, EngineResult, LatLng, PredictionZone, Species } from "./types";

export { ENGINE_VERSION, DEFAULT_ENGINE_CONFIG };
export type { EngineConfig };

export type RunEngineOptions = {
  /** Epoketid (ms) motoren skal regne "nå" fra. Kun til testing — defaulter til Date.now(). */
  now?: number;
  /** Inkluder EngineDebugInfo i resultatet (§23). */
  debug?: boolean;
  /** Delvis overstyring av DEFAULT_ENGINE_CONFIG. */
  config?: Partial<EngineConfig>;
};

function mergeConfig(overrides: Partial<EngineConfig> | undefined): EngineConfig {
  if (!overrides) return DEFAULT_ENGINE_CONFIG;
  return {
    ...DEFAULT_ENGINE_CONFIG,
    ...overrides,
    timeDecay: { ...DEFAULT_ENGINE_CONFIG.timeDecay, ...overrides.timeDecay },
    distance: { ...DEFAULT_ENGINE_CONFIG.distance, ...overrides.distance },
    direction: { ...DEFAULT_ENGINE_CONFIG.direction, ...overrides.direction },
    reinforcement: { ...DEFAULT_ENGINE_CONFIG.reinforcement, ...overrides.reinforcement },
    zones: { ...DEFAULT_ENGINE_CONFIG.zones, ...overrides.zones },
    levelThresholds: { ...DEFAULT_ENGINE_CONFIG.levelThresholds, ...overrides.levelThresholds },
    confidenceThresholds: { ...DEFAULT_ENGINE_CONFIG.confidenceThresholds, ...overrides.confidenceThresholds },
    confidence: {
      ...DEFAULT_ENGINE_CONFIG.confidence,
      ...overrides.confidence,
      weights: { ...DEFAULT_ENGINE_CONFIG.confidence.weights, ...overrides.confidence?.weights },
    },
  };
}

function findContributingObservations(
  center: LatLng,
  observations: readonly EngineObservation[],
  baseRadiusMeters: number,
  cfg: EngineConfig,
  nowMs: number
): EngineObservation[] {
  const CONTRIBUTION_THRESHOLD = 0.05;
  return observations.filter((o) => {
    const ageHours = (nowMs - o.timestamp) / 3600000;
    const radius = effectiveRadiusMeters(baseRadiusMeters, ageHours, cfg.distance);
    const dist = distanceMeters(center, o.position);
    return distanceWeight(dist, radius) >= CONTRIBUTION_THRESHOLD;
  });
}

function emptyResult(species: Species, nowMs: number, cfg: EngineConfig, inputCount: number, debug: boolean): EngineResult {
  const profile = getSpeciesProfile(species);
  return {
    engineVersion: ENGINE_VERSION,
    species,
    generatedAt: nowMs,
    zones: [],
    confidence: 0,
    confidenceLevel: "lav",
    summary: `Ingen observasjoner av ${profile.label.toLowerCase()} funnet i dette området med dagens data.`,
    signals: [],
    observationsConsidered: 0,
    debug: debug
      ? {
          totalObservationsInput: inputCount,
          totalObservationsAfterNormalize: 0,
          gridCellCount: 0,
          cellSizeMeters: cfg.cellSizeMeters,
          topCells: [],
          corridors: [],
        }
      : undefined,
  };
}

/**
 * Kjør ViltIQ Engine v1 for én art. `rawObservations` kan være hele det
 * synlige datasettet (flere arter) — motoren isolerer selv arten den skal
 * vurdere (§14), så en hjorteobservasjon kan aldri påvirke rådyr- eller
 * elg-resultatet.
 */
export function runEngine(
  rawObservations: readonly Observasjon[],
  species: Species,
  options: RunEngineOptions = {}
): EngineResult {
  const cfg = mergeConfig(options.config);
  const nowMs = options.now ?? Date.now();
  const debug = options.debug ?? false;
  const profile = getSpeciesProfile(species);

  const normalizedAll = normalizeObservations(rawObservations);
  const observations = normalizedAll.filter((o) => o.species === species);

  if (observations.length === 0) {
    return emptyResult(species, nowMs, cfg, rawObservations.length, debug);
  }

  const { cells, cellSizeMeters } = buildGridCells(observations, profile, cfg);
  const corridors = computeMovementCorridors(observations, cfg.reinforcement);
  const scoredCells = scoreGrid(cells, observations, profile, cfg, nowMs, corridors);
  // Merge-radius skalert med artens egen baseRadius — se extractZones' dokumentasjon
  // for hvorfor en fast global verdi kan fragmentere én observasjon til flere soner.
  const mergeRadiusMeters = Math.max(cfg.zones.mergeRadiusMeters, profile.baseRadiusMeters * 1.5);
  const rawZones = extractZones(scoredCells, cellSizeMeters, mergeRadiusMeters, cfg);

  const zones: PredictionZone[] = rawZones.map((raw, index) => {
    const contributing = findContributingObservations(raw.center, observations, profile.baseRadiusMeters, cfg, nowMs);
    const distinctCameraIds = new Set(
      contributing.filter((o) => o.source === "camera" && o.cameraId != null).map((o) => o.cameraId as string)
    );
    const camBonus = cameraDiversityBonus(contributing, cfg.reinforcement);
    const breakdown = { ...raw.breakdown, cameraDiversity: camBonus };
    const finalRawScore = raw.rawScore + camBonus;

    const displayScore = saturateScore(finalRawScore, cfg.zones.scoreSaturation);
    const level = levelFromScore(displayScore, cfg.levelThresholds);
    const confidence = computeZoneConfidence(contributing, cfg, nowMs);
    const confidenceLevel = confidenceLevelFromScore(confidence, cfg.confidenceThresholds);
    const newestAgeMinutes = contributing.length
      ? Math.round((nowMs - Math.max(...contributing.map((o) => o.timestamp))) / 60000)
      : 0;

    const { explanation, dominantSignals } = buildZoneExplanation({
      species: profile,
      level,
      center: raw.center,
      contributingObservations: contributing,
      breakdown,
      distinctCameraCount: distinctCameraIds.size,
      corridors,
      nowMs,
    });

    const zone: PredictionZone = {
      id: `${species}-zone-${index + 1}`,
      species,
      center: raw.center,
      radiusMeters: raw.radiusMeters,
      score: Math.round(displayScore * 10) / 10,
      level,
      confidence: Math.round(confidence * 100) / 100,
      confidenceLevel,
      observationCount: contributing.length,
      distinctCameraCount: distinctCameraIds.size,
      newestObservationAgeMinutes: Math.max(0, newestAgeMinutes),
      dominantSignals,
      explanation,
      signalBreakdown: breakdown,
    };
    return zone;
  });

  zones.sort((a, b) => b.score - a.score);

  const overallConfidence = zones.length > 0 ? zones[0].confidence : computeFallbackConfidence(observations, cfg, nowMs);
  const overallConfidenceLevel = confidenceLevelFromScore(overallConfidence, cfg.confidenceThresholds);
  const summary =
    zones.length > 0
      ? `${zones[0].level} aktivitet. ${zones[0].explanation}`
      : `Ingen område når terskelen for en tydelig sone for ${profile.label.toLowerCase()} akkurat nå.`;

  const debugInfo: EngineDebugInfo | undefined = debug
    ? {
        totalObservationsInput: rawObservations.length,
        totalObservationsAfterNormalize: observations.length,
        gridCellCount: cells.length,
        cellSizeMeters,
        topCells: [...scoredCells]
          .sort((a, b) => b.score - a.score)
          .slice(0, 10)
          .map((c) => ({ center: c.center, score: Math.round(c.score * 1000) / 1000, breakdown: c.breakdown })),
        corridors,
      }
    : undefined;

  return {
    engineVersion: ENGINE_VERSION,
    species,
    generatedAt: nowMs,
    zones,
    confidence: overallConfidence,
    confidenceLevel: overallConfidenceLevel,
    summary,
    signals: zones.length > 0 ? zones[0].dominantSignals : [],
    observationsConsidered: observations.length,
    debug: debugInfo,
  };
}
