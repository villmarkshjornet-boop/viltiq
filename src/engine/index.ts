// ViltIQ Engine v1 — offentlig API. Kartet (og annen kode) skal kun
// importere herfra, ikke fra motorens interne filer direkte.

export { runEngine, ENGINE_VERSION, DEFAULT_ENGINE_CONFIG } from "./engine";
export type { RunEngineOptions, EngineConfig } from "./engine";
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
