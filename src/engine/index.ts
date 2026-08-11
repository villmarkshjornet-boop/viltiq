// ViltIQ Engine v1 — offentlig API. Kartet (og annen kode) skal kun
// importere herfra, ikke fra motorens interne filer direkte.

export { runEngine, runEcologicalEngine, ENGINE_VERSION, DEFAULT_ENGINE_CONFIG } from "./engine";
export type { RunEngineOptions, RunEcologicalEngineOptions, EngineConfig, AreaOfInterest } from "./engine";
export { getSpeciesProfile, HJORT_PROFILE, RADYR_PROFILE, ELG_PROFILE } from "./species/profiles";
export type { SpeciesProfile } from "./species/profiles";
export { PRIORITERTE_ARTER } from "./types";
export type {
  Species,
  EngineObservation,
  EngineResult,
  PredictionZone,
  EngineSignalBreakdown,
  EngineDebugInfo,
  ConfidenceLevel,
  ActivityLevel,
  LatLng,
} from "./types";

// Miljø/økologi (§C–§Å i motor-oppdraget) — se docs/ENGINE_RESEARCH.md for kildegrunnlag.
export { resolveEnvironmentContext } from "./environment/resolve";
export type {
  EnvironmentalContext,
  EnvironmentResolver,
  StaticEnvironmentalFeatures,
  DynamicEnvironmentalFeatures,
  HabitatClass,
} from "./environment/types";
export { getEcologyProfile } from "./ecology/profiles";
export type { SpeciesEcologyProfile, Season, EvidenceStrength } from "./ecology/types";
export { determineSeason } from "./ecology/suitability";
