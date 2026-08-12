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
  type AreaOfInterest,
  type ScoredCell,
} from "./grid";
import { normalizeObservations } from "./normalize";
import { cameraDiversityBonus, computeMovementCorridors } from "./reinforcement";
import { effectiveRadiusMeters, distanceWeight } from "./signals";
import { getSpeciesProfile, type SpeciesProfile } from "./species/profiles";
import type { EngineDebugInfo, EngineObservation, EngineResult, HeatmapPoint, LatLng, PredictionZone, Species } from "./types";
import type { EnvironmentResolver } from "./environment/types";
import { getEcologyProfile } from "./ecology/profiles";
import {
  computeCrepuscularActivityMultiplier,
  computeSpatialSuitability,
  determineSeason,
  isRutActive,
} from "./ecology/suitability";

export { ENGINE_VERSION, DEFAULT_ENGINE_CONFIG };
export type { EngineConfig };
export type { AreaOfInterest } from "./grid";

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
    ecology: { ...DEFAULT_ENGINE_CONFIG.ecology, ...overrides.ecology },
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

/** Øvre grense på antall punkter sendt til et heatmap-lag — beskytter rendering-ytelsen (§22) uavhengig av grid-oppløsning. */
const MAX_HEATMAP_POINTS = 600;
/** Under denne vekten bidrar punktet ikke synlig til et heatmap uansett — ikke verdt å sende det. */
const MIN_HEATMAP_WEIGHT = 0.03;

/**
 * Bygger vektede heatmap-punkter fra HELE det skårede gridet (ikke bare
 * klyngede soner) — samme rå score som zones bruker, kun uten terskel-/
 * klyngefiltreringen, slik at kartet kan tegne et faktisk gradient-landskap
 * i stedet for isolerte sirkler.
 */
function buildHeatmapPoints(scoredCells: readonly ScoredCell[], cfg: EngineConfig): HeatmapPoint[] {
  return scoredCells
    .map((cell) => ({
      latitude: cell.center.latitude,
      longitude: cell.center.longitude,
      weight: saturateScore(cell.score, cfg.zones.scoreSaturation) / 100,
    }))
    .filter((p) => p.weight >= MIN_HEATMAP_WEIGHT)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_HEATMAP_POINTS);
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
    heatmapPoints: [],
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
 * Delt pipeline for `runEngine` (kun observasjoner) og `runEcologicalEngine`
 * (observasjoner + økologisk prior). Selve scoringen er identisk uansett —
 * forskjellen er kun OM et areaOfInterest/ecologyScoreAt sendes inn.
 */
function runPipeline(
  rawObservations: readonly Observasjon[],
  species: Species,
  profile: SpeciesProfile,
  cfg: EngineConfig,
  nowMs: number,
  debug: boolean,
  areaOfInterest?: AreaOfInterest,
  ecologyScoreAt?: (point: LatLng) => number
): EngineResult {
  const normalizedAll = normalizeObservations(rawObservations);
  const observations = normalizedAll.filter((o) => o.species === species);

  if (observations.length === 0 && !areaOfInterest) {
    return emptyResult(species, nowMs, cfg, rawObservations.length, debug);
  }

  const { cells, cellSizeMeters } = buildGridCells(observations, profile, cfg, areaOfInterest);
  const corridors = computeMovementCorridors(observations, cfg.reinforcement);
  const scoredCells = scoreGrid(cells, observations, profile, cfg, nowMs, corridors, ecologyScoreAt);
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
    heatmapPoints: buildHeatmapPoints(scoredCells, cfg),
    debug: debugInfo,
  };
}

/**
 * Kjør ViltIQ Engine v1 for én art, KUN basert på observasjoner (ingen
 * miljø-/økologidata). `rawObservations` kan være hele det synlige
 * datasettet (flere arter) — motoren isolerer selv arten den skal vurdere
 * (§14), så en hjorteobservasjon kan aldri påvirke rådyr- eller
 * elg-resultatet. Ren, synkron, deterministisk — ingen nettverkskall (§27).
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
  return runPipeline(rawObservations, species, profile, cfg, nowMs, debug);
}

export type RunEcologicalEngineOptions = RunEngineOptions & {
  /** Analyseområdets senter og radius — sikrer at motoren kan score et område ut fra miljø/økologi alene, selv uten observasjoner (§T). */
  areaCenter: LatLng;
  areaRadiusMeters: number;
  /**
   * Ferdig utfylt, SYNKRON miljøoppslag — bygg denne med
   * environment/resolve.ts sin `resolveEnvironmentContext()` (async, gjør de
   * faktiske nettverkskallene) FØR du kaller denne funksjonen. Selve
   * scoringen forblir synkron/deterministisk/testbar (§27) uansett hvor
   * miljødataene kom fra.
   */
  environment: EnvironmentResolver;
};

/**
 * ViltIQ Engine v1 med økologisk prior (§S: "Research prior + current
 * environmental suitability + recent observations = posterior prediction").
 * Kombinerer artens forskningsbaserte habitat-/sesong-/høyde-/vei-/vind-
 * suitability (src/engine/ecology) med de samme observasjonssignalene som
 * `runEngine` — ferske, lokale observasjoner kan alltid overstyre en generell
 * prior, siden begge bidrar til samme rå celle-score (se config.ts sin
 * `ecology.weight`-dokumentasjon for hvorfor balansen er satt som den er).
 */
export function runEcologicalEngine(
  rawObservations: readonly Observasjon[],
  species: Species,
  options: RunEcologicalEngineOptions
): EngineResult {
  const cfg = mergeConfig(options.config);
  const nowMs = options.now ?? Date.now();
  const debug = options.debug ?? false;
  const baseProfile = getSpeciesProfile(species);
  const ecologyProfile = getEcologyProfile(species);
  const season = determineSeason(nowMs);

  const rutActive = isRutActive(nowMs, ecologyProfile);
  const profile: SpeciesProfile = rutActive
    ? {
        ...baseProfile,
        movementDirectionWeight: Math.min(1, baseProfile.movementDirectionWeight * (1 + ecologyProfile.rutBehavior.movementBoost)),
        corridorWeight: Math.min(1, baseProfile.corridorWeight * (1 + ecologyProfile.rutBehavior.movementBoost)),
      }
    : baseProfile;

  const crepuscularMultiplier = computeCrepuscularActivityMultiplier(
    nowMs,
    options.environment(options.areaCenter).dynamic,
    ecologyProfile.crepuscularActivity
  );

  const ecologyScoreAt = (point: LatLng): number => {
    const context = options.environment(point);
    const { suitability } = computeSpatialSuitability(ecologyProfile, season, nowMs, context.static, context.dynamic);
    return suitability * cfg.ecology.weight * crepuscularMultiplier;
  };

  const areaOfInterest: AreaOfInterest = { center: options.areaCenter, radiusMeters: options.areaRadiusMeters };
  return runPipeline(rawObservations, species, profile, cfg, nowMs, debug, areaOfInterest, ecologyScoreAt);
}
